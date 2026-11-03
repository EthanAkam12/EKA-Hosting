// Logins. The administrator (the host) uses ADMIN_PASSWORD; customers use
// their email and password (server/users.js). Sessions are HMAC-signed
// cookies, so no session store is needed.
//
// In demo mode, visitors can also start a demo session without a password:
// it gets its own id, sees only its own sites and can't publish.

import crypto from "node:crypto";

const COOKIE = "eka_session";
const MAX_AGE_S = 60 * 60 * 24 * 14; // 14 days

export function createAuth({ password, secret, secure, users = null }) {
  const key = crypto.createHash("sha256").update(`${secret}:${password}`).digest();
  // Changing the password invalidates every existing session, because the
  // key is derived from it.

  const sign = (payload) => crypto.createHmac("sha256", key).update(payload).digest("base64url");

  // Payloads: "admin.<expires>", "demo.<id>.<expires>" or
  // "user.<id>.<session key>.<expires>". A customer's session key changes
  // when their password is reset or they're disabled, which ends their sessions.
  function makeToken(user = { role: "admin" }, maxAge = MAX_AGE_S) {
    const exp = Math.floor(Date.now() / 1000) + maxAge;
    const payload = user.role === "demo" ? `demo.${user.id}.${exp}` : user.role === "user" ? `user.${user.id}.${user.sessionKey}.${exp}` : `admin.${exp}`;
    return `${payload}.${sign(payload)}`;
  }

  // Signed, short-lived tokens for links: "login" (one-time sign-in, e.g. from
  // a control panel) and "reset" (choose a new password).
  function linkToken(kind, user, maxAge) {
    const exp = Math.floor(Date.now() / 1000) + maxAge;
    const payload = `${kind}.${user.id}.${user.sessionKey}.${exp}.${crypto.randomBytes(6).toString("hex")}`;
    return `${payload}.${sign(payload)}`;
  }
  const usedLinks = new Map(); // one-time login links already used → expiry
  function readLink(kind, token) {
    const parts = checkSigned(token);
    if (!parts || parts[0] !== kind || parts.length !== 5) return null;
    const exp = Number(parts[3]);
    if (!Number.isFinite(exp) || exp <= Date.now() / 1000) return null;
    const user = users?.get(parts[1]);
    if (!user || user.disabled || user.sessionKey !== parts[2]) return null;
    return { user, exp, nonce: parts[4] };
  }

  // The payload's parts if the signature is right, else null.
  function checkSigned(token) {
    if (!token) return null;
    const i = token.lastIndexOf(".");
    if (i < 0) return null;
    const payload = token.slice(0, i);
    const sig = Buffer.from(token.slice(i + 1));
    const expected = Buffer.from(sign(payload));
    if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
    return payload.split(".");
  }

  // Returns the user ({ role: "admin" }, { role: "demo", id } or
  // { role: "user", id, email, name, plan }) or null.
  function verify(token) {
    const parts = checkSigned(token);
    if (!parts) return null;
    const exp = Number(parts[parts.length - 1]);
    if (!Number.isFinite(exp) || exp <= Date.now() / 1000) return null;
    if (parts[0] === "admin" && parts.length === 2) return { role: "admin" };
    if (parts[0] === "demo" && parts.length === 3 && /^[a-f0-9]{16}$/.test(parts[1])) return { role: "demo", id: parts[1] };
    if (parts[0] === "user" && parts.length === 4) {
      const u = users?.get(parts[1]);
      if (!u || u.disabled || u.sessionKey !== parts[2]) return null;
      return { role: "user", id: u.id, email: u.email, name: u.name, plan: u.plan };
    }
    return null;
  }

  function readCookie(req) {
    const header = req.headers.cookie || "";
    for (const part of header.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === COOKIE) return decodeURIComponent(v.join("="));
    }
    return null;
  }

  function checkPassword(input) {
    const a = crypto.createHash("sha256").update(String(input || "")).digest();
    const b = crypto.createHash("sha256").update(password).digest();
    return crypto.timingSafeEqual(a, b);
  }

  // Tiny in-memory rate limit on login attempts per IP.
  const attempts = new Map();
  function tooManyAttempts(ip) {
    const now = Date.now();
    const rec = attempts.get(ip) || { count: 0, since: now };
    if (now - rec.since > 15 * 60 * 1000) { rec.count = 0; rec.since = now; }
    rec.count++;
    attempts.set(ip, rec);
    return rec.count > 10;
  }

  const setCookie = (res, token, maxAge) => res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`);

  return {
    isAuthed: (req) => !!verify(readCookie(req)),
    user: (req) => verify(readCookie(req)),

    // A fresh demo workspace for this visitor (demo mode only).
    startDemo(req, res, maxAge) {
      const id = crypto.randomBytes(8).toString("hex");
      setCookie(res, makeToken({ role: "demo", id }, maxAge), maxAge);
      return id;
    },

    // Customers log in with their email; the administrator with just the password.
    async login(req, res) {
      if (tooManyAttempts(req.ip)) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
      const email = String(req.body?.email || "").trim();
      if (!email || email.toLowerCase() === "admin") {
        if (!checkPassword(req.body?.password)) return res.status(401).json({ error: email ? "Wrong password." : "Wrong password. Customers: enter your email address too." });
        attempts.delete(req.ip);
        setCookie(res, makeToken(), MAX_AGE_S);
        return res.json({ ok: true });
      }
      const user = users && (await users.check(email, req.body?.password));
      if (!user) return res.status(401).json({ error: "Wrong email or password." });
      attempts.delete(req.ip);
      await users.touch(user.id);
      setCookie(res, makeToken({ role: "user", ...user }), MAX_AGE_S);
      res.json({ ok: true });
    },

    /** A one-time sign-in link for a customer, valid for `maxAge` seconds. */
    loginLink: (user, maxAge = 120) => linkToken("login", user, maxAge),
    /** Uses a one-time sign-in link. Returns the customer, or null. */
    async useLoginLink(req, res, token) {
      const link = readLink("login", token);
      if (!link || usedLinks.has(link.nonce)) return null;
      usedLinks.set(link.nonce, link.exp);
      for (const [n, exp] of usedLinks) if (exp < Date.now() / 1000) usedLinks.delete(n);
      await users.touch(link.user.id);
      setCookie(res, makeToken({ role: "user", ...link.user }, MAX_AGE_S), MAX_AGE_S);
      return link.user;
    },
    /** A "choose a new password" link, valid for an hour or until the password changes. */
    resetLink: (user) => linkToken("reset", user, 3600),
    readResetLink: (token) => readLink("reset", token)?.user || null,

    logout(req, res) {
      res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
      res.json({ ok: true });
    },

    // For API routes: JSON 401. For pages: redirect to login.
    requireApi(req, res, next) {
      req.user = verify(readCookie(req));
      if (req.user) return next();
      res.status(401).json({ error: "Please log in." });
    },
    requirePage(req, res, next) {
      req.user = verify(readCookie(req));
      if (req.user) return next();
      res.redirect("/admin/login");
    },
  };
}
