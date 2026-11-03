import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLicence } from "../server/licence.js";

const PORT = 4400 + Math.floor(Math.random() * 400);
const URL_ = `http://127.0.0.1:${PORT}`;
const auth = { Authorization: `Basic ${Buffer.from("admin:licence-pass").toString("base64")}`, "Content-Type": "application/json", "X-Requested-With": "eka" };
let server, dir, config;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "eka-lic-"));
  const pair = crypto.generateKeyPairSync("ed25519");
  await fs.mkdir(path.join(dir, "server"));
  await fs.writeFile(path.join(dir, "server", "private-key.pem"), pair.privateKey.export({ type: "pkcs8", format: "pem" }));
  config = { server: URL_, publicKey: pair.publicKey.export({ type: "spki", format: "pem" }) };
  server = spawn(process.execPath, ["licence-server/server.mjs"], { env: { ...process.env, PORT: String(PORT), LICENCE_DATA_DIR: path.join(dir, "server"), LICENCE_ADMIN_PASSWORD: "licence-pass" }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (d) => { if (String(d).includes("licence server on port")) resolve(); });
    server.on("exit", (c) => reject(new Error(`licence server exited ${c}`)));
    setTimeout(() => reject(new Error("licence server didn't start")), 10000);
  });
});
after(async () => { server?.kill(); await fs.rm(dir, { recursive: true, force: true }); });

const admin = (method, p, body) => fetch(`${URL_}/admin/api${p}`, { method, headers: auth, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
async function builder(name, opts = {}) {
  const d = path.join(dir, name);
  await fs.mkdir(d, { recursive: true });
  if (opts.firstRun) await fs.writeFile(path.join(d, ".first-run"), opts.firstRun);
  return createLicence({ dataDir: d, version: "0.1.0", env: { LICENCE_KEY: opts.key || "" }, config: opts.config ?? config, stats: () => ({ sites: 3, customers: 2 }) });
}

test("without a licence server configured, licensing is off", async () => {
  const lic = await builder("dev", { config: {} });
  assert.deepEqual([lic.status().mode, lic.status().allowed], ["off", true]);
});

test("a 14-day trial, then a key is needed", async () => {
  const fresh = await builder("trial");
  assert.equal(fresh.status().mode, "trial");
  assert.equal(fresh.status().daysLeft, 14);
  const old = await builder("trial-over", { firstRun: new Date(Date.now() - 15 * 86400_000).toISOString() });
  assert.deepEqual([old.status().mode, old.status().allowed], ["needed", false]);
  assert.match(old.status().reason, /trial has ended/);
});

test("keys: valid, server limits, cancelling, faked answers, updates and the offline grace period", async () => {
  const { licence } = await admin("POST", "/licences", { name: "Acme Hosting", servers: 1 });
  assert.match(licence.key, /^EKA-(\w{5}-){3}\w{5}$/);

  const one = await builder("one", { firstRun: new Date(Date.now() - 30 * 86400_000).toISOString() });
  assert.equal(one.status().mode, "needed");
  const st = await one.setKey(licence.key.toLowerCase());
  assert.deepEqual([st.mode, st.allowed, st.name], ["active", true, "Acme Hosting"]);
  const seen = (await admin("GET", "/licences")).licences[0].activations[0];
  assert.deepEqual([seen.sites, seen.customers, seen.version], [3, 2, "0.1.0"], "the licence server sees counts only");

  const two = await builder("two", { key: licence.key });
  assert.match((await two.check()).reason, /already in use on 1 server/);
  assert.equal(two.status().allowed, false);

  await admin("PUT", "/latest", { version: "0.2.0", notes: "Blog and shop", url: "https://example.com/update" });
  assert.deepEqual([(await one.check()).update, one.status().latest.version], [true, "0.2.0"]);

  // A saved answer for another key (or edited) doesn't count.
  const state = JSON.parse(await fs.readFile(path.join(dir, "one", "licence.json"), "utf8"));
  const forged = JSON.parse(Buffer.from(state.answer.payload, "base64").toString());
  forged.expires = "2099-01-01";
  state.answer.payload = Buffer.from(JSON.stringify(forged)).toString("base64");
  await fs.writeFile(path.join(dir, "one", "licence.json"), JSON.stringify(state));
  assert.equal((await builder("one")).status().allowed, false, "a tampered answer is rejected");

  // Offline: the last good answer counts for 14 days.
  const ok = await one.check();
  assert.equal(ok.mode, "active");
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 5 * 86400_000;
    assert.deepEqual([one.status().mode, one.status().allowed], ["grace", true]);
    Date.now = () => realNow() + 15 * 86400_000;
    assert.equal(one.status().allowed, false);
  } finally { Date.now = realNow; }

  await admin("PATCH", `/licences/${licence.key}`, { revoked: true });
  const cancelled = await one.check();
  assert.equal(cancelled.allowed, false);
  assert.match(cancelled.reason, /cancelled/);
});

test("the licence admin needs the password", async () => {
  const r = await fetch(`${URL_}/admin/api/licences`);
  assert.equal(r.status, 401);
  const forged = await fetch(`${URL_}/admin/api/licences`, { method: "POST", headers: { ...auth, "X-Requested-With": "" }, body: "{}" });
  assert.equal(forged.status, 415, "cross-site posts are refused");
});
