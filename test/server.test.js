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


test("host API for EKA HQ: overview, building a site, review links, site details", async () => {
  const o = await hostApi("GET", "/hq/overview");
  assert.equal(o.status, 200);
  assert.ok(o.body.designs.some((d) => d.id === "trades"));
  assert.equal((await hostApi("GET", "/hq/overview", null, "wrong")).status, 401);
  await hostApi("POST", "/accounts", { account: "whmcs:9", email: "jo@trades.test" });
  const built = await hostApi("POST", "/hq/build", { design: "trades", brief: { name: "Jo's Plumbing", description: "Plumber in York" }, account: "whmcs:9" });
  assert.equal(built.status, 200);
  assert.equal(built.body.site.owner.email, "jo@trades.test");
  let info;
  for (let i = 0; i < 80; i++) { info = (await hostApi("GET", `/hq/sites/${built.body.site.id}`)).body; if (info.site.status === "ready") break; await new Promise((r) => setTimeout(r, 250)); }
  assert.equal(info.site.status, "ready");
  assert.ok(Array.isArray(info.submissions) && info.stats.visitors === 0);
  const review = await hostApi("POST", `/hq/sites/${built.body.site.id}/review`, {});
  assert.match(review.body.url, /\/review\/[\w-]+$/);
  assert.equal((await fetch(BASE + new URL(review.body.url).pathname)).status, 200);
  assert.equal((await hostApi("POST", "/hq/build", { design: "nope", brief: {} })).status, 400);
  assert.equal((await hostApi("POST", `/hq/sites/${built.body.site.id}/write-post`, { topic: "x" })).status, 400, "posts need AI");
});

test("EKA Hosting's own website imports into the builder and renders", async () => {
  const { ekaWebsite } = await import("../shared/eka-website.js");
  const site = ekaWebsite({ name: "EKA Hosting", images: { editor: "hq-image:shot.webp" } });
  assert.deepEqual(site.pages.filter((p) => !p.post).map((p) => p.slug), ["index", "website-builder", "web-hosting", "web-design", "pricing", "blog", "contact", "website-brief"]);
  const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const res = await fetch(`${BASE}/api/host/hq/import`, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "EKA Hosting", site, images: { "shot.webp": tinyPng, "../evil.webp": tinyPng } }) });
  const out = await res.json();
  assert.equal(res.status, 200, JSON.stringify(out));
  const info = (await hostApi("GET", `/hq/sites/${out.site.id}`)).body;
  assert.equal(info.posts.length, 1);
  const admin = client();
  await admin("POST", "/api/login", { password: "admin-pass-1" });
  const page = await admin("GET", `/admin/preview/${out.site.id}/pricing/`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Builder Business/);
  assert.match(page.text, /£299/);
  const home = await admin("GET", `/admin/preview/${out.site.id}/`);
  assert.match(home.text, new RegExp(`/_m/${out.site.id}/shot\\.webp`), "screenshots are added to the site's images");
  assert.equal((await fetch(`${BASE}/api/host/hq/import`, { method: "POST", headers: { Authorization: "Bearer nope", "Content-Type": "application/json" }, body: "{}" })).status, 401);
});

test("forms take photos: pictures are checked, kept privately and passed to a new website", async () => {
  const { ekaWebsite } = await import("../shared/eka-website.js");
  const sharp = (await import("sharp")).default;
  const imp = await (await fetch(`${BASE}/api/host/hq/import`, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Uploads test", site: ekaWebsite() }) })).json();
  const admin = client();
  await admin("POST", "/api/login", { password: "admin-pass-1" });
  await admin("POST", `/api/sites/${imp.site.id}/publish`, {});
  const html = await (await fetch(`${BASE}/s/${imp.site.slug}/website-brief/`)).text();
  assert.match(html, /enctype="multipart\/form-data"/);
  const block = html.match(/name="_block" value="([^"]+)"/)[1];
  const fd = new FormData();
  fd.set("_block", block); fd.set("_page", "website-brief");
  fd.set("field_0", "Rosie's Bakes"); fd.set("field_1", "Cakes in Leeds."); fd.set("field_9", "rosie@example.test"); fd.set("field_15", "Yes");
  fd.append("field_12", new Blob([await sharp({ create: { width: 120, height: 60, channels: 3, background: "#c2410c" } }).png().toBuffer()], { type: "image/png" }), "logo.png");
  fd.append("field_13", new Blob([Buffer.from("not a picture")], { type: "image/jpeg" }), "evil.jpg");
  assert.equal((await fetch(`${BASE}/_forms/${imp.site.id}`, { method: "POST", body: fd, redirect: "manual" })).status, 303);
  const sub = (await hostApi("GET", `/hq/sites/${imp.site.id}`)).body.submissions[0];
  assert.equal(sub.files["Your logo (optional)"].length, 1);
  assert.equal(sub.files["Photos of your business or your work (optional, up to 6)"], undefined, "not a real picture, so not kept");
  const file = sub.files["Your logo (optional)"][0];
  assert.equal((await admin("GET", `/api/sites/${imp.site.id}/uploads/${file}`)).status, 200);
  assert.equal((await fetch(`${BASE}/api/sites/${imp.site.id}/uploads/${file}`)).status, 401, "private");
  const built = await hostApi("POST", "/hq/build", { design: "restaurant", fill: false, brief: { name: "Rosie's Bakes", description: "Cakes made to order." }, uploads: { siteId: imp.site.id, logo: [file], photos: [] } });
  let info;
  for (let i = 0; i < 80; i++) { info = (await hostApi("GET", `/hq/sites/${built.body.site.id}`)).body; if (info.site.status === "ready") break; await new Promise((r) => setTimeout(r, 250)); }
  const page = await admin("GET", `/admin/preview/${built.body.site.id}/`);
  assert.match(page.text, new RegExp(`/_m/${built.body.site.id}/[a-f0-9]+\\.webp`), "the logo is on the new website");
  assert.doesNotMatch(page.text, /Book a table/, "no restaurant wording for a cake maker");
});
