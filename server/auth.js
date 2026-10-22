// Single-admin login. The password comes from ADMIN_PASSWORD; sessions are
// HMAC-signed cookies, so no session store is needed.

import crypto from "node:crypto";

const COOKIE = "eka_session";
const MAX_AGE_S = 60 * 60 * 24 * 14; // 14 days

export function createAuth({ password, secret, secure }) {
  const key = crypto.createHash("sha256").update(`${secret}:${password}`).digest();
  // Changing the password invalidates every existing session, because the
  // key is derived from it.

  const sign = (payload) => crypto.createHmac("sha256", key).update(payload).digest("base64url");

  function makeToken() {
    const payload = `admin.${Math.floor(Date.now() / 1000) + MAX_AGE_S}`;
    return `${payload}.${sign(payload)}`;
  }

  function verify(token) {
    if (!token) return false;
    const i = token.lastIndexOf(".");
    if (i < 0) return false;
    const payload = token.slice(0, i);
    const sig = Buffer.from(token.slice(i + 1));
    const expected = Buffer.from(sign(payload));
    if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return false;
    const exp = Number(payload.split(".")[1]);
    return Number.isFinite(exp) && exp > Date.now() / 1000;
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

  return {
    isAuthed: (req) => verify(readCookie(req)),

    login(req, res) {
      if (tooManyAttempts(req.ip)) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
      if (!checkPassword(req.body?.password)) return res.status(401).json({ error: "Wrong password." });
      attempts.delete(req.ip);
      res.setHeader("Set-Cookie", `${COOKIE}=${makeToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure ? "; Secure" : ""}`);
      res.json({ ok: true });
    },

    logout(req, res) {
      res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
      res.json({ ok: true });
    },

    // For API routes: JSON 401. For pages: redirect to login.
    requireApi(req, res, next) {
      if (verify(readCookie(req))) return next();
      res.status(401).json({ error: "Please log in." });
    },
    requirePage(req, res, next) {
      if (verify(readCookie(req))) return next();
      res.redirect("/admin/login");
    },
  };
}
