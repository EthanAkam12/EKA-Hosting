import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Users } from "../server/users.js";
import { createAuth } from "../server/auth.js";

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eka-users-"));
  const users = new Users(dir);
  await users.init();
  const auth = createAuth({ password: "admin-pass-123", secret: "s", secure: false, users });
  return { dir, users, auth };
}

// Minimal request/response stand-ins for the auth module.
const req = (body = {}, cookie = "") => ({ ip: `10.0.0.${Math.floor(Math.random() * 250)}`, body, headers: { cookie } });
function res() {
  const r = { statusCode: 200, headers: {}, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.cookie = () => String(r.headers["set-cookie"] || "").split(";")[0];
  return r;
}

test("customers log in with email and password; the admin with the password alone", async () => {
  const { dir, users, auth } = await setup();
  assert.deepEqual(users.plans().map((p) => p.name), ["Starter", "Business", "Pro"], "default plans");
  const { user, password } = await users.create({ email: "Sam@Shop.test", name: "Sam's Shop", plan: "business" });
  assert.equal(user.email, "sam@shop.test");
  assert.match(password, /^[\w]{4}-[\w]{4}-[\w]{4}-[\w]{4}$/);
  assert.ok(!JSON.stringify(user).includes(password), "only a hash is kept");
  await assert.rejects(users.create({ email: "sam@shop.test" }), /already a customer/);

  let r = res();
  await auth.login(req({ email: "sam@shop.test", password: "wrong-password" }), r);
  assert.equal(r.statusCode, 401);
  r = res();
  await auth.login(req({ email: "SAM@shop.test", password }), r);
  assert.equal(r.statusCode, 200);
  const me = auth.user(req({}, r.cookie()));
  assert.deepEqual([me.role, me.id, me.plan], ["user", user.id, "business"]);

  r = res();
  await auth.login(req({ password: "admin-pass-123" }), r);
  assert.equal(auth.user(req({}, r.cookie())).role, "admin");

  // A new password, or disabling the customer, ends their sessions.
  const cookie = (await (async () => { const x = res(); await auth.login(req({ email: "sam@shop.test", password }), x); return x.cookie(); })());
  await users.setPassword(user.id, "brand-new-pass");
  assert.equal(auth.user(req({}, cookie)), null);
  r = res();
  await auth.login(req({ email: "sam@shop.test", password: "brand-new-pass" }), r);
  const fresh = r.cookie();
  await users.update(user.id, { disabled: true });
  assert.equal(auth.user(req({}, fresh)), null);
  r = res();
  await auth.login(req({ email: "sam@shop.test", password: "brand-new-pass" }), r);
  assert.equal(r.statusCode, 401, "disabled customers can't log in");
  await fs.rm(dir, { recursive: true });
});

test("one-time sign-in links and password reset links", async () => {
  const { dir, users, auth } = await setup();
  const { user } = await users.create({ email: "jo@x.test" });
  const token = auth.loginLink(user, 60);
  const r = res();
  assert.equal((await auth.useLoginLink(req(), r, token))?.id, user.id);
  assert.equal(auth.user(req({}, r.cookie())).id, user.id);
  assert.equal(await auth.useLoginLink(req(), res(), token), null, "a link works once");
  assert.equal(await auth.useLoginLink(req(), res(), token.replace(/.$/, "x")), null, "tampered links fail");

  const reset = auth.resetLink(user);
  assert.equal(auth.readResetLink(reset)?.id, user.id);
  assert.equal(await auth.useLoginLink(req(), res(), reset), null, "a reset link isn't a sign-in link");
  await users.setPassword(user.id, "another-pass-1");
  assert.equal(auth.readResetLink(reset), null, "used up once the password changes");
  await fs.rm(dir, { recursive: true });
});

test("plans can be edited, but not deleted while customers are on them", async () => {
  const { dir, users } = await setup();
  const plan = await users.savePlan({ name: "Pro", sites: "10", aiMonthly: "7.5" });
  assert.deepEqual([plan.sites, plan.aiMonthly], [10, 7.5]);
  await users.create({ email: "a@b.test", plan: plan.id });
  await assert.rejects(users.removePlan(plan.id), /Customers are on this plan/);
  await users.savePlan({ id: plan.id, aiMonthly: 0 });
  assert.equal(users.plan(plan.id).aiMonthly, 0);
  const again = new Users(dir);
  await again.init();
  assert.equal(again.byEmail("a@b.test").plan, plan.id, "saved to disk");
  await fs.rm(dir, { recursive: true });
});
