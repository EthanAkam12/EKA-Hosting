// Single-admin login. The password comes from ADMIN_PASSWORD; sessions are
// HMAC-signed cookies, so no session store is needed.
//
// In demo mode, visitors can also start a demo session without a password:
// it gets its own id, sees only its own sites and can't publish.

import crypto from "node:crypto";

const COOKIE = "eka_session";
const MAX_AGE_S = 60 * 60 * 24 * 14; // 14 days

export function createAuth({ password, secret, secure }) {
  const key = crypto.createHash("sha256").update(`${secret}:${password}`).digest();
  // Changing the password invalidates every existing session, because the
  // key is derived from it.

  const sign = (payload) => crypto.createHmac("sha256", key).update(payload).digest("base64url");

  // Payloads: "admin.<expires>" or "demo.<id>.<expires>".
  function makeToken(user = { role: "admin" }, maxAge = MAX_AGE_S) {
    const exp = Math.floor(Date.now() / 1000) + maxAge;
    const payload = user.role === "demo" ? `demo.${user.id}.${exp}` : `admin.${exp}`;
    return `${payload}.${sign(payload)}`;
  }

  // Returns the user ({ role: "admin" } or { role: "demo", id }) or null.
  function verify(token) {
    if (!token) return null;
    const i = token.lastIndexOf(".");
    if (i < 0) return null;
    const payload = token.slice(0, i);
    const sig = Buffer.from(token.slice(i + 1));
    const expected = Buffer.from(sign(payload));
    if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
    const parts = payload.split(".");
    const exp = Number(parts[parts.length - 1]);
    if (!Number.isFinite(exp) || exp <= Date.now() / 1000) return null;
    if (parts[0] === "admin" && parts.length === 2) return { role: "admin" };
    if (parts[0] === "demo" && parts.length === 3 && /^[a-f0-9]{16}$/.test(parts[1])) return { role: "demo", id: parts[1] };
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

    login(req, res) {
      if (tooManyAttempts(req.ip)) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
      if (!checkPassword(req.body?.password)) return res.status(401).json({ error: "Wrong password." });
      attempts.delete(req.ip);
      setCookie(res, makeToken(), MAX_AGE_S);
      res.json({ ok: true });
    },

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
