// Customer accounts and the plans they're on, kept in DATA_DIR/users.json.
//
// The host (the administrator, who logs in with ADMIN_PASSWORD) adds
// customers by hand or through the host API (control panels, billing
// systems). Each customer sees only their own websites, and their plan sets
// how many websites they can have and how much AI they can use each month.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_PLANS = [
  { id: "starter", name: "Starter", sites: 1, aiMonthly: 1 },
  { id: "business", name: "Business", sites: 5, aiMonthly: 5 },
  { id: "agency", name: "Agency", sites: 25, aiMonthly: 25 },
];

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]{2,}$/;
const scrypt = (password, salt) => new Promise((resolve, reject) => crypto.scrypt(String(password), salt, 32, (err, key) => (err ? reject(err) : resolve(key.toString("hex")))));
const newId = () => crypto.randomBytes(8).toString("hex");
const newSessionKey = () => crypto.randomBytes(6).toString("hex");

export function cleanPlan(input = {}, existing = {}) {
  const num = (v, min, max, fallback) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Math.max(min, Math.min(max, Number(v))) : fallback);
  return {
    id: existing.id || String(input.id || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30) || newId(),
    name: String(input.name ?? existing.name ?? "Plan").trim().slice(0, 60) || "Plan",
    sites: Math.round(num(input.sites, 0, 10000, existing.sites ?? 1)),
    // US$ of AI cost per calendar month; 0 = no AI on this plan.
    aiMonthly: Math.round(num(input.aiMonthly, 0, 100000, existing.aiMonthly ?? 1) * 100) / 100,
  };
}

export class Users {
  constructor(dataDir) {
    this.file = path.join(dataDir, "users.json");
    this.data = { users: [], plans: [] };
    this.writing = Promise.resolve();
  }

  async init() {
    try {
      this.data = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch {
      this.data = { users: [], plans: DEFAULT_PLANS.map((p) => ({ ...p })) };
      await this.save();
    }
    this.data.users ||= [];
    this.data.plans ||= [];
  }

  save() {
    // One write at a time, each a full replace via a temporary file.
    this.writing = this.writing.then(async () => {
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
      await fs.rename(tmp, this.file);
    });
    return this.writing;
  }

  // ---- plans ----------------------------------------------------------------

  plans() { return this.data.plans; }
  plan(id) { return this.data.plans.find((p) => p.id === id) || null; }

  async savePlan(input) {
    const existing = input.id ? this.plan(input.id) : null;
    const plan = cleanPlan(input, existing || {});
    if (existing) Object.assign(existing, plan);
    else {
      if (this.plan(plan.id)) plan.id = `${plan.id}-${newId().slice(0, 4)}`;
      this.data.plans.push(plan);
    }
    await this.save();
    return plan;
  }

  async removePlan(id) {
    if (this.data.users.some((u) => u.plan === id)) throw new Error("Customers are on this plan. Move them to another plan first.");
    this.data.plans = this.data.plans.filter((p) => p.id !== id);
    await this.save();
  }

  // ---- customers ------------------------------------------------------------

  list() { return this.data.users; }
  get(id) { return this.data.users.find((u) => u.id === id) || null; }
  byEmail(email) { const e = String(email || "").trim().toLowerCase(); return this.data.users.find((u) => u.email === e) || null; }
  byExternal(ref) { return this.data.users.find((u) => u.external && u.external === ref) || null; }

  /** Creates a customer. Without a password one is made up (returned once). */
  async create({ email, name = "", plan, password, external = "" }) {
    const mail = String(email || "").trim().toLowerCase();
    if (!EMAIL.test(mail)) throw new Error("That email address doesn't look right.");
    if (this.byEmail(mail)) throw new Error("There's already a customer with that email address.");
    const planId = this.plan(plan) ? plan : this.data.plans[0]?.id || null;
    const pw = password || randomPassword();
    if (pw.length < 8) throw new Error("Passwords need at least 8 characters.");
    const salt = crypto.randomBytes(16).toString("hex");
    const user = {
      id: newId(), email: mail, name: String(name).trim().slice(0, 100), plan: planId,
      salt, hash: await scrypt(pw, salt), sessionKey: newSessionKey(),
      // e.g. "cpanel:server1:bob", for control panels that log customers in.
      external: String(external || "").slice(0, 200),
      disabled: false, createdAt: new Date().toISOString(), lastLogin: null,
    };
    this.data.users.push(user);
    await this.save();
    return { user, password: password ? undefined : pw };
  }

  async update(id, patch = {}) {
    const user = this.get(id);
    if (!user) throw new Error("Customer not found.");
    if (patch.email !== undefined) {
      const mail = String(patch.email).trim().toLowerCase();
      if (!EMAIL.test(mail)) throw new Error("That email address doesn't look right.");
      if (mail !== user.email && this.byEmail(mail)) throw new Error("There's already a customer with that email address.");
      user.email = mail;
    }
    if (patch.name !== undefined) user.name = String(patch.name).trim().slice(0, 100);
    if (patch.plan !== undefined && this.plan(patch.plan)) user.plan = patch.plan;
    if (patch.disabled !== undefined) {
      user.disabled = !!patch.disabled;
      if (user.disabled) user.sessionKey = newSessionKey(); // logs them out
    }
    if (patch.external !== undefined) user.external = String(patch.external).slice(0, 200);
    await this.save();
    return user;
  }

  /** Sets a new password (made up if none is given) and logs out every session. */
  async setPassword(id, password) {
    const user = this.get(id);
    if (!user) throw new Error("Customer not found.");
    const pw = password || randomPassword();
    if (pw.length < 8) throw new Error("Passwords need at least 8 characters.");
    user.salt = crypto.randomBytes(16).toString("hex");
    user.hash = await scrypt(pw, user.salt);
    user.sessionKey = newSessionKey();
    await this.save();
    return pw;
  }

  async remove(id) {
    this.data.users = this.data.users.filter((u) => u.id !== id);
    await this.save();
  }

  /** The customer for these details, or null. Takes the same time either way. */
  async check(email, password) {
    const user = this.byEmail(email);
    const hash = await scrypt(password, user?.salt || "no-such-user-salt");
    if (!user || user.disabled) return null;
    const a = Buffer.from(hash, "hex"), b = Buffer.from(user.hash, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? user : null;
  }

  async touch(id) {
    const user = this.get(id);
    if (user) { user.lastLogin = new Date().toISOString(); await this.save(); }
  }
}

/** What the browser may see of a customer. */
export const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.name, plan: u.plan, disabled: !!u.disabled, external: u.external || "", createdAt: u.createdAt, lastLogin: u.lastLogin });

// Easy to read out, hard to guess: four groups of four, no look-alike characters.
export function randomPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 16 }, () => chars[crypto.randomInt(chars.length)]).join("").match(/.{4}/g).join("-");
}
