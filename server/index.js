// EKA Hosting: AI website builder + static hosting for customer sites.
//
// One Node process serves three things, chosen by the request's Host header:
//   1. Customer sites on <slug>.<BASE_DOMAIN> or their own custom domain
//   2. The builder (admin dashboard + editor) on any other host, under /admin
//   3. Shared endpoints on every host: /_m (media) and /_forms (contact forms)

import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import express from "express";
import compression from "compression";

import { Store } from "./store.js";
import { createAuth } from "./auth.js";
import { Users, publicUser } from "./users.js";
import { createLicence } from "./licence.js";
import { createBackups } from "./backup.js";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createAi, applyBrief } from "./ai/index.js";
import { usageContext, initUsageLog, usageSummary, loadMonthTotals, accountCostThisMonth, accountUsage } from "./ai/usage.js";
import { startJob, getJob, publicJob } from "./jobs.js";
import { saveUpload, deleteUpload } from "./media.js";
import { buildStaticSite } from "./export.js";
import { buildCubecartSkin } from "./cubecart-skin.js";
import { fillPlaceholders } from "./placeholders.js";
import { createStock, fillStockPhotos, fillOwnerPhotos, keywordsFromBrief } from "./stock.js";
import { deploy, testConnection } from "./deploy.js";
import { createMailer } from "./mailer.js";
import { ownerEmail, visitorEmail } from "./form-mail.js";
import yazl from "yazl";
import { renderPage, pageUrl, pageAtPath, sitemapXml } from "../shared/render.js";
import { STYLE_CHOICES } from "./ai/prompts.js";
import { createEmptySite, normalizeSite, normalizePage, findNode, slugify } from "../shared/schema.js";
import { ensurePrivacyPage } from "../shared/legal.js";
import { LANGUAGES } from "../shared/i18n.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Settings can live in a plain text file next to the code (settings.txt, made
// from settings.example.txt by start-windows.bat) or in .env. Real environment
// variables always win over the file.
for (const name of ["settings.txt", ".env"]) {
  try {
    process.loadEnvFile(path.join(ROOT, name));
    break;
  } catch {
    // File not there: fine, use the environment.
  }
}

// A password that's easy to read out but hard to guess: four groups of four
// letters/digits, without look-alikes such as 0/O and 1/l.
function randomPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const s = Array.from({ length: 16 }, () => chars[crypto.randomInt(chars.length)]).join("");
  return s.match(/.{4}/g).join("-");
}

// First run from settings.example.txt: swap the shared "change-me" password
// for a random one, save it in settings.txt and show it.
if (process.env.ADMIN_PASSWORD === "change-me") {
  const file = path.join(ROOT, "settings.txt");
  try {
    const text = await fs.readFile(file, "utf8");
    const pw = randomPassword();
    await fs.writeFile(file, text.replace(/^(ADMIN_PASSWORD=)change-me(?=[ \t\r]*$)/m, `$1${pw}`));
    process.env.ADMIN_PASSWORD = pw;
    console.log(`\n  ===================================================\n   Your builder password is:  ${pw}\n   (saved in settings.txt; you can change it there)\n  ===================================================\n`);
  } catch {
    // No settings.txt (password came from the environment): leave it.
  }
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || undefined; // e.g. 127.0.0.1 = only this computer
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const BASE_DOMAIN = (process.env.BASE_DOMAIN || "").toLowerCase().replace(/^\.+/, "");

// Demo mode: anyone can try the builder without a password, in their own
// workspace. Publishing and FTP are off, AI use is capped, and demo sites
// are deleted after DEMO_HOURS.
const DEMO = /^(1|true|yes)$/i.test(process.env.DEMO_MODE || "");
const DEMO_HOURS = Number(process.env.DEMO_HOURS) || 24;
const DEMO_SITES = Number(process.env.DEMO_SITES) || 3;
const DEMO_AI = Number(process.env.DEMO_AI_PER_VISITOR) || 15;
const DEMO_AI_DAILY = Number(process.env.DEMO_AI_PER_DAY) || 300;
const SUPPORT_EMAIL = (process.env.SUPPORT_EMAIL || "").trim();
const VERSION = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8")).version;
const SECURE_COOKIES = process.env.COOKIE_SECURE === "1" || process.env.NODE_ENV === "production";

await fs.mkdir(DATA_DIR, { recursive: true });

async function readOrCreateSecret(file, make) {
  try {
    return (await fs.readFile(file, "utf8")).trim();
  } catch {
    const value = make();
    await fs.writeFile(file, value + "\n", { mode: 0o600 });
    return value;
  }
}

const SESSION_SECRET = process.env.SESSION_SECRET || (await readOrCreateSecret(path.join(DATA_DIR, ".session-secret"), () => crypto.randomBytes(32).toString("hex")));
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = await readOrCreateSecret(path.join(DATA_DIR, ".admin-password"), () => crypto.randomBytes(9).toString("base64url"));
  console.log(`\n  No ADMIN_PASSWORD set. Log in with: ${ADMIN_PASSWORD}\n  (stored in ${path.join(DATA_DIR, ".admin-password")}; set ADMIN_PASSWORD to choose your own)\n`);
}

// The key control panels and billing systems use to manage customers (see
// the host API below). Set HOST_API_KEY, or one is made and shown on the
// Customers page.
const HOST_API_KEY = process.env.HOST_API_KEY || (await readOrCreateSecret(path.join(DATA_DIR, ".host-api-key"), () => crypto.randomBytes(24).toString("base64url")));
// The builder's public address, for links made by the host API (else taken from the request).
const BUILDER_URL = (process.env.BUILDER_URL || "").replace(/\/+$/, "");

const store = new Store(DATA_DIR);
await store.init();
const users = new Users(DATA_DIR);
await users.init();
const auth = createAuth({ password: ADMIN_PASSWORD, secret: SESSION_SECRET, secure: SECURE_COOKIES, users });
const licence = await createLicence({
  dataDir: DATA_DIR,
  version: VERSION,
  // Sent with each licence check: counts only, never customers' details.
  stats: () => ({ sites: store.list().filter((m) => !m.demo).length, customers: users.list().length }),
});
const ai = createAi();

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY === "true" ? true : process.env.TRUST_PROXY);
app.use(compression());

// ---------------------------------------------------------------------------
// Host routing
// ---------------------------------------------------------------------------

function siteForHost(req) {
  const host = (req.hostname || "").toLowerCase();
  if (BASE_DOMAIN && host.endsWith(`.${BASE_DOMAIN}`)) {
    const sub = host.slice(0, -BASE_DOMAIN.length - 1);
    if (["www", "admin", "app"].includes(sub)) return null;
    return store.findBySlug(sub) || { missing: true };
  }
  if (BASE_DOMAIN && (host === BASE_DOMAIN || host === `www.${BASE_DOMAIN}`)) return null;
  return store.findByDomain(host);
}

function liveUrl(meta) {
  if (meta.domains?.length) return `https://${meta.domains[0]}/`;
  if (BASE_DOMAIN) return `https://${meta.slug}.${BASE_DOMAIN}/`;
  return `/s/${meta.slug}/`;
}

// ---------------------------------------------------------------------------
// Rendering published sites (with a small in-memory cache)
// ---------------------------------------------------------------------------

const pageCache = new Map();
const CACHE_LIMIT = 500;

function cachedRender(key, render) {
  let hit = pageCache.get(key);
  if (!hit) {
    const html = render();
    hit = { html, etag: `"${crypto.createHash("sha1").update(html).digest("base64url")}"` };
    if (pageCache.size >= CACHE_LIMIT) pageCache.delete(pageCache.keys().next().value);
    pageCache.set(key, hit);
  }
  return hit;
}

// Draft blog posts only show in the editor's previews.
function findPage(site, rest, { drafts = false } = {}) {
  const page = pageAtPath(site, rest);
  return page && (!page.post?.draft || drafts) ? page : null;
}

async function serveSite(req, res, meta, { base, rest, draft = false, sandbox = false, origin = `${req.protocol}://${req.get("host")}`, live = false, review = false }) {
  if (meta.suspended && !draft) return res.status(503).type("html").send(simplePage("Website unavailable", "This website is temporarily unavailable."));
  const site = draft ? await store.getDraft(meta.id) : await store.getPublished(meta.id);
  if (sandbox) {
    // Previews on the builder's own domain share its origin, so block any
    // custom scripts from running there. Live domains are unaffected.
    res.setHeader("Content-Security-Policy", "sandbox allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin");
  }
  if (!site) {
    return res.status(404).type("html").send(simplePage("Coming soon", "This website hasn't been published yet."));
  }
  const page = findPage(site, rest, { drafts: draft });
  if (!page) {
    const home = site.pages[0];
    return res.status(404).type("html").send(simplePage("Page not found", `<a href="${base}">Go to the ${escapeHtml(home.title)} page</a>`));
  }
  const formAction = `/_forms/${meta.id}`;
  // On the site's own address, tell search engines the page's one true URL.
  const canonical = live ? origin + pageUrl(page, "/") : undefined;
  if (review) {
    // The customer review page: the draft, marked up so comments can be pinned.
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    return res.type("html").send(renderPage(site, page, { base, formAction, origin, review: true }));
  }
  if (draft) {
    res.setHeader("Cache-Control", "no-store");
    // Draft previews get a bar on top so it's obvious how to get back. Plain
    // HTML only: previews block scripts.
    const bar = `<div style="position:relative;z-index:60;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 16px;background:#1c2230;color:#fff;font:600 14px/1.4 system-ui,sans-serif"><span>Preview: this is how visitors will see your latest changes.</span><a href="/admin/sites/${meta.id}" style="margin-left:auto;background:#4f46e5;color:#fff;padding:6px 14px;border-radius:6px;text-decoration:none">&larr; Back to editor</a></div>`;
    return res.type("html").send(renderPage(site, page, { base, formAction, origin }).replace("<body>", `<body>${bar}`));
  }
  const key = `${meta.id}|${meta.publishedAt}|${origin}|${base}|${page.slug}`;
  const { html, etag } = cachedRender(key, () => renderPage(site, page, { base, formAction, origin, canonical }));
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=600");
  if (req.headers["if-none-match"] === etag) return res.status(304).end();
  res.type("html").send(html);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function simplePage(title, body) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#222;text-align:center;padding:20px}h1{font-size:1.6rem}</style><div><h1>${escapeHtml(title)}</h1><p>${body}</p></div>`;
}

// ---------------------------------------------------------------------------
// Shared endpoints (every host)
// ---------------------------------------------------------------------------

// Images uploaded in the new-site wizard before the site exists (admin only).
initUsageLog(DATA_DIR);
await loadMonthTotals();

// Daily backups of the data folder (and restoring them).
const backups = createBackups({
  dataDir: DATA_DIR,
  backupDir: process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : undefined,
  keep: Number(process.env.BACKUP_KEEP) || 7,
  onRestored: async () => {
    await store.init();
    await users.init();
    await loadMonthTotals();
    pageCache.clear();
  },
});
setTimeout(() => backups.daily(), 60_000).unref();
setInterval(() => backups.daily(), 3600_000).unref();
const stock = createStock();

// Empty picture spots get matching stock photos where possible, and
// placeholder artwork otherwise.
async function fillImages(site, { dir, urlPrefix, brief, avoid }) {
  // The owner's photos first, then stock photos, then placeholder artwork.
  fillOwnerPhotos(site, brief?.photos, { avoid });
  await fillStockPhotos(site, { stock, dir, urlPrefix, avoid, keywords: keywordsFromBrief(brief || { name: site.name }) });
  await fillPlaceholders(site, { dir, urlPrefix });
  return site;
}
const TMP_MEDIA = path.join(DATA_DIR, "tmp-media");
await fs.mkdir(TMP_MEDIA, { recursive: true });
app.get("/_tmp/:file", (req, res) => {
  if (!auth.isAuthed(req) || !/^[\w.-]+$/.test(req.params.file) || req.params.file.startsWith(".")) return res.sendStatus(404);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(path.join(TMP_MEDIA, req.params.file), (err) => { if (err && !res.headersSent) res.sendStatus(404); });
});

app.get("/_m/:siteId/:file", async (req, res) => {
  const { siteId, file } = req.params;
  if (!store.getMeta(siteId) || !/^[\w.-]+$/.test(file) || file.startsWith(".")) return res.sendStatus(404);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.sendFile(path.join(store.mediaDir(siteId), file), { maxAge: "365d", immutable: true }, (err) => {
    if (err && !res.headersSent) res.sendStatus(404);
  });
});

const mailer = createMailer();
const formHits = new Map();
app.post("/_forms/:siteId", express.urlencoded({ extended: false, limit: "64kb" }), async (req, res) => {
  const meta = store.getMeta(req.params.siteId);
  const site = meta && (await store.getPublished(meta.id));
  if (!site) return res.sendStatus(404);

  const body = req.body || {};
  const page = pageAtPath(site, String(body._page || "")) || site.pages[0];
  const pagePath = pageUrl(page, "/").slice(1);
  const onSiteHost = !!siteForHost(req);
  const base = onSiteHost ? "/" : `/s/${meta.slug}/`;
  const backTo = (hash) => res.redirect(303, `${base}${pagePath}${hash}`);

  // Honeypot: bots fill the hidden "website" field. Pretend it worked.
  if (body.website) return backTo(`#sent-${encodeURIComponent(body._block || "")}`);

  // Basic per-IP rate limit: 5 submissions per 10 minutes.
  const now = Date.now();
  const hits = (formHits.get(req.ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (hits.length >= 5) return res.status(429).type("html").send(simplePage("Slow down", "Too many messages. Please try again in a few minutes."));
  hits.push(now);
  formHits.set(req.ip, hits);

  const found = body._block ? findNode(site, String(body._block)) : null;
  const formBlock = found && found.kind === "block" && found.node.type === "form" ? found.node : null;
  const fields = {};
  let visitor = "";
  // Newsletter sign-ups: just an email, kept with the messages.
  if (found?.kind === "block" && found.node.type === "newsletter") {
    const email = String(body.field_0 || "").trim().slice(0, 200);
    if (!/^[^\s@<>",;]+@[^\s@<>",;]+\.[a-z]{2,}$/i.test(email)) return backTo(`#f-${encodeURIComponent(found.node.id)}`);
    await store.addSubmission(meta.id, { id: crypto.randomBytes(6).toString("hex"), at: new Date().toISOString(), page: page.slug, kind: "newsletter", fields: { Email: email } });
    return backTo(`#sent-${encodeURIComponent(found.node.id)}`);
  }
  if (formBlock) {
    formBlock.props.fields.forEach((f, i) => {
      const value = String(body[`field_${i}`] ?? "").slice(0, 5000);
      fields[f.label || `Field ${i + 1}`] = value;
      if (!visitor && f.type === "email" && /^[^\s@<>",;]+@[^\s@<>",;]+\.[a-z]{2,}$/i.test(value.trim())) visitor = value.trim();
    });
  }
  if (!Object.values(fields).some((v) => v.trim())) return backTo(`#f-${encodeURIComponent(body._block || "")}`);

  const kind = formBlock.props.kind || "contact";
  await store.addSubmission(meta.id, { id: crypto.randomBytes(6).toString("hex"), at: new Date().toISOString(), page: page.slug, kind, fields });
  backTo(`#sent-${encodeURIComponent(formBlock.id)}`);

  // Email the owner (and the visitor a copy, if the form asks) after answering.
  const owner = store.getMeta(meta.id).formEmail || site.business?.email || "";
  const lines = Object.entries(fields).filter(([, v]) => v.trim());
  if (mailer.enabled && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)) {
    const mail = ownerEmail({ kind, siteName: site.name, lines, page: page.title });
    mailer.send({ to: owner, subject: mail.subject, text: mail.body, replyTo: visitor, fromName: `${site.name} website` }).catch((err) => console.warn("Form email not sent:", err.message));
    if (formBlock.props.confirmEmail && visitor) {
      const deposit = /^https:\/\//.test(formBlock.props.depositLink || "") ? { link: formBlock.props.depositLink, text: formBlock.props.depositText } : null;
      const copy = visitorEmail({ kind, siteName: site.name, lines, deposit });
      mailer.send({ to: visitor, subject: copy.subject, text: copy.body, replyTo: owner, fromName: site.name }).catch((err) => console.warn("Visitor copy not sent:", err.message));
    }
  }
});

// Caddy asks this before issuing an on-demand HTTPS certificate, so
// certificates are only created for domains that belong to a site.
app.get("/_tls-check", (req, res) => {
  const domain = String(req.query.domain || "").toLowerCase();
  const fakeReq = { hostname: domain };
  const meta = domain && siteForHost(fakeReq);
  const isBuilder = BASE_DOMAIN && (domain === BASE_DOMAIN || domain === `admin.${BASE_DOMAIN}` || domain === `www.${BASE_DOMAIN}`);
  res.sendStatus((meta && !meta.missing) || isBuilder ? 200 : 404);
});

// ---------------------------------------------------------------------------
// Customer sites on their own host
// ---------------------------------------------------------------------------

app.use((req, res, next) => {
  const meta = siteForHost(req);
  if (!meta) return next();
  if (meta.missing) return res.status(404).type("html").send(simplePage("Site not found", "There's no website at this address yet."));
  if (req.method !== "GET" && req.method !== "HEAD") return res.sendStatus(405);
  const origin = `${req.protocol}://${req.get("host")}`;
  if (req.path === "/robots.txt") return res.type("text").send(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
  if (req.path === "/sitemap.xml") {
    return store.getPublished(meta.id).then((site) => (site ? res.type("application/xml").send(sitemapXml(site, origin)) : res.sendStatus(404))).catch(next);
  }
  serveSite(req, res, meta, { base: "/", rest: req.path, origin, live: true }).catch(next);
});

// ---------------------------------------------------------------------------
// Builder: public previews and admin app
// ---------------------------------------------------------------------------

app.get(["/s/:slug", "/s/:slug/*"], (req, res, next) => {
  const meta = store.findBySlug(req.params.slug);
  if (!meta) return res.status(404).type("html").send(simplePage("Site not found", "There's no website at this address."));
  if (!req.params[0] && !req.path.endsWith("/")) return res.redirect(301, `/s/${meta.slug}/`);
  serveSite(req, res, meta, { base: `/s/${meta.slug}/`, rest: req.params[0], sandbox: true }).catch(next);
});

app.get("/", (req, res) => res.redirect("/admin"));
app.get("/admin/login", (req, res) => res.sendFile(path.join(ROOT, "public/admin/login.html")));
app.get("/admin/reset", (req, res) => res.sendFile(path.join(ROOT, "public/admin/reset.html")));
// One-time sign-in links (control panels, "open as customer").
app.get("/login/link", async (req, res, next) => {
  try {
    const user = await auth.useLoginLink(req, res, String(req.query.t || ""));
    if (!user) return res.status(400).type("html").send(simplePage("Link expired", 'This sign-in link has expired or was already used. Open the builder again from your control panel, or <a href="/admin/login">log in</a>.'));
    res.redirect(303, "/admin");
  } catch (err) { next(err); }
});
// Customer review links: the draft site plus comments and an Approve button, no login.
app.get("/review/:token", (req, res) => {
  if (!store.findByReviewToken(req.params.token)) return res.status(404).type("html").send(simplePage("Link not found", "This review link has been turned off or doesn't exist."));
  res.setHeader("X-Robots-Tag", "noindex");
  res.sendFile(path.join(ROOT, "public/review.html"));
});
app.get(["/review/:token/frame", "/review/:token/frame/*"], (req, res, next) => {
  const meta = store.findByReviewToken(req.params.token);
  if (!meta) return res.sendStatus(404);
  serveSite(req, res, meta, { base: `/review/${req.params.token}/frame/`, rest: req.params[0], draft: true, sandbox: true, review: true }).catch(next);
});
app.get("/help", (req, res) => res.sendFile(path.join(ROOT, "public/help.html")));
app.get("/support", (req, res) => res.sendFile(path.join(ROOT, "public/support.html")));
app.get("/api/public-info", (req, res) => res.json({ demo: DEMO, supportEmail: SUPPORT_EMAIL, version: VERSION }));
app.get("/admin", auth.requirePage, (req, res) => res.sendFile(path.join(ROOT, "public/admin/dashboard.html")));
app.get("/admin/customers", auth.requirePage, (req, res) => (req.user.role === "admin" ? res.sendFile(path.join(ROOT, "public/admin/customers.html")) : res.redirect("/admin")));
app.get("/admin/new", auth.requirePage, (req, res) => res.sendFile(path.join(ROOT, "public/admin/new.html")));
app.get("/admin/sites/:id", auth.requirePage, (req, res) => res.sendFile(path.join(ROOT, "public/admin/editor.html")));
app.get(["/admin/preview/:id", "/admin/preview/:id/*"], auth.requirePage, (req, res, next) => {
  const meta = store.getMeta(req.params.id);
  if (!meta || !canSee(req.user, meta)) return res.sendStatus(404);
  if (!req.params[0] && !req.path.endsWith("/")) return res.redirect(`/admin/preview/${meta.id}/`);
  serveSite(req, res, meta, { base: `/admin/preview/${meta.id}/`, rest: req.params[0], draft: true, sandbox: true }).catch(next);
});
app.use("/admin/assets", auth.requirePage, express.static(path.join(ROOT, "public/admin/assets"), { maxAge: 0 }));
app.use("/admin/shared", auth.requirePage, express.static(path.join(ROOT, "shared"), { maxAge: 0 }));
app.use("/admin/login-assets", express.static(path.join(ROOT, "public/admin/login-assets")));

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

const api = express.Router();
api.use(express.json({ limit: "8mb" }));

// CSRF guard: state-changing calls must be JSON or carry our custom header,
// which a cross-site form can't do without a CORS preflight.
api.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.is("application/json") || req.get("X-EKA-Request") === "1") return next();
  res.status(415).json({ error: "Unsupported request." });
});

api.post("/login", (req, res, next) => auth.login(req, res).catch(next));

// "Forgot your password?": a link by email (when the server can send email).
api.post("/password/forgot", async (req, res) => {
  const user = users.byEmail(req.body?.email);
  if (!mailer.enabled) return res.status(400).json({ error: SUPPORT_EMAIL ? `Ask your hosting provider (${SUPPORT_EMAIL}) to reset it for you.` : "Ask your hosting provider to reset it for you." });
  if (user && !user.disabled) {
    const link = `${req.protocol}://${req.get("host")}/admin/reset?t=${encodeURIComponent(auth.resetLink(user))}`;
    mailer.send({ to: user.email, subject: "Reset your website builder password", text: `Someone (hopefully you) asked to reset your password.\n\nChoose a new one here (the link works for an hour):\n${link}\n\nIf it wasn't you, ignore this email; your password hasn't changed.` })
      .catch((err) => console.warn("Reset email not sent:", err.message));
  }
  // The same answer either way, so this can't be used to find out who has an account.
  res.json({ ok: true });
});

api.post("/password/reset", async (req, res) => {
  const user = auth.readResetLink(String(req.body?.token || ""));
  if (!user) return res.status(400).json({ error: "This link has expired or was already used. Ask for a new one." });
  try {
    await users.setPassword(user.id, String(req.body?.password || ""));
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
api.post("/logout", (req, res) => auth.logout(req, res));
api.post("/demo/start", (req, res) => {
  if (!DEMO) return res.status(404).json({ error: "The demo isn't switched on here." });
  auth.startDemo(req, res, DEMO_HOURS * 3600);
  res.json({ ok: true });
});
// ---- host API: control panels and billing systems ------------------------------
//
// Authorization: Bearer <HOST_API_KEY>. Customers are matched by "account",
// the panel's own reference (e.g. "cpanel:server1:bob"), then by email.
//   POST /api/host/sso       { account, email, name?, plan? } → { url } one-time sign-in link (creates the customer if new)
//   POST /api/host/accounts  { account, email, name?, plan? } → creates or updates
//   POST /api/host/accounts/suspend | unsuspend | terminate  { account, keepSites? }
//   GET  /api/host/accounts?account=…  → the customer, their plan and usage
//   GET  /api/host/plans     → plans (ids for "plan")

const hostHits = new Map();
function hostAuthed(req, res) {
  const now = Date.now();
  const rec = hostHits.get(req.ip) || { bad: 0, since: now };
  if (now - rec.since > 15 * 60 * 1000) { rec.bad = 0; rec.since = now; }
  if (rec.bad > 20) { res.status(429).json({ error: "Too many bad keys. Try again later." }); return false; }
  const given = String(req.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const a = crypto.createHash("sha256").update(given).digest(), b = crypto.createHash("sha256").update(HOST_API_KEY).digest();
  if (given && crypto.timingSafeEqual(a, b)) return true;
  rec.bad++;
  hostHits.set(req.ip, rec);
  res.status(401).json({ error: "Wrong or missing API key." });
  return false;
}

const publicBase = (req) => BUILDER_URL || `${req.protocol}://${req.get("host")}`;
const hostRef = (body) => String(body?.account || "").trim().slice(0, 200);
const findHostCustomer = (body) => (hostRef(body) && users.byExternal(hostRef(body))) || users.byEmail(body?.email);
const planFor = (v) => (v === undefined || v === null || v === "" ? undefined : users.plan(String(v))?.id || users.plans().find((p) => p.name.toLowerCase() === String(v).toLowerCase())?.id);

async function upsertHostCustomer(body) {
  let user = findHostCustomer(body);
  const plan = planFor(body?.plan);
  if (body?.plan !== undefined && body?.plan !== "" && !plan) throw new Error(`No plan called "${body.plan}". Plans: ${users.plans().map((p) => p.id).join(", ")}.`);
  if (!user) {
    if (!licence.status().allowed) throw new Error("New customers are paused: this builder's licence needs renewing.");
    if (!body?.email) throw new Error("Give the customer's email.");
    user = (await users.create({ email: body.email, name: body.name || "", plan, external: hostRef(body) })).user;
  } else {
    await users.update(user.id, { ...(plan ? { plan } : {}), ...(body.name ? { name: body.name } : {}), ...(hostRef(body) && !user.external ? { external: hostRef(body) } : {}) });
  }
  return users.get(user.id);
}

const host = express.Router();
host.use(express.json({ limit: "64kb" }));
host.use((req, res, next) => (hostAuthed(req, res) ? next() : undefined));
host.post("/sso", async (req, res) => {
  try {
    const user = await upsertHostCustomer(req.body);
    if (user.disabled) return res.status(403).json({ error: "This customer is suspended." });
    res.json({ url: `${publicBase(req)}/login/link?t=${encodeURIComponent(auth.loginLink(user, 120))}` });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
host.post("/accounts", async (req, res) => {
  try { res.json({ customer: customerRow(await upsertHostCustomer(req.body)) }); } catch (err) { res.status(400).json({ error: err.message }); }
});
host.get("/accounts", (req, res) => {
  const user = findHostCustomer({ account: req.query.account, email: req.query.email });
  if (!user) return res.status(404).json({ error: "No such customer." });
  res.json({ customer: customerRow(user) });
});
for (const action of ["suspend", "unsuspend", "terminate"]) {
  host.post(`/accounts/${action}`, async (req, res) => {
    const user = findHostCustomer(req.body);
    if (!user) return res.status(404).json({ error: "No such customer." });
    if (action === "terminate") {
      for (const meta of store.list().filter((m) => m.owner === user.id && !m.demo)) {
        if (req.body?.keepSites) await store.updateMeta(meta.id, { owner: undefined });
        else await store.remove(meta.id);
      }
      await users.remove(user.id);
      pageCache.clear();
      return res.json({ ok: true });
    }
    // Suspended customers can't log in; their live websites stay online
    // unless takeSitesOffline is set.
    await users.update(user.id, { disabled: action === "suspend" });
    if (action === "suspend" && req.body?.takeSitesOffline) for (const meta of store.list().filter((m) => m.owner === user.id && m.publishedAt)) await store.updateMeta(meta.id, { suspended: true });
    if (action === "unsuspend") for (const meta of store.list().filter((m) => m.owner === user.id && m.suspended)) await store.updateMeta(meta.id, { suspended: false });
    pageCache.clear();
    res.json({ ok: true });
  });
}
host.get("/plans", (req, res) => res.json({ plans: users.plans() }));
app.use("/api/host", host);

// ---- customer review (public, by link) ----------------------------------------

const reviewHits = new Map();
function reviewTooFast(req) {
  const key = `${req.ip}|${req.params.token}`;
  const now = Date.now();
  const rec = reviewHits.get(key) || { n: 0, since: now };
  if (now - rec.since > 3600_000) { rec.n = 0; rec.since = now; }
  rec.n++;
  reviewHits.set(key, rec);
  return rec.n > 60;
}
const publicComment = (c) => ({ id: c.id, at: c.at, page: c.page, nodeId: c.nodeId, text: c.text, name: c.name });

api.get("/review/:token", async (req, res) => {
  const meta = store.findByReviewToken(req.params.token);
  if (!meta) return res.status(404).json({ error: "This review link has been turned off." });
  const site = await store.getDraft(meta.id);
  const comments = (await store.getComments(meta.id)).filter((c) => !c.resolved).map(publicComment);
  res.json({ name: site?.name || meta.name, pages: (site?.pages || []).map((p) => ({ slug: p.slug, title: p.title })), comments, approval: meta.approval || null });
});

api.post("/review/:token/comments", async (req, res) => {
  const meta = store.findByReviewToken(req.params.token);
  if (!meta) return res.status(404).json({ error: "This review link has been turned off." });
  if (reviewTooFast(req)) return res.status(429).json({ error: "That's a lot of comments! Please wait a while and try again." });
  const text = String(req.body?.text || "").trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: "Write a comment first." });
  const comment = {
    id: crypto.randomBytes(6).toString("hex"),
    at: new Date().toISOString(),
    page: String(req.body?.page || "index").slice(0, 80),
    nodeId: /^[\w-]{1,40}$/.test(req.body?.nodeId || "") ? req.body.nodeId : null,
    text,
    name: String(req.body?.name || "").trim().slice(0, 80) || "Customer",
    resolved: false,
  };
  await store.updateComments(meta.id, (list) => [...list, comment].slice(-500));
  res.json({ comment: publicComment(comment) });
});

api.post("/review/:token/approve", async (req, res) => {
  const meta = store.findByReviewToken(req.params.token);
  if (!meta) return res.status(404).json({ error: "This review link has been turned off." });
  if (reviewTooFast(req)) return res.status(429).json({ error: "Please wait a moment and try again." });
  const approval = { at: new Date().toISOString(), name: String(req.body?.name || "").trim().slice(0, 80) || "Customer" };
  await store.updateMeta(meta.id, { approval });
  res.json({ approval });
});

api.use(auth.requireApi);
// Tag every AI call with who made it and, below, which website it's for.
const wizardId = (req) => (/^[a-f0-9]{16}$/.test(req.get("X-EKA-Wizard") || "") ? req.get("X-EKA-Wizard") : undefined);
api.use((req, res, next) => usageContext.run({ user: req.user, wizard: wizardId(req) }, next));
api.param("id", (req, res, next, id) => usageContext.run({ user: req.user, siteId: id }, next));

// Customers and demo visitors only see their own sites; the administrator
// sees every customer's site but not demo sites.
function canSee(user, meta) {
  if (user?.role === "demo") return !!meta.demo && meta.owner === user.id;
  if (user?.role === "user") return !meta.demo && meta.owner === user.id;
  return user?.role === "admin" && !meta.demo;
}
const isAdmin = (req) => req.user?.role === "admin";

// Without a valid licence, new websites, new customers and AI stop (published
// websites stay online and can still be edited). Returns true (and answers) when blocked.
function licenceBlocked(req, res) {
  const st = licence.status();
  if (st.allowed) return false;
  res.status(402).json({ error: req?.user?.role === "admin"
    ? `${st.reason}. Enter a licence key on the Customers page (Licence) to make new websites and use AI again. Published websites stay online.`
    : "Making new websites and AI are paused on this server. Your published websites are still online. Please contact your hosting provider." });
  return true;
}
const isCustomer = (req) => req.user?.role === "user";
function adminOnly(req, res) {
  if (isAdmin(req)) return false;
  res.status(403).json({ error: "Only the administrator can do that." });
  return true;
}

// A customer's plan and how much of it they've used.
function accountStatus(userId) {
  const user = users.get(userId);
  const plan = user && users.plan(user.plan);
  const sites = store.list().filter((m) => m.owner === userId && !m.demo).length;
  const aiUsed = accountCostThisMonth(userId);
  return { plan, sites, aiUsed, aiLeft: plan ? Math.max(0, plan.aiMonthly - aiUsed) : 0 };
}

const siteOr404 = (req, res) => {
  const meta = store.getMeta(req.params.id);
  if (!meta || !canSee(req.user, meta)) {
    res.status(404).json({ error: "Site not found." });
    return null;
  }
  return meta;
};

const isDemo = (req) => req.user?.role === "demo";
// Things a demo visitor can't do. Returns true (and answers) when blocked.
function demoBlocked(req, res, what) {
  if (!isDemo(req)) return false;
  res.status(403).json({ error: `${what} is switched off in the demo.` });
  return true;
}

// Caps AI use in the demo: per visitor and per day for everyone.
const demoAiUse = new Map();
let demoAiDay = { date: "", count: 0 };
function demoAiBlocked(req, res) {
  if (ai.enabled && licenceBlocked(req, res)) return true;
  if (isCustomer(req) && ai.enabled) {
    const { plan, aiLeft } = accountStatus(req.user.id);
    if (!plan || plan.aiMonthly <= 0) {
      res.status(403).json({ error: "AI isn't included in your plan. You can still build and edit everything by hand, or ask your hosting provider about upgrading." });
      return true;
    }
    if (aiLeft <= 0) {
      res.status(429).json({ error: "You've used this month's AI allowance. It resets on the 1st; everything else (editing by hand, styling, publishing) still works. Ask your hosting provider if you need more." });
      return true;
    }
    return false;
  }
  if (!isDemo(req) || !ai.enabled) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (demoAiDay.date !== today) demoAiDay = { date: today, count: 0 };
  const used = demoAiUse.get(req.user.id) || 0;
  if (used >= DEMO_AI || demoAiDay.count >= DEMO_AI_DAILY) {
    res.status(429).json({ error: "You've used all the AI in this demo. Everything else (editing by hand, styling, previews) still works." });
    return true;
  }
  demoAiUse.set(req.user.id, used + 1);
  demoAiDay.count++;
  return false;
}

// Old demo sites are removed every hour.
async function cleanDemoSites() {
  const cutoff = Date.now() - DEMO_HOURS * 3600 * 1000;
  for (const meta of store.list()) if (meta.demo && Date.parse(meta.createdAt) < cutoff) await store.remove(meta.id).catch(() => {});
}
cleanDemoSites();
setInterval(cleanDemoSites, 3600 * 1000).unref();

// Never send the hosting password to the browser; just say whether one is saved.
const withUrl = (meta) => {
  const { deploy: d, ...rest } = meta;
  const deploySafe = d ? { ...d, password: undefined, hasPassword: !!d.password } : null;
  return { ...rest, deploy: deploySafe, liveUrl: liveUrl(meta), previewPath: `/s/${meta.slug}/` };
};

const DEPLOY_FIELDS = ["enabled", "host", "port", "user", "secure", "remoteDir"];

function cleanDeploySettings(input, existing = {}) {
  const out = { ...existing };
  for (const k of DEPLOY_FIELDS) if (input[k] !== undefined) out[k] = k === "enabled" ? !!input[k] : String(input[k]).trim().slice(0, 300);
  // An empty password field means "keep the saved one".
  if (typeof input.password === "string" && input.password !== "") out.password = input.password;
  out.host = (out.host || "").replace(/^s?ftps?:\/\//i, "").replace(/\/.*$/, "");
  if (!["explicit", "none"].includes(out.secure)) out.secure = "explicit";
  return out;
}

function startDeployJob(meta) {
  return startJob("deploy", meta.id, async (progress) => {
    const current = store.getMeta(meta.id);
    const site = await store.getPublished(meta.id);
    if (!site) throw new Error("Publish the site first.");
    const files = await buildStaticSite({ site, siteId: meta.id, mediaDir: store.mediaDir(meta.id), formEmail: current.formEmail || "", domain: current.domains?.[0] || "" });
    const previous = await store.getDeployManifest(meta.id);
    try {
      const result = await deploy({ settings: current.deploy, files, previous, onProgress: progress });
      await store.saveDeployManifest(meta.id, result.manifest);
      await store.updateMeta(meta.id, { deployedAt: new Date().toISOString(), deployError: null });
      return result;
    } catch (err) {
      await store.updateMeta(meta.id, { deployError: err.message });
      throw err;
    }
  });
}

api.get("/me", (req, res) => {
  res.json({
    ai: { enabled: ai.enabled, provider: ai.provider, model: ai.model, editModel: ai.editModel },
    baseDomain: BASE_DOMAIN || null,
    stockPhotos: stock.enabled,
    stockSource: stock.enabled ? { name: stock.name, site: stock.site } : null,
    mail: mailer.enabled,
    version: VERSION,
    supportEmail: SUPPORT_EMAIL,
    demo: isDemo(req) ? { hours: DEMO_HOURS, sites: DEMO_SITES, aiLeft: ai.enabled ? Math.max(0, DEMO_AI - (demoAiUse.get(req.user.id) || 0)) : null } : null,
    role: req.user.role,
    licence: (() => {
      const st = licence.status();
      return isAdmin(req) ? { mode: st.mode, allowed: st.allowed, reason: st.reason, daysLeft: st.daysLeft, update: st.update, latest: st.latest } : { allowed: st.allowed };
    })(),
    account: isCustomer(req) ? (() => {
      const st = accountStatus(req.user.id);
      return { email: req.user.email, name: req.user.name, plan: st.plan ? { name: st.plan.name, sites: st.plan.sites, ai: st.plan.aiMonthly > 0 } : null, sites: st.sites, aiPercent: st.plan?.aiMonthly ? Math.min(100, Math.round((st.aiUsed / st.plan.aiMonthly) * 100)) : null };
    })() : null,
  });
});

// AI usage and estimated cost (admin only): this month and all time.
api.get("/usage", async (req, res) => {
  if (adminOnly(req, res)) return;
  const month = new Date();
  month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
  const metas = store.list().filter((m) => !m.demo);
  const names = Object.fromEntries(metas.map((m) => [m.id, m.name]));
  // Designs made in the wizard count towards the site they became.
  const wizards = Object.fromEntries(metas.filter((m) => m.wizardId).map((m) => [m.wizardId, m.id]));
  const [thisMonth, allTime] = await Promise.all([usageSummary({ since: month.toISOString(), wizards }), usageSummary({ wizards })]);
  res.json({ thisMonth, allTime, names });
});

// ---- customers and plans (administrator) -----------------------------------------

function customerRow(u) {
  const st = accountStatus(u.id);
  return { ...publicUser(u), planName: st.plan?.name || "(no plan)", sites: st.sites, aiUsed: Math.round(st.aiUsed * 100) / 100, aiMonthly: st.plan?.aiMonthly ?? 0 };
}

api.get("/customers", (req, res) => {
  if (adminOnly(req, res)) return;
  res.json({ customers: users.list().map(customerRow), plans: users.plans(), mail: mailer.enabled, hostApi: { url: `${publicBase(req)}/api/host`, keyFromSettings: !!process.env.HOST_API_KEY } });
});

// The licence: status, entering a key, and checking now.
api.get("/licence", (req, res) => {
  if (adminOnly(req, res)) return;
  res.json({ licence: licence.status() });
});
api.post("/licence", async (req, res) => {
  if (adminOnly(req, res)) return;
  if (req.body?.key !== undefined) res.json({ licence: await licence.setKey(req.body.key) });
  else res.json({ licence: await licence.check() });
});

// ---- backups (administrator) ----------------------------------------------------

api.get("/backups", async (req, res) => {
  if (adminOnly(req, res)) return;
  res.json({ backups: await backups.list() });
});
api.post("/backups", async (req, res) => {
  if (adminOnly(req, res)) return;
  try { res.json({ name: await backups.create(), backups: await backups.list() }); } catch (err) { res.status(500).json({ error: `The backup failed: ${err.message}` }); }
});
api.get("/backups/:name/download", (req, res) => {
  if (adminOnly(req, res)) return;
  try { res.download(backups.file(req.params.name), req.params.name); } catch (err) { res.status(404).json({ error: err.message }); }
});
api.post("/backups/:name/restore", async (req, res) => {
  if (adminOnly(req, res)) return;
  try {
    await backups.restore({ name: req.params.name });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
// Restore from a backup file uploaded from your computer (e.g. moving servers).
api.post("/backups/upload", async (req, res) => {
  if (adminOnly(req, res)) return;
  const tmp = path.join(DATA_DIR, `upload-${crypto.randomBytes(6).toString("hex")}.zip.tmp`);
  try {
    await pipeline(req, createWriteStream(tmp, { mode: 0o600 }));
    await backups.restore({ zipPath: tmp });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    await fs.rm(tmp, { force: true });
  }
});

// The host API key, shown to the administrator only when asked.
api.get("/host-api-key", (req, res) => {
  if (adminOnly(req, res)) return;
  res.json({ key: HOST_API_KEY });
});

api.post("/customers", async (req, res) => {
  if (adminOnly(req, res)) return;
  if (licenceBlocked(req, res)) return;
  try {
    const { user, password } = await users.create({ email: req.body?.email, name: req.body?.name, plan: req.body?.plan, password: req.body?.password || undefined });
    res.json({ customer: customerRow(user), password });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

api.patch("/customers/:cid", async (req, res) => {
  if (adminOnly(req, res)) return;
  try {
    const { email, name, plan, disabled } = req.body || {};
    res.json({ customer: customerRow(await users.update(req.params.cid, { email, name, plan, disabled })) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// A new password for a customer: the one given, or a made-up one shown once.
api.post("/customers/:cid/password", async (req, res) => {
  if (adminOnly(req, res)) return;
  try {
    const password = await users.setPassword(req.params.cid, req.body?.password || undefined);
    res.json({ password: req.body?.password ? undefined : password });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete a customer. Their websites are deleted too, or kept as the administrator's.
api.delete("/customers/:cid", async (req, res) => {
  if (adminOnly(req, res)) return;
  const user = users.get(req.params.cid);
  if (!user) return res.status(404).json({ error: "Customer not found." });
  for (const meta of store.list().filter((m) => m.owner === user.id && !m.demo)) {
    if (req.query.sites === "keep") await store.updateMeta(meta.id, { owner: undefined });
    else await store.remove(meta.id);
  }
  await users.remove(user.id);
  pageCache.clear();
  res.json({ ok: true });
});

// "Open as this customer": a one-time sign-in link (it replaces your own login in this browser).
api.post("/customers/:cid/login-link", (req, res) => {
  if (adminOnly(req, res)) return;
  const user = users.get(req.params.cid);
  if (!user || user.disabled) return res.status(404).json({ error: "Customer not found or disabled." });
  res.json({ url: `/login/link?t=${encodeURIComponent(auth.loginLink(user, 60))}` });
});

api.post("/plans", async (req, res) => {
  if (adminOnly(req, res)) return;
  res.json({ plan: await users.savePlan({ ...req.body, id: undefined }) });
});
api.patch("/plans/:pid", async (req, res) => {
  if (adminOnly(req, res)) return;
  if (!users.plan(req.params.pid)) return res.status(404).json({ error: "Plan not found." });
  res.json({ plan: await users.savePlan({ ...req.body, id: req.params.pid }) });
});
api.delete("/plans/:pid", async (req, res) => {
  if (adminOnly(req, res)) return;
  try { await users.removePlan(req.params.pid); res.json({ ok: true }); } catch (err) { res.status(400).json({ error: err.message }); }
});

// Monthly report for billing customers: one row per customer.
api.get("/billing.csv", async (req, res) => {
  if (adminOnly(req, res)) return;
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : new Date().toISOString().slice(0, 7);
  const usage = await accountUsage(month);
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [["Month", "Email", "Name", "Plan", "Websites", "AI actions", "AI cost (US$)", "AI allowance (US$)", "Status"]];
  for (const u of users.list()) {
    const st = accountStatus(u.id);
    const a = usage[u.id] || { calls: 0, cost: 0 };
    rows.push([month, u.email, u.name, st.plan?.name || "", st.sites, a.calls, a.cost.toFixed(2), st.plan?.aiMonthly ?? 0, u.disabled ? "disabled" : "active"]);
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="eka-billing-${month}.csv"`);
  res.send(rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n");
});

// Customers change their own password.
api.post("/account/password", async (req, res) => {
  if (!isCustomer(req)) return res.status(400).json({ error: "The administrator's password is set in settings.txt." });
  const user = await users.check(req.user.email, req.body?.current);
  if (!user) return res.status(400).json({ error: "Your current password isn't right." });
  try {
    await users.setPassword(user.id, String(req.body?.password || ""));
    // Their session key changed: sign them straight back in.
    await auth.useLoginLink(req, res, auth.loginLink(users.get(user.id), 30));
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

api.get("/sites", (req, res) => {
  const sites = store.list().filter((m) => canSee(req.user, m)).map(withUrl);
  // The administrator sees whose site each one is.
  if (isAdmin(req)) for (const s of sites) if (s.owner) s.ownerEmail = users.get(s.owner)?.email || "(deleted customer)";
  res.json({ sites });
});

// ---- new-site wizard ----------------------------------------------------------

const HEX = /^#[0-9a-f]{6}$/i;
function cleanBrief(input = {}) {
  const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
  const colors = input.colors && HEX.test(input.colors.primary || "")
    ? { primary: input.colors.primary, accent: HEX.test(input.colors.accent || "") ? input.colors.accent : "" }
    : null;
  return {
    name: str(input.name, 120),
    description: str(input.description, 6000),
    phone: str(input.phone, 60),
    email: str(input.email, 200),
    address: str(input.address, 300),
    hours: str(input.hours, 400),
    socials: str(input.socials, 600),
    logoUrl: /^\/_tmp\/[\w.-]+$/.test(input.logoUrl || "") ? input.logoUrl : "",
    colors,
    style: STYLE_CHOICES.includes(input.style) ? input.style : STYLE_CHOICES[0],
    // Business website, online shop or blog, plus optional extras.
    siteType: ["business", "shop", "blog"].includes(input.siteType) ? input.siteType : "business",
    lang: LANGUAGES[input.lang] ? input.lang : "en-GB",
    extras: Object.fromEntries(["booking", "enquiry", "blog"].map((k) => [k, input.extras?.[k] === true])),
    pages: Array.isArray(input.pages) ? input.pages.map((p) => str(p, 40)).filter(Boolean).slice(0, 12) : [],
    // The owner's own photos (uploaded in the wizard), each with an optional note.
    photos: (Array.isArray(input.photos) ? input.photos : [])
      .filter((p) => p && /^\/_tmp\/[\w.-]+$/.test(p.url || ""))
      .map((p) => ({ url: p.url, note: str(p.note, 140) })).slice(0, 12),
    // A short description per page, by page name ("Home", "About"…).
    pageInfo: Object.fromEntries(Object.entries(input.pageInfo && typeof input.pageInfo === "object" ? input.pageInfo : {})
      .map(([k, v]) => [str(k, 40), str(v, 1500)]).filter(([k, v]) => k && v).slice(0, 13)),
  };
}

// Change requests typed per page in the wizard: { "Whole site": "...", "Home": "...", "About": "..." }
function cleanPageNotes(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const [k, v] of Object.entries(input).slice(0, 20)) {
    const key = String(k).trim().slice(0, 40), text = String(v ?? "").trim().slice(0, 2000);
    if (key && text) out[key] = text;
  }
  return out;
}

// Notes the AI couldn't act on (no API key) are kept with the site, by page
// slug ("_site" for the whole site), and shown in the editor's AI tab.
function notesBySlug(pageNotes, site) {
  const out = {};
  for (const [title, text] of Object.entries(pageNotes)) {
    const key = title === "Whole site" ? "_site" : title === "Home" ? "index" : slugify(title);
    if (key === "_site" || site.pages.some((p) => p.slug === key)) out[key] = text;
    else out._site = [out._site, `${title} page: ${text}`].filter(Boolean).join("\n");
  }
  return out;
}

// The logo is shown to the AI so it can pick colours that match it.
// The logo and the owner's photos are shown to the AI (small copies, which
// are plenty for judging colours and content and cost far fewer tokens), so it
// can match colours and decide where each photo goes.
async function briefImages(brief) {
  if (!ai.enabled) return [];
  const urls = [brief.logoUrl, ...(brief.photos || []).map((p) => p.url)].filter(Boolean);
  const out = [];
  for (const url of urls) {
    try {
      const data = await fs.readFile(path.join(TMP_MEDIA, path.basename(url)));
      const sharp = (await import("sharp")).default;
      const small = await sharp(data).resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true }).png().toBuffer();
      out.push({ mediaType: "image/png", data: small.toString("base64") });
    } catch { /* skip an image that can't be read */ }
  }
  return out;
}

// Moves wizard uploads into the new site's media folder and fixes their URLs.
async function adoptTmpMedia(site, siteId) {
  let json = JSON.stringify(site);
  const files = new Set([...json.matchAll(/\/_tmp\/([\w.-]+)/g)].map((m) => m[1]));
  for (const file of files) {
    const names = [file, file.replace(/-o\.webp$/, "-o-sm.webp")];
    for (const name of new Set(names)) {
      await fs.copyFile(path.join(TMP_MEDIA, name), path.join(store.mediaDir(siteId), name)).catch(() => {});
    }
  }
  json = json.replace(/\/_tmp\//g, `/_m/${siteId}/`);
  return JSON.parse(json);
}

api.post("/wizard/media", express.raw({ type: () => true, limit: "20mb" }), async (req, res) => {
  try {
    const url = await saveUpload({ dir: TMP_MEDIA, urlPrefix: "/_tmp/", buffer: req.body, filename: req.get("X-Filename") || "logo" });
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post("/wizard/concept", async (req, res) => {
  if (demoAiBlocked(req, res)) return;
  const brief = cleanBrief(req.body?.brief);
  if (!brief.name && !brief.description) return res.status(400).json({ error: "Add the business name or a description first." });
  const previous = Array.isArray(req.body?.previous) ? req.body.previous.map(String).slice(-6) : [];
  const images = await briefImages(brief);
  const job = startJob("concept", null, async (progress) => {
    const result = await ai.generateConcept({ brief, previous, images, onProgress: progress });
    await fillImages(result.site, { dir: TMP_MEDIA, urlPrefix: "/_tmp/", brief });
    return result;
  });
  res.json({ jobId: job.id });
});

// "Design each page": one design for one page, in the approved homepage's style.
api.post("/wizard/page", async (req, res) => {
  if (demoAiBlocked(req, res)) return;
  const brief = cleanBrief(req.body?.brief);
  const title = String(req.body?.title || "").trim().slice(0, 40);
  if (!title || !req.body?.concept) return res.status(400).json({ error: "Missing the page or the approved design." });
  const concept = normalizeSite(req.body.concept);
  concept.pages = concept.pages.slice(0, 1); // just the home page, for the AI to match
  const previous = Array.isArray(req.body?.previous) ? req.body.previous.map(String).slice(-6) : [];
  const wishes = String(req.body?.wishes || "").trim().slice(0, 2000);
  const job = startJob("page", null, async (progress) => {
    const result = await ai.generatePage({ brief, concept, title, previous, wishes, onProgress: progress });
    const holder = { ...concept, pages: [result.page] };
    await fillImages(holder, { dir: TMP_MEDIA, urlPrefix: "/_tmp/", brief, avoid: JSON.stringify(req.body.concept) + JSON.stringify(req.body.otherPages || []) });
    return { page: holder.pages[0], layout: result.layout };
  });
  res.json({ jobId: job.id });
});

api.post("/wizard/refine", async (req, res) => {
  if (ai.enabled && demoAiBlocked(req, res)) return;
  if (!ai.enabled) return res.status(400).json({ error: "Written changes need AI. Add your API key to settings.txt and restart the builder. You can still change everything by hand after you confirm." });
  const instruction = String(req.body?.instruction || "").trim().slice(0, 2000);
  if (!instruction || !req.body?.concept) return res.status(400).json({ error: "Describe the change you want." });
  const concept = normalizeSite(req.body.concept);
  const pageSlug = typeof req.body.pageSlug === "string" ? req.body.pageSlug : undefined;
  const job = startJob("refine", null, async (progress) => {
    const result = await ai.refineConcept({ concept, instruction, pageSlug, onProgress: progress });
    await fillImages(result.site, { dir: TMP_MEDIA, urlPrefix: "/_tmp/" });
    return result;
  });
  res.json({ jobId: job.id });
});

function siteLimitReached(req, res) {
  if (licenceBlocked(req, res)) return true;
  if (isDemo(req) && store.list().filter((m) => m.owner === req.user.id).length >= DEMO_SITES) {
    res.status(400).json({ error: `The demo allows ${DEMO_SITES} websites. Delete one to make another.` });
    return true;
  }
  if (isCustomer(req)) {
    const { plan, sites } = accountStatus(req.user.id);
    if (!plan || sites >= plan.sites) {
      res.status(400).json({ error: plan ? `Your plan includes ${plan.sites} website${plan.sites === 1 ? "" : "s"}. Delete one, or ask your hosting provider about upgrading.` : "Your account doesn't have a plan yet. Ask your hosting provider." });
      return true;
    }
  }
  return false;
}
const ownerOf = (req) => (isDemo(req) ? { owner: req.user.id, demo: true } : isCustomer(req) ? { owner: req.user.id } : {});

api.post("/sites", async (req, res) => {
  if (siteLimitReached(req, res)) return;
  const { owner, demo } = ownerOf(req);
  // From the wizard: build the full site from the approved concept.
  if (req.body?.concept) {
    const brief = cleanBrief(req.body.brief);
    const concept = normalizeSite(req.body.concept);
    const requests = Array.isArray(req.body.requests) ? req.body.requests.map((r) => String(r).slice(0, 2000)).slice(0, 20) : [];
    const pageNotes = cleanPageNotes(req.body.pageNotes);
    const name = brief.name || concept.name;
    if (ai.enabled && demoAiBlocked(req, res)) return;
    const meta = await store.create({ name, prompt: brief.description, owner, demo });
    if (wizardId(req)) await store.updateMeta(meta.id, { wizardId: wizardId(req) });
    const job = usageContext.run({ user: req.user, siteId: meta.id }, () => startJob("generate", meta.id, async (progress) => {
      try {
        // Pages designed one by one in the wizard are used as they are; only
        // pages that weren't designed are built here.
        const designed = (Array.isArray(req.body.pages) ? req.body.pages : []).map((p, i) => normalizePage(p, i + 1)).filter(Boolean).slice(0, 12);
        let site;
        if (designed.length) {
          const base = { ...concept, pages: [concept.pages[0], ...designed] };
          base.header = { ...base.header, links: null }; // menu follows the pages
          const missing = brief.pages.filter((t) => t.toLowerCase() !== "home" && !designed.some((p) => p.slug === slugify(t)));
          if (missing.length) {
            const built = (await ai.buildFromConcept({ brief: { ...brief, pages: missing }, concept: normalizeSite(base), requests, pageNotes, onProgress: progress })).site;
            base.pages.push(...built.pages.filter((p) => missing.some((t) => slugify(t) === p.slug)));
          }
          site = applyBrief(normalizeSite(base), brief);
          // Menu order: Home, then the pages in the order the owner listed them, Contact last.
          const rank = (p) => (p.slug === "index" ? -1 : p.slug === "contact" ? 999 : brief.pages.map(slugify).indexOf(p.slug));
          site.pages.sort((a, b) => rank(a) - rank(b));
        } else {
          site = (await ai.buildFromConcept({ brief, concept, requests, pageNotes, onProgress: progress })).site;
        }
        // A blog gets its first posts written now, so it doesn't open empty.
        if ((brief.siteType === "blog" || brief.extras.blog) && !site.pages.some((p) => p.post)) {
          try {
            site.pages.push(...(await ai.starterPosts({ site, brief, onProgress: progress })));
          } catch (err) { console.warn("Starter posts skipped:", err.message); }
        }
        // Every new site gets a privacy policy written from what it does (linked in the footer).
        site.lang = brief.lang;
        ensurePrivacyPage(site);
        await fillImages(site, { dir: TMP_MEDIA, urlPrefix: "/_tmp/", brief });
        const adopted = await adoptTmpMedia(site, meta.id);
        await store.saveDraft(meta.id, adopted, { version: "Built from the approved design" });
        const notes = ai.enabled ? {} : notesBySlug(pageNotes, adopted);
        await store.updateMeta(meta.id, { status: "ready", error: null, name: adopted.name, formEmail: brief.email || "", notes });
        return { ok: true };
      } catch (err) {
        await store.updateMeta(meta.id, { status: "error", error: err.message });
        throw err;
      }
    }));
    await store.updateMeta(meta.id, { jobId: job.id });
    return res.json({ site: withUrl(store.getMeta(meta.id)), jobId: job.id });
  }

  const name = String(req.body?.name || "").trim().slice(0, 120);
  const prompt = String(req.body?.prompt || "").trim().slice(0, 8000);
  if (!name && !prompt) return res.status(400).json({ error: "Give the site a name or a description." });

  if (!prompt || req.body?.blank) {
    const meta = await store.create({ name: name || "New site", site: createEmptySite(name || "New site"), owner, demo });
    return res.json({ site: withUrl(meta) });
  }

  if (demoAiBlocked(req, res)) return;
  const meta = await store.create({ name: name || "New site", prompt, owner, demo });
  const job = usageContext.run({ user: req.user, siteId: meta.id }, () => startJob("generate", meta.id, async (progress) => {
    try {
      const { site } = await ai.generateSite({ name, prompt, onProgress: progress });
      ensurePrivacyPage(site);
      await fillImages(site, { dir: store.mediaDir(meta.id), urlPrefix: `/_m/${meta.id}/`, brief: { name, description: prompt } });
      await store.saveDraft(meta.id, site, { version: "Generated by AI" });
      await store.updateMeta(meta.id, { status: "ready", error: null, name: site.name });
      return { ok: true };
    } catch (err) {
      await store.updateMeta(meta.id, { status: "error", error: err.message });
      throw err;
    }
  }));
  await store.updateMeta(meta.id, { jobId: job.id });
  res.json({ site: withUrl(store.getMeta(meta.id)), jobId: job.id });
});

api.post("/sites/:id/regenerate", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  if (ai.enabled && demoAiBlocked(req, res)) return;
  const prompt = String(req.body?.prompt || meta.prompt || "").trim().slice(0, 8000);
  if (!prompt) return res.status(400).json({ error: "A description is needed to generate a site." });
  await store.updateMeta(meta.id, { status: "generating", error: null, prompt });
  const job = startJob("generate", meta.id, async (progress) => {
    try {
      const before = await store.getDraft(meta.id);
      if (before) await store.addVersion(meta.id, before, "Before regenerating");
      const { site } = await ai.generateSite({ name: meta.name, prompt, media: await store.listMedia(meta.id), onProgress: progress });
      await fillImages(site, { dir: store.mediaDir(meta.id), urlPrefix: `/_m/${meta.id}/`, brief: { name: meta.name, description: prompt } });
      await store.saveDraft(meta.id, site, { version: "Generated by AI" });
      await store.updateMeta(meta.id, { status: "ready", error: null });
      return { ok: true };
    } catch (err) {
      await store.updateMeta(meta.id, { status: "error", error: err.message });
      throw err;
    }
  });
  await store.updateMeta(meta.id, { jobId: job.id });
  res.json({ jobId: job.id });
});

api.get("/sites/:id", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  res.json({ meta: withUrl(meta), site: await store.getDraft(meta.id) });
});

api.put("/sites/:id", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  if (!req.body?.site) return res.status(400).json({ error: "Missing site." });
  const site = await store.saveDraft(meta.id, req.body.site, { version: req.body.versionLabel || null });
  res.json({ ok: true, savedAt: new Date().toISOString(), site: req.body.returnSite ? site : undefined });
});

api.patch("/sites/:id/meta", async (req, res) => {
  if (isDemo(req) && (req.body?.deploy || req.body?.domains)) return demoBlocked(req, res, "Hosting and domain settings");
  const meta = siteOr404(req, res);
  if (!meta) return;
  const patch = {};
  if (typeof req.body.name === "string") patch.name = req.body.name.trim().slice(0, 120) || meta.name;
  if (typeof req.body.slug === "string") patch.slug = req.body.slug;
  if (Array.isArray(req.body.domains)) patch.domains = req.body.domains;
  if (typeof req.body.formEmail === "string") {
    const email = req.body.formEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "That email address doesn't look right." });
    patch.formEmail = email;
  }
  if (req.body.deploy && typeof req.body.deploy === "object") patch.deploy = cleanDeploySettings(req.body.deploy, meta.deploy || {});
  if (req.body.notes && typeof req.body.notes === "object") patch.notes = cleanPageNotes(req.body.notes);
  const updated = await store.updateMeta(meta.id, patch);
  pageCache.clear();
  res.json({ meta: withUrl(updated) });
});

api.delete("/sites/:id", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  await store.remove(meta.id);
  pageCache.clear();
  res.json({ ok: true });
});

api.post("/sites/:id/duplicate", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  const draft = await store.getDraft(meta.id);
  if (!draft) return res.status(400).json({ error: "This site has no content yet." });
  if (siteLimitReached(req, res)) return;
  const name = `${meta.name} (copy)`;
  draft.name = name;
  const copy = await store.create({ name, prompt: meta.prompt, site: draft, owner: meta.owner, demo: !!meta.demo });
  res.json({ site: withUrl(copy) });
});

api.post("/sites/:id/publish", async (req, res) => {
  if (demoBlocked(req, res, "Publishing")) return;
  const meta = siteOr404(req, res);
  if (!meta) return;
  if (req.body?.site) await store.saveDraft(meta.id, req.body.site);
  const updated = await store.publish(meta.id);
  // Sites set up to publish to outside hosting upload their files now.
  const jobId = updated.deploy?.enabled ? startDeployJob(updated).id : null;
  res.json({ meta: withUrl(updated), jobId });
});

api.post("/sites/:id/deploy", async (req, res) => {
  if (demoBlocked(req, res, "Uploading to hosting")) return;
  const meta = siteOr404(req, res);
  if (!meta) return;
  if (!meta.deploy?.host) return res.status(400).json({ error: "Add the hosting's FTP details first (Site tab)." });
  if (!meta.publishedAt) return res.status(400).json({ error: "Publish the site first." });
  res.json({ jobId: startDeployJob(meta).id });
});

api.post("/sites/:id/deploy/test", async (req, res) => {
  if (demoBlocked(req, res, "Connecting to hosting")) return;
  const meta = siteOr404(req, res);
  if (!meta) return;
  const settings = cleanDeploySettings(req.body || {}, meta.deploy || {});
  if (!settings.host || !settings.user || !settings.password) return res.status(400).json({ error: "Fill in the server, username and password first." });
  try {
    res.json(await testConnection(settings));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// "Download site as files": the published site as a ZIP for any web host.
api.get("/sites/:id/export.zip", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  const site = await store.getPublished(meta.id);
  if (!site) return res.status(400).json({ error: "Publish the site first." });
  const files = await buildStaticSite({ site, siteId: meta.id, mediaDir: store.mediaDir(meta.id), formEmail: meta.formEmail || "", domain: meta.domains?.[0] || "" });
  const zip = new yazl.ZipFile();
  for (const f of files) zip.addBuffer(f.content, f.path);
  zip.end();
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${meta.slug}-website.zip"`);
  zip.outputStream.pipe(res);
});

// "Download as CubeCart skin": the design as a skin for a CubeCart shop.
api.get("/sites/:id/cubecart-skin.zip", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  const site = (await store.getPublished(meta.id)) || (await store.getDraft(meta.id));
  const { folder, files } = await buildCubecartSkin({ site, slug: meta.slug, mediaDir: store.mediaDir(meta.id) });
  const zip = new yazl.ZipFile();
  for (const f of files) zip.addBuffer(f.content, f.path);
  zip.end();
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${folder}-cubecart-skin.zip"`);
  zip.outputStream.pipe(res);
});

api.post("/sites/:id/unpublish", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  res.json({ meta: withUrl(await store.unpublish(meta.id)) });
});

// Turn the customer review link on (a new link each time) or off.
api.post("/sites/:id/review", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  if (demoBlocked(req, res, "Sharing for review")) return;
  const review = req.body?.off ? null : { token: crypto.randomBytes(12).toString("base64url"), createdAt: new Date().toISOString() };
  res.json({ meta: withUrl(await store.updateMeta(meta.id, { review, ...(review ? { approval: null } : {}) })) });
});

api.get("/sites/:id/comments", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  res.json({ comments: await store.getComments(meta.id) });
});

api.patch("/sites/:id/comments/:cid", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  const comments = await store.updateComments(meta.id, (list) => list.map((c) => (c.id === req.params.cid ? { ...c, resolved: !!req.body?.resolved } : c)));
  res.json({ comments });
});

api.get("/sites/:id/versions", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  res.json({ versions: await store.listVersions(meta.id) });
});

api.post("/sites/:id/versions", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  const site = req.body?.site ? normalizeSite(req.body.site) : await store.getDraft(meta.id);
  const vid = await store.addVersion(meta.id, site, String(req.body?.label || "Saved version"));
  res.json({ id: vid });
});

api.post("/sites/:id/versions/:vid/restore", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  const version = await store.getVersion(meta.id, req.params.vid);
  if (!version) return res.status(404).json({ error: "Version not found." });
  const current = await store.getDraft(meta.id);
  if (current) await store.addVersion(meta.id, current, "Before restoring an older version");
  const site = await store.saveDraft(meta.id, version.site);
  res.json({ site });
});

api.post("/sites/:id/ai", async (req, res) => {
  if (demoAiBlocked(req, res)) return;
  const meta = siteOr404(req, res);
  if (!meta) return;
  if (!ai.enabled) return res.status(400).json({ error: "AI isn't set up on this server. Set ANTHROPIC_API_KEY and restart. You can still edit everything by hand." });
  const instruction = String(req.body?.instruction || "").trim().slice(0, 4000);
  if (!instruction) return res.status(400).json({ error: "Describe the change you want." });
  const current = req.body?.site ? normalizeSite(req.body.site) : await store.getDraft(meta.id);
  const job = startJob("edit", meta.id, async (progress) => {
    const result = await ai.editSite({
      site: current,
      instruction,
      selectedId: req.body?.selectedId || null,
      pageId: req.body?.pageId || null,
      media: await store.listMedia(meta.id),
      onProgress: progress,
    });
    if (result.changed) {
      // Pictures the AI added get stock photos (or placeholder artwork).
      await fillImages(result.site, { dir: store.mediaDir(meta.id), urlPrefix: `/_m/${meta.id}/` });
      await store.addVersion(meta.id, current, `Before AI: ${instruction.slice(0, 120)}`);
      await store.saveDraft(meta.id, result.site);
    }
    return { site: result.site, summary: result.summary, changed: result.changed };
  });
  res.json({ jobId: job.id });
});

// "Fill with AI" / "Restyle" for one or more sections of a page.
api.post("/sites/:id/ai/sections", async (req, res) => {
  if (demoAiBlocked(req, res)) return;
  const meta = siteOr404(req, res);
  if (!meta) return;
  if (!ai.enabled) return res.status(400).json({ error: "This needs AI. You can still change the text and style by hand." });
  const site = req.body?.site ? normalizeSite(req.body.site) : await store.getDraft(meta.id);
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).slice(0, 4);
  const sections = ids.map((id) => findNode(site, id)).filter((f) => f?.kind === "section").map((f) => f.node);
  if (!sections.length) return res.status(400).json({ error: "Choose a section first." });
  const mode = req.body?.mode === "restyle" ? "restyle" : "fill";
  const wishes = String(req.body?.wishes || "").trim().slice(0, 500);
  const job = startJob(mode, meta.id, async (progress) => {
    const result = await ai.reworkSections({ site, sections, mode, wishes, about: meta.prompt || "", onProgress: progress });
    // New pictures get stock photos (or placeholder artwork).
    const holder = { ...site, pages: [{ ...site.pages[0], sections: result.sections }] };
    if (mode === "fill") for (const sec of holder.pages[0].sections) for (const c of sec.columns) for (const bl of c.blocks) if (bl.type === "image" && /\/placeholder-/.test(bl.props.src)) bl.props.src = "";
    await fillImages(holder, { dir: store.mediaDir(meta.id), urlPrefix: `/_m/${meta.id}/`, avoid: JSON.stringify(site) });
    return { sections: holder.pages[0].sections };
  });
  res.json({ jobId: job.id });
});

// "Write a post with AI": a draft blog post in the site's style, with a cover photo.
api.post("/sites/:id/ai/post", async (req, res) => {
  if (demoAiBlocked(req, res)) return;
  const meta = siteOr404(req, res);
  if (!meta) return;
  if (!ai.enabled) return res.status(400).json({ error: "Writing posts needs AI. You can still write them yourself: Pages tab → New post." });
  const topic = String(req.body?.topic || "").trim().slice(0, 500);
  if (!topic) return res.status(400).json({ error: "Say what the post is about." });
  const site = req.body?.site ? normalizeSite(req.body.site) : await store.getDraft(meta.id);
  const job = startJob("post", meta.id, async (progress) => {
    const { page } = await ai.writePost({ site, topic, onProgress: progress });
    const holder = { ...site, pages: [page] };
    await fillImages(holder, { dir: store.mediaDir(meta.id), urlPrefix: `/_m/${meta.id}/`, avoid: JSON.stringify(site) });
    return { page: holder.pages[0] };
  });
  res.json({ jobId: job.id });
});

api.get("/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  const me = isAdmin(req) ? "admin" : `${req.user.role}:${req.user.id}`;
  if (!job || (job.owner !== me && !isAdmin(req))) return res.status(404).json({ error: "This job has expired. Reload the page." });
  res.json(publicJob(job));
});

// Stock photo search (image picker) and adding one to a site's images.
api.get("/stock/search", async (req, res) => {
  try {
    res.json({ photos: await stock.search(String(req.query.q || ""), { orientation: String(req.query.orientation || ""), page: Math.max(1, Math.min(10, Number(req.query.page) || 1)) }) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post("/sites/:id/stock", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  try {
    const url = await stock.download(String(req.body?.url || ""), { dir: store.mediaDir(meta.id), urlPrefix: `/_m/${meta.id}/`, name: `${stock.provider}-${Number(req.body?.id) || "photo"}` });
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.get("/sites/:id/media", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  res.json({ media: await store.listMedia(meta.id) });
});

api.post("/sites/:id/media", express.raw({ type: () => true, limit: "45mb" }), async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  try {
    if (isDemo(req) && req.body?.length > 8 * 1024 * 1024) throw new Error("The demo accepts files up to 8 MB.");
    const url = await saveUpload({ dir: store.mediaDir(meta.id), siteId: meta.id, buffer: req.body, filename: req.get("X-Filename") || "image", allowVideo: !isDemo(req) });
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Pasting from another website: copy the images it uses into this site.
api.post("/sites/:id/media/import", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  const map = {};
  for (const url of (Array.isArray(req.body?.urls) ? req.body.urls : []).slice(0, 100)) {
    const m = String(url).match(/^\/_m\/([a-f0-9]+)\/([\w.-]+)$/);
    const from = m && store.getMeta(m[1]);
    if (!from || from.id === meta.id || !canSee(req.user, from) || m[2].startsWith(".")) continue;
    for (const name of new Set([m[2], m[2].replace(/-o\.webp$/, "-o-sm.webp")])) {
      await fs.copyFile(path.join(store.mediaDir(from.id), name), path.join(store.mediaDir(meta.id), name)).catch(() => {});
    }
    map[url] = `/_m/${meta.id}/${m[2]}`;
  }
  res.json({ map });
});

api.delete("/sites/:id/media/:file", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  await deleteUpload(store.mediaDir(meta.id), req.params.file);
  res.json({ ok: true });
});

api.get("/sites/:id/submissions", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  res.json({ submissions: await store.listSubmissions(meta.id) });
});

// Mark a message, enquiry or booking as dealt with (or not).
api.patch("/sites/:id/submissions/:sid", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  if (!/^[a-f0-9]{12}$/.test(req.params.sid)) return res.status(404).json({ error: "Message not found." });
  await store.setSubmissionDone(meta.id, req.params.sid, !!req.body?.done);
  res.json({ ok: true });
});

app.use("/api", api);

// ---------------------------------------------------------------------------

app.use((err, req, res, _next) => {
  console.error(err);
  if (req.path.startsWith("/api/")) return res.status(500).json({ error: err.message || "Server error" });
  res.status(500).type("html").send(simplePage("Something went wrong", "Please try again in a moment."));
});

// If the port is taken (often another program, or the builder already
// running in another window), try the next few before giving up.
function listen(port, triesLeft = 10) {
  const server = app.listen(port, HOST, () => {
    const url = `http://localhost:${port}/admin`;
    console.log(`EKA Hosting running on ${url}`);
      if (process.env.OPEN_BROWSER === "1") {
      const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
    console.log(`AI: ${ai.enabled ? `${ai.provider} (new sites: ${ai.model}, changes: ${ai.editModel})` : "not configured (template mode) — set ANTHROPIC_API_KEY to enable"}`);
    if (BASE_DOMAIN) console.log(`Customer sites: https://<slug>.${BASE_DOMAIN}/`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && triesLeft > 0) {
      console.log(`  Port ${port} is already in use, trying ${port + 1}...`);
      return listen(port + 1, triesLeft - 1);
    }
    console.error(`\n  Could not start the builder: ${err.message}`);
    if (err.code === "EADDRINUSE") console.error("  Every port we tried is busy. Close other copies of the builder and try again.");
    if (err.code === "EACCES") console.error("  Windows blocked the connection. Try a different PORT in settings.txt, e.g. PORT=8080.");
    process.exit(1);
  });
}
listen(PORT);
