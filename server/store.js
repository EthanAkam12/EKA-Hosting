// File-based storage. One folder per customer site:
//
//   data/sites/<id>/meta.json        name, slug, custom domains, timestamps
//   data/sites/<id>/draft.json       the site being edited
//   data/sites/<id>/published.json   what visitors see
//   data/sites/<id>/versions/*.json  restore points (AI changes, publishes, manual saves)
//   data/sites/<id>/media/*          uploaded images (optimised to WebP)
//   data/sites/<id>/submissions.jsonl contact-form entries
//
// Plain files keep hosting simple (back up the data folder and you have
// everything). Swap this module for a database later without touching routes.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { normalizeSite, slugify } from "../shared/schema.js";

const MAX_VERSIONS = 60;
const RESERVED_SLUGS = new Set(["www", "admin", "api", "app", "mail", "static", "assets", "s"]);

export class Store {
  constructor(dataDir) {
    this.root = path.join(dataDir, "sites");
    this.metaById = new Map();
    this.locks = new Map();
  }

  async init() {
    await fs.mkdir(this.root, { recursive: true });
    for (const id of await fs.readdir(this.root)) {
      try {
        const meta = JSON.parse(await fs.readFile(this.file(id, "meta.json"), "utf8"));
        this.metaById.set(id, meta);
      } catch {
        // Not a site folder (or half-written); ignore.
      }
    }
  }

  dir(id) {
    if (!/^[a-z0-9]{6,40}$/.test(id)) throw new Error("Bad site id");
    return path.join(this.root, id);
  }

  file(id, name) {
    return path.join(this.dir(id), name);
  }

  // Serialise writes per site so concurrent saves can't interleave.
  async withLock(id, fn) {
    const prev = this.locks.get(id) || Promise.resolve();
    let release;
    const next = new Promise((r) => (release = r));
    const chain = prev.then(() => next);
    this.locks.set(id, chain);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(id) === chain) this.locks.delete(id);
    }
  }

  async writeJson(file, data) {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, file);
  }

  async readJson(file, fallback = null) {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") return fallback;
      throw err;
    }
  }

  // ---- sites --------------------------------------------------------------

  list() {
    return [...this.metaById.values()].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }

  getMeta(id) {
    return this.metaById.get(id) || null;
  }

  findBySlug(slug) {
    for (const m of this.metaById.values()) if (m.slug === slug) return m;
    return null;
  }

  findByReviewToken(token) {
    for (const m of this.metaById.values()) if (m.review?.token && m.review.token === token) return m;
    return null;
  }

  // ---- customer review comments -------------------------------------------

  async getComments(id) {
    return this.readJson(this.file(id, "comments.json"), []);
  }

  // `change(list)` returns the new list; runs under the site's lock.
  async updateComments(id, change) {
    return this.withLock(id, async () => {
      const next = change(await this.getComments(id));
      await this.writeJson(this.file(id, "comments.json"), next);
      return next;
    });
  }

  findByDomain(host) {
    const h = host.toLowerCase().replace(/^www\./, "");
    for (const m of this.metaById.values()) if ((m.domains || []).some((d) => d === h)) return m;
    return null;
  }

  uniqueSlug(wanted, exceptId = null) {
    let base = slugify(wanted).slice(0, 40) || "site";
    if (RESERVED_SLUGS.has(base)) base = `${base}-site`;
    let slug = base;
    let n = 2;
    while ([...this.metaById.values()].some((m) => m.slug === slug && m.id !== exceptId)) slug = `${base}-${n++}`;
    return slug;
  }

  // `owner` is set for demo-mode sites (the visitor's demo id).
  async create({ name, prompt = "", site, owner }) {
    const id = crypto.randomBytes(8).toString("hex");
    const now = new Date().toISOString();
    const meta = {
      id,
      name: name || site?.name || "New site",
      slug: this.uniqueSlug(name || site?.name || "site"),
      domains: [],
      prompt,
      status: site ? "ready" : "generating",
      error: null,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      ...(owner ? { owner, demo: true } : {}),
    };
    await fs.mkdir(path.join(this.dir(id), "versions"), { recursive: true });
    await fs.mkdir(path.join(this.dir(id), "media"), { recursive: true });
    if (site) await this.writeJson(this.file(id, "draft.json"), normalizeSite(site));
    await this.writeJson(this.file(id, "meta.json"), meta);
    this.metaById.set(id, meta);
    return meta;
  }

  async updateMeta(id, patch) {
    return this.withLock(id, async () => {
      const meta = { ...this.getMeta(id), ...patch, updatedAt: new Date().toISOString() };
      if (patch.slug !== undefined) meta.slug = this.uniqueSlug(patch.slug, id);
      if (patch.domains !== undefined) {
        meta.domains = [...new Set(patch.domains.map((d) => String(d).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))];
      }
      await this.writeJson(this.file(id, "meta.json"), meta);
      this.metaById.set(id, meta);
      return meta;
    });
  }

  async remove(id) {
    await fs.rm(this.dir(id), { recursive: true, force: true });
    this.metaById.delete(id);
  }

  async getDraft(id) {
    const site = await this.readJson(this.file(id, "draft.json"));
    return site ? normalizeSite(site) : null;
  }

  async saveDraft(id, site, { version = null } = {}) {
    const clean = normalizeSite(site);
    await this.withLock(id, async () => {
      await this.writeJson(this.file(id, "draft.json"), clean);
      if (version) await this.addVersionUnlocked(id, clean, version);
      const meta = { ...this.getMeta(id), name: clean.name, updatedAt: new Date().toISOString() };
      await this.writeJson(this.file(id, "meta.json"), meta);
      this.metaById.set(id, meta);
    });
    return clean;
  }

  async getPublished(id) {
    const site = await this.readJson(this.file(id, "published.json"));
    return site ? normalizeSite(site) : null;
  }

  async publish(id) {
    const draft = await this.getDraft(id);
    if (!draft) throw new Error("Nothing to publish yet");
    await this.withLock(id, async () => {
      await this.writeJson(this.file(id, "published.json"), draft);
      await this.addVersionUnlocked(id, draft, "Published");
    });
    return this.updateMeta(id, { publishedAt: new Date().toISOString() });
  }

  async unpublish(id) {
    await fs.rm(this.file(id, "published.json"), { force: true });
    return this.updateMeta(id, { publishedAt: null });
  }

  // ---- versions -----------------------------------------------------------

  async addVersionUnlocked(id, site, label) {
    const dir = path.join(this.dir(id), "versions");
    await fs.mkdir(dir, { recursive: true });
    const vid = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    await this.writeJson(path.join(dir, `${vid}.json`), { id: vid, label: String(label).slice(0, 200), createdAt: new Date().toISOString(), site });
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
    for (const f of files.slice(0, Math.max(0, files.length - MAX_VERSIONS))) await fs.rm(path.join(dir, f), { force: true });
    return vid;
  }

  async addVersion(id, site, label) {
    return this.withLock(id, () => this.addVersionUnlocked(id, normalizeSite(site), label));
  }

  async listVersions(id) {
    const dir = path.join(this.dir(id), "versions");
    let files = [];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort().reverse();
    } catch {
      return [];
    }
    const out = [];
    for (const f of files) {
      const v = await this.readJson(path.join(dir, f));
      if (v) out.push({ id: v.id, label: v.label, createdAt: v.createdAt });
    }
    return out;
  }

  async getVersion(id, vid) {
    if (!/^[0-9]+-[a-f0-9]+$/.test(vid)) return null;
    return this.readJson(path.join(this.dir(id), "versions", `${vid}.json`));
  }

  // ---- media --------------------------------------------------------------

  mediaDir(id) {
    return path.join(this.dir(id), "media");
  }

  async listMedia(id) {
    try {
      const files = await fs.readdir(this.mediaDir(id));
      // Hide the small responsive copies; the renderer finds them itself.
      return files.filter((f) => !f.endsWith("-o-sm.webp") && !f.startsWith(".")).sort().reverse().map((f) => `/_m/${id}/${f}`);
    } catch {
      return [];
    }
  }

  // ---- publishing to outside hosting ----------------------------------------

  // Remembers what was last uploaded (path → hash) so only changes are sent.
  async getDeployManifest(id) {
    return (await this.readJson(this.file(id, "deploy-manifest.json"))) || {};
  }

  async saveDeployManifest(id, manifest) {
    await this.writeJson(this.file(id, "deploy-manifest.json"), manifest);
  }

  // ---- form submissions ---------------------------------------------------

  async addSubmission(id, entry) {
    await fs.appendFile(this.file(id, "submissions.jsonl"), JSON.stringify(entry) + "\n");
  }

  async listSubmissions(id) {
    try {
      const raw = await fs.readFile(this.file(id, "submissions.jsonl"), "utf8");
      return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l)).reverse();
    } catch {
      return [];
    }
  }
}
