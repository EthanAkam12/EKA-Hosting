// EKA HQ: the program that runs EKA Hosting's day-to-day with a team of AI
// staff. Separate from the website builder (which is just the tool): HQ talks
// to the builder and to WHMCS over their APIs.
//
//   npm run hq          (or start-hq-windows.bat)   → http://localhost:3100

import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";

const HQ_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(HQ_ROOT, "..");
for (const name of ["hq-settings.txt"]) {
  try { process.loadEnvFile(path.join(ROOT, name)); } catch { /* use the environment */ }
}
// HQ's AI settings are separate from the builder's: HQ_AI_* override the shared names.
for (const k of ["ANTHROPIC_API_KEY", "AI_PROVIDER", "AI_API_KEY", "AI_MODEL", "AI_EDIT_MODEL", "AI_BASE_URL"]) if (process.env[`HQ_${k}`]) process.env[k] = process.env[`HQ_${k}`];

const { createAi } = await import("../../server/ai/index.js");
const { initUsageLog, usageSummary } = await import("../../server/ai/usage.js");
const { createMailer } = await import("../../server/mailer.js");
const { createWhmcs } = await import("./whmcs.js");
const { createBuilder } = await import("./builder.js");
const { createNotifier } = await import("./notify.js");
const { createStaff } = await import("./staff.js");
const { STRATEGIES, CALENDAR, SOCIAL_SETUP } = await import("./marketing-plan.js");

const env = process.env;
const PORT = Number(env.HQ_PORT) || 3100;
const HOST = env.HQ_HOST || undefined;
const DATA_DIR = path.resolve(env.HQ_DATA_DIR || path.join(ROOT, "hq-data"));
const BUSINESS = env.BUSINESS_NAME || "EKA Hosting";
const OWNER = env.OWNER_NAME || "";
const PUBLIC_URL = (env.HQ_URL || "").replace(/\/+$/, "");
const SECURE = env.COOKIE_SECURE === "1" || env.NODE_ENV === "production";
await fs.mkdir(DATA_DIR, { recursive: true });

async function secretFile(name, make) {
  const f = path.join(DATA_DIR, name);
  try { return (await fs.readFile(f, "utf8")).trim(); } catch {
    const v = make();
    await fs.writeFile(f, v, { mode: 0o600 });
    return v;
  }
}
const SECRET = env.HQ_SESSION_SECRET || await secretFile(".session-secret", () => crypto.randomBytes(32).toString("hex"));
let PASSWORD = env.HQ_PASSWORD;
if (!PASSWORD) {
  PASSWORD = crypto.randomBytes(9).toString("base64url");
  const f = path.join(ROOT, "hq-settings.txt");
  try {
    const text = await fs.readFile(f, "utf8").catch(async () => fs.readFile(path.join(ROOT, "hq-settings.example.txt"), "utf8"));
    await fs.writeFile(f, /^HQ_PASSWORD=.*$/m.test(text) ? text.replace(/^HQ_PASSWORD=.*$/m, `HQ_PASSWORD=${PASSWORD}`) : `HQ_PASSWORD=${PASSWORD}\n${text}`);
    console.log(`\n  ===================================================\n   Your HQ password is:  ${PASSWORD}\n   (saved in hq-settings.txt; you can change it there)\n  ===================================================\n`);
  } catch { console.log(`\n  Your HQ password for this run is: ${PASSWORD}\n`); }
}

initUsageLog(DATA_DIR);
const ai = createAi();
const mailer = createMailer({ ...env, MAIL_FROM: env.MAIL_FROM || `${BUSINESS} <hello@${(env.BUSINESS_DOMAIN || "localhost")}>` });
const whmcs = createWhmcs({ url: env.WHMCS_URL, identifier: env.WHMCS_IDENTIFIER, secret: env.WHMCS_SECRET, accessKey: env.WHMCS_ACCESS_KEY, adminUser: env.WHMCS_ADMIN_USER });
// The builder's key: from hq-settings.txt, or found automatically when the
// builder is in the same folder (its settings.txt, or the key it made itself).
const { readFileSync } = await import("node:fs");
function builderKey() {
  if (env.BUILDER_API_KEY) return env.BUILDER_API_KEY;
  let dataDir = path.join(ROOT, "data");
  try {
    const text = readFileSync(path.join(ROOT, "settings.txt"), "utf8");
    const get = (k) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
    if (get("HOST_API_KEY")) return get("HOST_API_KEY");
    if (get("DATA_DIR")) dataDir = path.resolve(ROOT, get("DATA_DIR"));
  } catch { /* no builder settings here */ }
  try { return readFileSync(path.join(dataDir, ".host-api-key"), "utf8").trim(); } catch { return ""; }
}
const builder = createBuilder({ url: env.BUILDER_URL || "http://localhost:3000", key: builderKey });
const notifier = createNotifier({ env, mailer });

// What Sam knows: the builder's help pages, your hosting FAQ, and anything in hq-help.txt.
let helpCache = "";
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
async function loadHelp() {
  const parts = [];
  for (const [file, html] of [[path.join(ROOT, "public/help.html"), true], [path.join(HQ_ROOT, "help-hosting.txt"), false], [path.join(ROOT, "hq-help.txt"), false]]) {
    try { const t = await fs.readFile(file, "utf8"); parts.push(html ? `WEBSITE BUILDER HELP:\n${strip(t)}` : t); } catch { /* optional */ }
  }
  helpCache = parts.join("\n\n").slice(0, 90000);
}
await loadHelp();

const staff = createStaff({ dataDir: DATA_DIR, ai, whmcs, builder, mailer, notifier, ownerName: OWNER, publicUrl: PUBLIC_URL, tz: env.TIME_ZONE || "Europe/London", helpText: () => helpCache, business: BUSINESS });
await staff.init();

// ---- login ------------------------------------------------------------------------
const sign = (v) => crypto.createHmac("sha256", SECRET).update(v).digest("base64url");
const COOKIE = "eka_hq";
function makeToken() { const exp = Date.now() + 30 * 86400_000; return `${exp}.${sign(`hq.${exp}`)}`; }
function validToken(t) {
  const [exp, sig] = String(t || "").split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(`hq.${exp}`));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const cookieOf = (req) => (req.headers.cookie || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === COOKIE)?.[1];
const authed = (req) => validToken(cookieOf(req));
const tries = new Map();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback");
app.use(compression());
app.use((req, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY"); res.setHeader("Referrer-Policy", "same-origin"); next(); });
app.use(express.json({ limit: "1mb" }));

app.get("/login", (req, res) => res.sendFile(path.join(HQ_ROOT, "public/login.html")));
app.post("/api/login", (req, res) => {
  const rec = tries.get(req.ip) || { n: 0, at: Date.now() };
  if (Date.now() - rec.at > 15 * 60_000) { rec.n = 0; rec.at = Date.now(); }
  if (rec.n >= 10) return res.status(429).json({ error: "Too many tries. Wait 15 minutes." });
  const given = crypto.createHash("sha256").update(String(req.body?.password || "")).digest();
  const real = crypto.createHash("sha256").update(PASSWORD).digest();
  if (!crypto.timingSafeEqual(given, real)) { rec.n++; tries.set(req.ip, rec); return res.status(401).json({ error: "That password isn't right." }); }
  res.setHeader("Set-Cookie", `${COOKIE}=${makeToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${SECURE ? "; Secure" : ""}`);
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => { res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); res.json({ ok: true }); });
app.get("/favicon.svg", (req, res) => res.type("image/svg+xml").send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0f766e"/><text x="16" y="21" font-size="11" font-weight="800" text-anchor="middle" fill="white" font-family="sans-serif">HQ</text></svg>`));

app.use((req, res, next) => {
  if (authed(req)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Please log in." });
  res.redirect("/login");
});
// CSRF: changes must be JSON (a cross-site form can't send that without permission).
app.use("/api", (req, res, next) => (["GET", "HEAD"].includes(req.method) || req.is("application/json") ? next() : res.status(415).json({ error: "Unsupported request." })));
app.use(express.static(path.join(HQ_ROOT, "public"), { maxAge: 0 }));
app.use("/shared", express.static(path.join(ROOT, "shared"), { maxAge: 0 }));

const api = express.Router();
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => res.status(400).json({ error: err.message }));
const connections = () => ({
  ai: { on: ai.enabled, provider: ai.provider },
  whmcs: { on: whmcs.enabled, admin: whmcs.adminUrl },
  builder: { on: builder.enabled, url: builder.url },
  mail: { on: mailer.enabled },
  notify: { on: notifier.enabled, channels: notifier.channels },
});

api.get("/state", (req, res) => { staff.seen(); res.json({ ...staff.overview(), business: BUSINESS, owner: OWNER, connections: connections() }); });
api.post("/seen", (req, res) => { staff.seen(); res.json({ ok: true }); });
api.get("/activity", (req, res) => res.json({ activity: staff.activityLog(500) }));
api.get("/tasks/recent", (req, res) => res.json({ recent: staff.overview().recent }));

const taskRoute = (fn) => wrap(async (req, res) => {
  if (!/^[a-f0-9]{12}$/.test(req.params.id)) return res.status(404).json({ error: "Not found." });
  const task = await fn(req);
  res.json({ task, state: staff.overview() });
});
const cleanDraft = (d) => {
  if (!d || typeof d !== "object") return undefined;
  const out = {};
  if (typeof d.to === "string") out.to = d.to.trim().slice(0, 200);
  if (typeof d.subject === "string") out.subject = d.subject.replace(/[\r\n]+/g, " ").slice(0, 200);
  if (typeof d.text === "string") out.text = d.text.slice(0, 20000);
  return out;
};
api.post("/tasks/:id/approve", taskRoute((req) => staff.approve(req.params.id, { draft: cleanDraft(req.body?.draft), manual: req.body?.manual === true })));
api.post("/tasks/:id/dismiss", taskRoute((req) => staff.dismiss(req.params.id)));
api.post("/tasks/:id/draft", taskRoute((req) => staff.saveDraft(req.params.id, cleanDraft(req.body?.draft))));
api.post("/tasks/:id/retry", taskRoute((req) => staff.retry(req.params.id)));

api.post("/missions", wrap(async (req, res) => res.json({ task: await staff.newMission(req.body || {}) })));
api.get("/designs", wrap(async (req, res) => res.json({ designs: builder.enabled ? (await builder.overview()).designs : [] })));
api.post("/run/:what", wrap(async (req, res) => {
  const runs = {
    support: () => staff.checkTickets(), ops: () => staff.opsCheck({ domains: true }), account: () => staff.accountRound(),
    marketing: async () => (await staff.marketingWeek()) + (await staff.marketingDaily()), ideas: () => staff.newIdeas(),
    briefing: () => staff.briefing(), meeting: () => staff.meeting(),
  };
  if (!runs[req.params.what]) return res.status(404).json({ error: "Unknown." });
  // Long rounds carry on in the background; the office shows them working.
  const result = await Promise.race([runs[req.params.what](), new Promise((r) => setTimeout(() => r("started"), 1500))]);
  res.json({ ok: true, result: typeof result === "object" ? result : undefined, state: staff.overview() });
}));
api.post("/settings", (req, res) => res.json({ settings: staff.setSettings(req.body) }));

api.get("/stats", wrap(async (req, res) => {
  const s = await staff.stats({ fresh: req.query.fresh === "1" });
  const month = new Date().toISOString().slice(0, 7);
  const ai = await usageSummary({ since: `${month}-01` }).catch(() => null);
  res.json({ ...s, aiSpend: ai ? ai.total?.cost ?? null : null });
}));

// Customers (WHMCS, with their websites from the builder).
api.get("/customers", wrap(async (req, res) => {
  const sites = builder.enabled ? (await builder.overview().catch(() => ({ sites: [] }))).sites : [];
  const sitesFor = (email) => sites.filter((s) => s.owner?.email && s.owner.email.toLowerCase() === String(email).toLowerCase()).map((s) => ({ id: s.id, name: s.name, live: !!s.publishedAt, url: s.url }));
  if (!whmcs.enabled) {
    const owners = new Map();
    for (const s of sites.filter((x) => x.owner)) owners.set(s.owner.email, { id: s.owner.id, email: s.owner.email, name: s.owner.name, plan: s.owner.plan, status: s.owner.disabled ? "Suspended" : "Active" });
    return res.json({ source: "builder", total: owners.size, customers: [...owners.values()].map((c) => ({ ...c, sites: sitesFor(c.email) })) });
  }
  const { total, clients } = await whmcs.clients({ search: String(req.query.q || "").slice(0, 100), offset: Math.max(0, Number(req.query.offset) || 0), limit: 50 });
  res.json({ source: "whmcs", total, customers: clients.map((c) => ({ id: c.id, name: `${c.firstname} ${c.lastname}`.trim(), company: c.companyname, email: c.email, status: c.status, since: c.datecreated, sites: sitesFor(c.email) })) });
}));
api.get("/customers/:id", wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!whmcs.enabled || !id) return res.status(404).json({ error: "Connect WHMCS to see customer details." });
  const [c, p, inv, tickets] = await Promise.all([whmcs.client(id), whmcs.products({ clientId: id }), whmcs.invoices({ clientId: id, limit: 25 }), whmcs.call("GetTickets", { clientid: id, limitnum: 15 }).then((d) => d.tickets?.ticket || []).catch(() => [])]);
  const sites = builder.enabled ? (await builder.overview().catch(() => ({ sites: [] }))).sites.filter((s) => s.owner?.email?.toLowerCase() === String(c.email).toLowerCase()) : [];
  res.json({
    customer: { id, name: c.fullname || `${c.firstname} ${c.lastname}`, company: c.companyname, email: c.email, phone: c.phonenumber, address: [c.address1, c.city, c.postcode, c.country].filter(Boolean).join(", "), status: c.status, since: c.datecreated, credit: c.credit, stats: c.stats || {}, link: `${whmcs.adminUrl}/clientssummary.php?userid=${id}` },
    products: p.products.map((x) => ({ id: x.id, name: x.name, domain: x.domain, status: x.status, amount: x.recurringamount, cycle: x.billingcycle, next: x.nextduedate, server: x.servername })),
    invoices: inv.map((i) => ({ id: i.id, num: i.invoicenum || i.id, total: i.total, status: i.status, due: i.duedate })),
    tickets: tickets.map((t) => ({ id: t.id, tid: t.tid, subject: t.subject, status: t.status, last: t.lastreply })),
    sites: sites.map((s) => ({ id: s.id, name: s.name, live: !!s.publishedAt, url: s.url, editor: `${builder.url}/admin/sites/${s.id}` })),
  });
}));
api.post("/customers/:id/services/:sid/:action", wrap(async (req, res) => {
  const sid = Number(req.params.sid);
  if (!sid || !["suspend", "unsuspend"].includes(req.params.action)) return res.status(404).json({ error: "Unknown." });
  if (req.params.action === "suspend") await whmcs.suspend(sid, String(req.body?.reason || "Suspended from HQ").slice(0, 200));
  else await whmcs.unsuspend(sid);
  res.json({ ok: true });
}));

api.get("/meetings", (req, res) => res.json({ meetings: staff.meetings(), briefings: staff.briefings() }));
api.get("/marketing", (req, res) => res.json({ strategies: STRATEGIES, calendar: CALENDAR, social: SOCIAL_SETUP, ideas: staff.ideas() }));
api.post("/ideas", wrap((req, res) => res.json({ idea: staff.addIdea(req.body || {}) })));
api.post("/ideas/:id", wrap((req, res) => res.json({ idea: staff.setIdea(req.params.id, req.body || {}) })));

api.post("/notify/test", wrap(async (req, res) => {
  if (!notifier.enabled) return res.status(400).json({ error: "No phone messages set up yet: add NTFY_TOPIC (or Telegram) to hq-settings.txt and restart HQ." });
  const r = await notifier.send({ title: "Henry: testing, testing", text: "If you can read this, I can reach your phone. I'll message you when something needs you and you're not in the office.", url: PUBLIC_URL });
  if (!r.sent.length) return res.status(400).json({ error: r.errors.join("; ") });
  res.json({ sent: r.sent, errors: r.errors });
}));
// EKA Hosting's own website, made in the builder so it can be edited there.
api.post("/website/create", wrap(async (req, res) => {
  if (!builder.enabled) return res.status(400).json({ error: "Connect the builder first." });
  const { ekaWebsite } = await import("../../shared/eka-website.js");
  const images = {};
  for (const f of ["builder-editor.webp", "builder-wizard.webp"]) {
    try { images[f] = (await fs.readFile(path.join(HQ_ROOT, "website", f))).toString("base64"); } catch { /* optional */ }
  }
  const site = ekaWebsite({ name: BUSINESS, images: { editor: images["builder-editor.webp"] ? "hq-image:builder-editor.webp" : "", wizard: images["builder-wizard.webp"] ? "hq-image:builder-wizard.webp" : "" } });
  const out = await builder.importSite({ name: BUSINESS, site, images, prompt: "UK web hosting company with an AI website builder, done-for-you websites and the builder for other hosting companies", formEmail: env.OWNER_EMAIL || "" });
  staff.setSettings({ marketing: { siteId: out.site.id } });
  res.json({ editor: out.editor, siteId: out.site.id });
}));
api.get("/notify/telegram-id", wrap(async (req, res) => res.json({ chatId: await notifier.telegramChatId() })));

app.use("/api", api);
app.get(["/", "/office", "/approvals", "/activity", "/numbers", "/customers", "/meetings", "/marketing", "/settings"], (req, res) => res.sendFile(path.join(HQ_ROOT, "public/index.html")));

// ---- schedule ---------------------------------------------------------------------
setTimeout(() => staff.tick(), 20_000).unref?.();
setInterval(() => staff.tick(), 5 * 60_000).unref?.();
setInterval(() => staff.sendNotes(), 60_000).unref?.();

function listen(port, left = 10) {
  const server = app.listen(port, HOST, () => {
    console.log(`EKA HQ running on http://localhost:${port}`);
    const c = connections();
    console.log(`  AI: ${c.ai.on ? c.ai.provider : "off"} · WHMCS: ${c.whmcs.on ? "connected" : "not set up"} · Builder: ${c.builder.on ? c.builder.url : "not set up"} · Phone messages: ${c.notify.on ? c.notify.channels.join(", ") : "not set up"}`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && left > 0) return listen(port + 1, left - 1);
    console.error(`Could not start HQ: ${err.message}`);
    process.exit(1);
  });
}
listen(PORT);
