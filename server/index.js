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
import { createAi, applyBrief } from "./ai/index.js";
import { usageContext, initUsageLog, usageSummary } from "./ai/usage.js";
import { startJob, getJob, publicJob } from "./jobs.js";
import { saveUpload, deleteUpload } from "./media.js";
import { buildStaticSite } from "./export.js";
import { buildCubecartSkin } from "./cubecart-skin.js";
import { fillPlaceholders } from "./placeholders.js";
import { createStock, fillStockPhotos, keywordsFromBrief } from "./stock.js";
import { deploy, testConnection } from "./deploy.js";
import yazl from "yazl";
import { renderPage, pageUrl, sitemapXml } from "../shared/render.js";
import { STYLE_CHOICES } from "./ai/prompts.js";
import { createEmptySite, normalizeSite, normalizePage, findNode, slugify } from "../shared/schema.js";

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

const store = new Store(DATA_DIR);
await store.init();
const auth = createAuth({ password: ADMIN_PASSWORD, secret: SESSION_SECRET, secure: SECURE_COOKIES });
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

function findPage(site, rest) {
  const slug = String(rest || "").replace(/^\/+|\/+$/g, "").replace(/\/index\.html$|^index\.html$/, "") || "index";
  return site.pages.find((p) => p.slug === slug) || null;
}

async function serveSite(req, res, meta, { base, rest, draft = false, sandbox = false, origin = `${req.protocol}://${req.get("host")}`, live = false, review = false }) {
  const site = draft ? await store.getDraft(meta.id) : await store.getPublished(meta.id);
  if (sandbox) {
    // Previews on the builder's own domain share its origin, so block any
    // custom scripts from running there. Live domains are unaffected.
    res.setHeader("Content-Security-Policy", "sandbox allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin");
  }
  if (!site) {
    return res.status(404).type("html").send(simplePage("Coming soon", "This website hasn't been published yet."));
  }
  const page = findPage(site, rest);
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
const stock = createStock();

// Empty picture spots get matching stock photos where possible, and
// placeholder artwork otherwise.
async function fillImages(site, { dir, urlPrefix, brief, avoid }) {
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

const formHits = new Map();
app.post("/_forms/:siteId", express.urlencoded({ extended: false, limit: "64kb" }), async (req, res) => {
  const meta = store.getMeta(req.params.siteId);
  const site = meta && (await store.getPublished(meta.id));
  if (!site) return res.sendStatus(404);

  const body = req.body || {};
  const page = site.pages.find((p) => p.slug === body._page) || site.pages[0];
  const pagePath = page.slug === "index" ? "" : `${page.slug}/`;
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
  if (formBlock) {
    formBlock.props.fields.forEach((f, i) => {
      const value = String(body[`field_${i}`] ?? "").slice(0, 5000);
      fields[f.label || `Field ${i + 1}`] = value;
    });
  }
  if (!Object.values(fields).some((v) => v.trim())) return backTo(`#f-${encodeURIComponent(body._block || "")}`);

  await store.addSubmission(meta.id, { at: new Date().toISOString(), page: page.slug, fields });
  backTo(`#sent-${encodeURIComponent(formBlock.id)}`);
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

api.post("/login", (req, res) => auth.login(req, res));
api.post("/logout", (req, res) => auth.logout(req, res));
api.post("/demo/start", (req, res) => {
  if (!DEMO) return res.status(404).json({ error: "The demo isn't switched on here." });
  auth.startDemo(req, res, DEMO_HOURS * 3600);
  res.json({ ok: true });
});
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

// Demo visitors only see their own sites; the admin doesn't see demo sites.
function canSee(user, meta) {
  return user?.role === "demo" ? meta.owner === user.id : !meta.demo;
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
    version: VERSION,
    supportEmail: SUPPORT_EMAIL,
    demo: isDemo(req) ? { hours: DEMO_HOURS, sites: DEMO_SITES, aiLeft: ai.enabled ? Math.max(0, DEMO_AI - (demoAiUse.get(req.user.id) || 0)) : null } : null,
  });
});

// AI usage and estimated cost (admin only): this month and all time.
api.get("/usage", async (req, res) => {
  if (isDemo(req)) return res.status(403).json({ error: "Not available in the demo." });
  const month = new Date();
  month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
  const metas = store.list().filter((m) => !m.demo);
  const names = Object.fromEntries(metas.map((m) => [m.id, m.name]));
  // Designs made in the wizard count towards the site they became.
  const wizards = Object.fromEntries(metas.filter((m) => m.wizardId).map((m) => [m.wizardId, m.id]));
  const [thisMonth, allTime] = await Promise.all([usageSummary({ since: month.toISOString(), wizards }), usageSummary({ wizards })]);
  res.json({ thisMonth, allTime, names });
});

api.get("/sites", (req, res) => res.json({ sites: store.list().filter((m) => canSee(req.user, m)).map(withUrl) }));

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
    pages: Array.isArray(input.pages) ? input.pages.map((p) => str(p, 40)).filter(Boolean).slice(0, 12) : [],
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
async function briefImages(brief) {
  if (!ai.enabled || !brief.logoUrl) return [];
  const file = path.join(TMP_MEDIA, path.basename(brief.logoUrl));
  const ext = path.extname(file).slice(1).toLowerCase();
  const mediaType = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", gif: "image/gif" }[ext];
  if (!mediaType) return [];
  try {
    let data = await fs.readFile(file);
    let type = mediaType;
    // A small copy is plenty for matching colours, and costs far fewer tokens.
    try {
      const sharp = (await import("sharp")).default;
      data = await sharp(data).resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true }).png().toBuffer();
      type = "image/png";
    } catch { /* send the original */ }
    return [{ mediaType: type, data: data.toString("base64") }];
  } catch {
    return [];
  }
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

api.post("/sites", async (req, res) => {
  if (isDemo(req) && store.list().filter((m) => m.owner === req.user.id).length >= DEMO_SITES) {
    return res.status(400).json({ error: `The demo allows ${DEMO_SITES} websites. Delete one to make another.` });
  }
  const owner = isDemo(req) ? req.user.id : undefined;
  // From the wizard: build the full site from the approved concept.
  if (req.body?.concept) {
    const brief = cleanBrief(req.body.brief);
    const concept = normalizeSite(req.body.concept);
    const requests = Array.isArray(req.body.requests) ? req.body.requests.map((r) => String(r).slice(0, 2000)).slice(0, 20) : [];
    const pageNotes = cleanPageNotes(req.body.pageNotes);
    const name = brief.name || concept.name;
    const meta = await store.create({ name, prompt: brief.description, owner });
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
    const meta = await store.create({ name: name || "New site", site: createEmptySite(name || "New site"), owner });
    return res.json({ site: withUrl(meta) });
  }

  if (demoAiBlocked(req, res)) return;
  const meta = await store.create({ name: name || "New site", prompt, owner });
  const job = usageContext.run({ user: req.user, siteId: meta.id }, () => startJob("generate", meta.id, async (progress) => {
    try {
      const { site } = await ai.generateSite({ name, prompt, onProgress: progress });
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
  const name = `${meta.name} (copy)`;
  draft.name = name;
  const copy = await store.create({ name, prompt: meta.prompt, site: draft });
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

api.get("/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "This job has expired. Reload the page." });
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
    const url = await stock.download(String(req.body?.url || ""), { dir: store.mediaDir(meta.id), urlPrefix: `/_m/${meta.id}/`, name: `pexels-${Number(req.body?.id) || "photo"}` });
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
