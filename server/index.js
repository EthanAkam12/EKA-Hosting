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
import { createAi } from "./ai/index.js";
import { startJob, getJob, publicJob } from "./jobs.js";
import { saveUpload, deleteUpload } from "./media.js";
import { renderPage } from "../shared/render.js";
import { createEmptySite, normalizeSite, findNode } from "../shared/schema.js";

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

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || undefined; // e.g. 127.0.0.1 = only this computer
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const BASE_DOMAIN = (process.env.BASE_DOMAIN || "").toLowerCase().replace(/^\.+/, "");
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

async function serveSite(req, res, meta, { base, rest, draft = false, sandbox = false }) {
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
  if (draft) {
    res.setHeader("Cache-Control", "no-store");
    return res.type("html").send(renderPage(site, page, { base, formAction }));
  }
  const key = `${meta.id}|${meta.publishedAt}|${base}|${page.slug}`;
  const { html, etag } = cachedRender(key, () => renderPage(site, page, { base, formAction }));
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
  if (req.path === "/robots.txt") return res.type("text").send("User-agent: *\nAllow: /\n");
  serveSite(req, res, meta, { base: "/", rest: req.path }).catch(next);
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
app.get("/admin", auth.requirePage, (req, res) => res.sendFile(path.join(ROOT, "public/admin/dashboard.html")));
app.get("/admin/sites/:id", auth.requirePage, (req, res) => res.sendFile(path.join(ROOT, "public/admin/editor.html")));
app.get(["/admin/preview/:id", "/admin/preview/:id/*"], auth.requirePage, (req, res, next) => {
  const meta = store.getMeta(req.params.id);
  if (!meta) return res.sendStatus(404);
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
api.use(auth.requireApi);

const siteOr404 = (req, res) => {
  const meta = store.getMeta(req.params.id);
  if (!meta) res.status(404).json({ error: "Site not found." });
  return meta;
};

const withUrl = (meta) => ({ ...meta, liveUrl: liveUrl(meta), previewPath: `/s/${meta.slug}/` });

api.get("/me", (req, res) => {
  res.json({ ai: { enabled: ai.enabled, provider: ai.provider, model: ai.model, editModel: ai.editModel }, baseDomain: BASE_DOMAIN || null });
});

api.get("/sites", (req, res) => res.json({ sites: store.list().map(withUrl) }));

api.post("/sites", async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 120);
  const prompt = String(req.body?.prompt || "").trim().slice(0, 8000);
  if (!name && !prompt) return res.status(400).json({ error: "Give the site a name or a description." });

  if (!prompt || req.body?.blank) {
    const meta = await store.create({ name: name || "New site", site: createEmptySite(name || "New site") });
    return res.json({ site: withUrl(meta) });
  }

  const meta = await store.create({ name: name || "New site", prompt });
  const job = startJob("generate", meta.id, async (progress) => {
    try {
      const { site } = await ai.generateSite({ name, prompt, onProgress: progress });
      await store.saveDraft(meta.id, site, { version: "Generated by AI" });
      await store.updateMeta(meta.id, { status: "ready", error: null, name: site.name });
      return { ok: true };
    } catch (err) {
      await store.updateMeta(meta.id, { status: "error", error: err.message });
      throw err;
    }
  });
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
  const meta = siteOr404(req, res);
  if (!meta) return;
  const patch = {};
  if (typeof req.body.name === "string") patch.name = req.body.name.trim().slice(0, 120) || meta.name;
  if (typeof req.body.slug === "string") patch.slug = req.body.slug;
  if (Array.isArray(req.body.domains)) patch.domains = req.body.domains;
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
  const meta = siteOr404(req, res);
  if (!meta) return;
  if (req.body?.site) await store.saveDraft(meta.id, req.body.site);
  const updated = await store.publish(meta.id);
  res.json({ meta: withUrl(updated) });
});

api.post("/sites/:id/unpublish", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  res.json({ meta: withUrl(await store.unpublish(meta.id)) });
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

api.get("/sites/:id/media", async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  res.json({ media: await store.listMedia(meta.id) });
});

api.post("/sites/:id/media", express.raw({ type: () => true, limit: "20mb" }), async (req, res) => {
  const meta = siteOr404(req, res);
  if (!meta) return;
  try {
    const url = await saveUpload({ dir: store.mediaDir(meta.id), siteId: meta.id, buffer: req.body, filename: req.get("X-Filename") || "image" });
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

app.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}/admin`;
  console.log(`EKA Hosting running on ${url}`);
  if (process.env.ADMIN_PASSWORD === "change-me") console.log("  Your password is still 'change-me'. Edit settings.txt to choose your own.");
  if (process.env.OPEN_BROWSER === "1") {
    const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
  console.log(`AI: ${ai.enabled ? `${ai.provider} (new sites: ${ai.model}, changes: ${ai.editModel})` : "not configured (template mode) — set ANTHROPIC_API_KEY to enable"}`);
  if (BASE_DOMAIN) console.log(`Customer sites: https://<slug>.${BASE_DOMAIN}/`);
});
