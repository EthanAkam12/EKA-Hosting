// EKA licence server: you (the seller) run this, once, on your own server.
// Each host's builder asks it, twice a day, whether its licence key is good;
// the answer is signed, so a host can't fake one. It also tells builders
// about new versions.
//
//   LICENCE_ADMIN_PASSWORD=choose-one PORT=4100 node licence-server/server.mjs
//
// Then open http://<server>:4100/admin (user "admin", that password) to make
// licence keys, see which servers use them, and announce updates.
// Run node licence-server/keys.mjs first.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.LICENCE_DATA_DIR || path.join(here, "data"));
const PORT = Number(process.env.PORT) || 4100;
const PASSWORD = process.env.LICENCE_ADMIN_PASSWORD || "";
if (PASSWORD.length < 8) {
  console.error("Set LICENCE_ADMIN_PASSWORD (at least 8 characters) to start the licence server.");
  process.exit(1);
}

let privateKey;
try {
  privateKey = crypto.createPrivateKey(await fs.readFile(path.join(DATA, "private-key.pem"), "utf8"));
} catch {
  console.error("No signing key yet. Run:  node licence-server/keys.mjs https://licence.yourdomain.com");
  process.exit(1);
}

// ---- storage -------------------------------------------------------------------

const DB_FILE = path.join(DATA, "licences.json");
let db = { licences: [], latest: null };
try { db = JSON.parse(await fs.readFile(DB_FILE, "utf8")); } catch { /* first run */ }
db.licences ||= [];
let writing = Promise.resolve();
function save() {
  writing = writing.then(async () => {
    const tmp = `${DB_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 1), { mode: 0o600 });
    await fs.rename(tmp, DB_FILE);
  });
  return writing;
}

const newKey = () => `EKA-${Array.from({ length: 4 }, () => crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 5)).join("-")}`;
const today = () => new Date().toISOString().slice(0, 10);
const sign = (payload) => {
  const text = Buffer.from(JSON.stringify(payload)).toString("base64");
  return { payload: text, sig: crypto.sign(null, Buffer.from(text), privateKey).toString("base64") };
};

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY) app.set("trust proxy", true);

// ---- builders checking in ----------------------------------------------------------

const hits = new Map();
app.post("/v1/check", express.json({ limit: "8kb" }), async (req, res) => {
  const now = Date.now();
  const rec = (hits.get(req.ip) || []).filter((t) => now - t < 3600_000);
  if (rec.length > 60) return res.status(429).json({ error: "Too many checks." });
  rec.push(now);
  hits.set(req.ip, rec);

  const b = req.body || {};
  const key = String(b.key || "").trim().toUpperCase();
  const serverId = String(b.serverId || "").slice(0, 64);
  if (!/^[a-f0-9]{16,64}$/.test(serverId)) return res.status(400).json({ error: "Bad server id." });
  const lic = db.licences.find((l) => l.key === key);
  let valid = false, reason = "";
  if (!lic) reason = "isn't a valid licence key";
  else if (lic.revoked) reason = "has been cancelled";
  else if (lic.expires && lic.expires < today()) reason = `expired on ${lic.expires}`;
  else {
    lic.activations ||= [];
    let act = lic.activations.find((a) => a.serverId === serverId);
    if (!act && lic.activations.length >= lic.servers) reason = `is already in use on ${lic.servers} server${lic.servers === 1 ? "" : "s"} (the most it allows)`;
    else {
      if (!act) lic.activations.push((act = { serverId, firstSeen: new Date().toISOString() }));
      Object.assign(act, {
        hostname: String(b.hostname || "").slice(0, 120),
        version: String(b.version || "").slice(0, 20),
        sites: Number(b.stats?.sites) || 0,
        customers: Number(b.stats?.customers) || 0,
        lastSeen: new Date().toISOString(),
        ip: req.ip,
      });
      valid = true;
      await save();
    }
  }
  res.json(sign({ key, serverId, valid, reason, name: lic?.name || "", expires: lic?.expires || null, checkedAt: new Date().toISOString(), latest: db.latest || null }));
});

// ---- your admin page ----------------------------------------------------------------

const attempts = new Map();
function adminAuth(req, res, next) {
  const [user, pass] = Buffer.from(String(req.get("Authorization") || "").replace(/^Basic /, ""), "base64").toString().split(":");
  const a = crypto.createHash("sha256").update(String(pass || "")).digest(), want = crypto.createHash("sha256").update(PASSWORD).digest();
  if (user === "admin" && crypto.timingSafeEqual(a, want)) return next();
  const n = (attempts.get(req.ip) || 0) + 1;
  attempts.set(req.ip, n);
  setTimeout(() => attempts.delete(req.ip), 15 * 60 * 1000).unref();
  if (n > 10) return res.status(429).send("Too many attempts. Try again in 15 minutes.");
  res.set("WWW-Authenticate", 'Basic realm="EKA licences"').status(401).send("Log in with user admin and your licence admin password.");
}

app.get("/admin", adminAuth, (req, res) => res.sendFile(path.join(here, "admin.html")));
const adminApi = express.Router();
adminApi.use(adminAuth, express.json());
// Only same-page requests (blocks cross-site form posts).
adminApi.use((req, res, next) => (req.method === "GET" || req.get("X-Requested-With") === "eka" ? next() : res.status(415).json({ error: "Unsupported request." })));
adminApi.get("/licences", (req, res) => res.json(db));
adminApi.post("/licences", async (req, res) => {
  const b = req.body || {};
  const lic = {
    key: newKey(),
    name: String(b.name || "").trim().slice(0, 120) || "Unnamed host",
    email: String(b.email || "").trim().slice(0, 200),
    servers: Math.max(1, Math.min(1000, Number(b.servers) || 1)),
    expires: /^\d{4}-\d{2}-\d{2}$/.test(b.expires || "") ? b.expires : null,
    notes: String(b.notes || "").slice(0, 2000),
    revoked: false,
    createdAt: new Date().toISOString(),
    activations: [],
  };
  db.licences.push(lic);
  await save();
  res.json({ licence: lic });
});
adminApi.patch("/licences/:key", async (req, res) => {
  const lic = db.licences.find((l) => l.key === req.params.key);
  if (!lic) return res.status(404).json({ error: "Not found." });
  const b = req.body || {};
  if (b.name !== undefined) lic.name = String(b.name).trim().slice(0, 120);
  if (b.email !== undefined) lic.email = String(b.email).trim().slice(0, 200);
  if (b.servers !== undefined) lic.servers = Math.max(1, Math.min(1000, Number(b.servers) || 1));
  if (b.expires !== undefined) lic.expires = /^\d{4}-\d{2}-\d{2}$/.test(b.expires || "") ? b.expires : null;
  if (b.notes !== undefined) lic.notes = String(b.notes).slice(0, 2000);
  if (b.revoked !== undefined) lic.revoked = !!b.revoked;
  if (b.removeServer) lic.activations = (lic.activations || []).filter((a) => a.serverId !== b.removeServer);
  await save();
  res.json({ licence: lic });
});
// The newest version, shown to every builder's administrator.
adminApi.put("/latest", async (req, res) => {
  const b = req.body || {};
  db.latest = /^\d+\.\d+\.\d+$/.test(b.version || "") ? { version: b.version, notes: String(b.notes || "").slice(0, 2000), url: String(b.url || "").slice(0, 500), date: today() } : null;
  await save();
  res.json({ latest: db.latest });
});
app.use("/admin/api", adminApi);

app.get("/", (req, res) => res.type("text").send("EKA licence server"));
app.listen(PORT, () => console.log(`EKA licence server on port ${PORT}. Admin: /admin (user "admin").`));
