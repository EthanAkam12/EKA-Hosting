// Starts the real server (no AI, temporary data folder) and checks the
// customer and host API rules end to end.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 3900 + Math.floor(Math.random() * 500);
// The builder moves to the next port if this one is busy, so the real one comes from its output.
let BASE = `http://127.0.0.1:${PORT}`;
const KEY = "test-host-key-abc";
let server, dir;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "eka-server-"));
  server = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DATA_DIR: dir, ADMIN_PASSWORD: "admin-pass-1", HOST_API_KEY: KEY, ANTHROPIC_API_KEY: "", AI_PROVIDER: "demo", PEXELS_API_KEY: "", PIXABAY_API_KEY: "", SENDMAIL_PATH: "/nonexistent", SMTP_HOST: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (d) => {
      const m = String(d).match(/running on http:\/\/localhost:(\d+)/);
      if (m) { BASE = `http://127.0.0.1:${m[1]}`; resolve(); }
    });
    server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
    setTimeout(() => reject(new Error("server didn't start")), 15000);
  });
});
after(async () => { server?.kill(); await fs.rm(dir, { recursive: true, force: true }); });

// A tiny cookie-keeping client.
function client() {
  let cookie = "";
  return async (method, url, body, headers = {}) => {
    const res = await fetch(BASE + url, { method, redirect: "manual", headers: { "X-EKA-Request": "1", ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text, location: res.headers.get("location") };
  };
}
const hostApi = (method, url, body, key = KEY) => fetch(`${BASE}/api/host${url}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));

test("host API: sign-in links, plans, suspension and privacy between customers", async () => {
  assert.equal((await hostApi("GET", "/plans", null, "wrong")).status, 401);
  const plans = (await hostApi("GET", "/plans")).body.plans;
  assert.ok(plans.some((p) => p.id === "starter"));

  const sso = await hostApi("POST", "/sso", { account: "cpanel:web1:bob", email: "bob@bakery.test", plan: "Starter" });
  assert.equal(sso.status, 200);
  const bob = client();
  const signIn = await bob("GET", new URL(sso.body.url).pathname + new URL(sso.body.url).search);
  assert.equal(signIn.status, 303);
  assert.equal((await bob("GET", new URL(sso.body.url).pathname + new URL(sso.body.url).search)).status, 400, "links work once");
  const me = (await bob("GET", "/api/me")).body;
  assert.equal(me.role, "user");
  assert.equal(me.account.plan.name, "Starter");

  const site = (await bob("POST", "/api/sites", { name: "Bob's Bakery", blank: true })).body.site;
  assert.equal((await bob("POST", "/api/sites", { name: "Second", blank: true })).status, 400, "Starter has one website");

  const admin = client();
  assert.equal((await admin("POST", "/api/login", { password: "admin-pass-1" })).status, 200);
  const adminSite = (await admin("POST", "/api/sites", { name: "Admin site", blank: true })).body.site;
  const seen = (await admin("GET", "/api/sites")).body.sites;
  assert.equal(seen.find((s) => s.id === site.id).ownerEmail, "bob@bakery.test", "the admin sees whose site it is");

  // Another customer can't see Bob's site, the admin's, or admin pages.
  const carol = client();
  const created = await admin("POST", "/api/customers", { email: "carol@x.test", plan: "business" });
  assert.match(created.body.password, /^\w{4}-\w{4}-\w{4}-\w{4}$/);
  assert.equal((await carol("POST", "/api/login", { email: "carol@x.test", password: created.body.password })).status, 200);
  assert.deepEqual((await carol("GET", "/api/sites")).body.sites, []);
  assert.equal((await carol("GET", `/api/sites/${site.id}`)).status, 404);
  assert.equal((await carol("GET", `/api/sites/${adminSite.id}`)).status, 404);
  assert.equal((await carol("GET", "/api/customers")).status, 403);
  assert.equal((await carol("GET", "/api/billing.csv")).status, 403);

  // Suspending with takeSitesOffline: Bob is logged out and his live site goes down.
  await bob("POST", `/api/sites/${site.id}/publish`, {});
  assert.equal((await fetch(`${BASE}/s/${site.slug}/`)).status, 200);
  await hostApi("POST", "/accounts/suspend", { account: "cpanel:web1:bob", takeSitesOffline: true });
  assert.equal((await bob("GET", "/api/sites")).status, 401);
  assert.equal((await fetch(`${BASE}/s/${site.slug}/`)).status, 503);
  assert.equal((await hostApi("POST", "/sso", { account: "cpanel:web1:bob" })).status, 403);
  await hostApi("POST", "/accounts/unsuspend", { account: "cpanel:web1:bob" });
  assert.equal((await fetch(`${BASE}/s/${site.slug}/`)).status, 200);

  // Upgrades come through as plan changes; terminate removes the websites.
  await hostApi("POST", "/accounts", { account: "cpanel:web1:bob", plan: "business" });
  assert.equal((await hostApi("GET", "/accounts?account=cpanel:web1:bob")).body.customer.planName, "Business");
  await hostApi("POST", "/accounts/terminate", { account: "cpanel:web1:bob" });
  assert.equal((await hostApi("GET", "/accounts?account=cpanel:web1:bob")).status, 404);
  assert.equal((await fetch(`${BASE}/s/${site.slug}/`)).status, 404);

  const csv = (await admin("GET", "/api/billing.csv")).text;
  assert.match(csv, /^Month,Email,Name,Plan/);
  assert.match(csv, /carol@x\.test/);
});
