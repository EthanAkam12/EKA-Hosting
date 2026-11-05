import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStaff, guessDesign, localNow, AGENTS } from "../hq/server/staff.js";
import { createWhmcs, monthlyAmount } from "../hq/server/whmcs.js";
import { createNotifier } from "../hq/server/notify.js";

function fakes() {
  const calls = [];
  const whmcs = {
    enabled: true, adminUrl: "https://billing.test/admin",
    ticketsAwaitingReply: async () => [{ id: 5, tid: "XYZ-1", subject: "Email help", userid: 1, name: "Pat", lastreply: "2026-11-05 10:00" }],
    ticket: async () => ({ id: 5, tid: "XYZ-1", subject: "Email help", userid: 1, name: "Pat", deptname: "Support", replies: [{ from: "customer", at: "2026-11-05", text: "How do I get email on my phone?" }] }),
    client: async () => ({ fullname: "Pat Jones", companyname: "Pat's", email: "pat@x.test" }),
    products: async () => ({ total: 1, products: [{ id: 9, name: "Builder Business", status: "Active", recurringamount: "15.00", billingcycle: "Monthly" }] }),
    reply: async (id, text) => calls.push(["reply", id, text]),
    clients: async () => ({ total: 0, clients: [] }),
    invoices: async () => [],
    orders: async () => [{ id: 7, ordernum: "100", userid: 1, name: "Pat", amount: "£8.00", paymentstatus: "Paid", lineitems: { lineitem: [{ product: "Builder Starter", domain: "pat.test" }] } }],
    acceptOrder: async (id) => calls.push(["accept", id]),
    servers: async () => [{ id: 1, name: "web1", status: { http: false } }],
    stats: async () => ({ income_thismonth: "£1,234.50 GBP", income_today: "£0.00", income_thisyear: "£2,000.00", income_alltime: "£2,000.00", tickets_awaitingreply: 1 }),
    email: async (...a) => calls.push(["email", ...a]),
  };
  const builder = { enabled: false };
  const ai = { enabled: true, ask: async ({ kind }) => (kind === "hq-support" ? { reply: "Open Email Accounts, then Connect Devices.", summary: "Email on phone", needsHuman: false, confidence: "high" } : { text: "Morning!" }) };
  const sent = [];
  const notifier = { enabled: true, channels: ["ntfy"], send: async (m) => { sent.push(m); return { sent: ["ntfy"], errors: [] }; } };
  return { calls, whmcs, builder, ai, notifier, sent, mailer: { enabled: false } };
}

test("HQ staff: tickets, orders, alerts, approvals and messages to your phone", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hq-"));
  const f = fakes();
  let clock = new Date("2026-11-05T12:00:00Z");
  const staff = createStaff({ dataDir: dir, ...f, now: () => clock, business: "EKA Hosting" });
  await staff.init();

  assert.equal(await staff.checkTickets(), 1);
  assert.equal(await staff.checkTickets(), 0, "the same ticket isn't drafted twice");
  const reply = staff._tasks().find((t) => t.kind === "reply");
  assert.equal(reply.status, "waiting");
  assert.match(reply.draft.text, /Connect Devices/);
  await staff.approve(reply.id, { draft: { text: "Edited reply" } });
  assert.deepEqual(f.calls.at(-1), ["reply", 5, "Edited reply"]);

  await staff.opsCheck();
  const order = staff._tasks().find((t) => t.kind === "order");
  assert.match(order.title, /New order #100/);
  assert.ok(staff._tasks().some((t) => t.status === "alert" && /web1 looks down/.test(t.title)));
  await staff.approve(order.id);
  assert.deepEqual(f.calls.at(-1), ["accept", 7]);

  // You haven't looked at HQ for a while, so Henry messages your phone (urgent: a server is down).
  clock = new Date(clock.getTime() + 20 * 60_000);
  await staff.sendNotes();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].title, /Henry: \d+ things? need/);
  assert.ok(f.sent[0].urgent);
  // While you're in HQ, no messages.
  staff.seen();
  staff._tasks().push({ id: "x", agent: "ops", status: "waiting", title: "t", updatedAt: clock.toISOString(), createdAt: clock.toISOString(), data: {} });
  await staff.sendNotes();
  assert.equal(f.sent.length, 1);

  const s = await staff.stats({ fresh: true });
  assert.equal(s.whmcs.incomeMonth, 1234.5);
  assert.equal(s.whmcs.mrr, 15);
  const b = await staff.briefing();
  assert.equal(b.text, "Morning!");
  assert.equal(f.sent.at(-1).title, "Henry's morning briefing");
  assert.ok(staff.ideas().length >= 10, "Mia starts with a marketing plan");
  assert.deepEqual(Object.keys(AGENTS), ["boss", "support", "builder", "account", "ops", "marketing"]);
});

test("HQ helpers: designs, time zones, recurring revenue", () => {
  assert.equal(guessDesign("Emergency plumber in Leeds"), "trades");
  assert.equal(guessDesign("Rosie's Bakery"), "restaurant");
  assert.equal(guessDesign("Something else"), "onepage");
  const lt = localNow("Europe/London", new Date("2026-07-06T08:30:00Z"));
  assert.deepEqual([lt.date, lt.hour, lt.weekday], ["2026-07-06", 9, 1], "British Summer Time");
  assert.equal(monthlyAmount("120.00", "Annually"), 10);
  assert.equal(monthlyAmount("30", "Quarterly"), 10);
  assert.equal(monthlyAmount("5", "Free Account"), 0);
});

test("WHMCS client and phone messages: request shapes", async () => {
  let sent;
  const w = createWhmcs({ url: "https://billing.test/", identifier: "i", secret: "s", fetchImpl: async (url, o) => { sent = { url, body: Object.fromEntries(new URLSearchParams(String(o.body))) }; return new Response(JSON.stringify({ result: "success", tickets: { ticket: [{ id: 1 }] } })); } });
  assert.deepEqual(await w.ticketsAwaitingReply(), [{ id: 1 }]);
  assert.equal(sent.url, "https://billing.test/includes/api.php");
  assert.equal(sent.body.action, "GetTickets");
  assert.equal(sent.body.responsetype, "json");
  const bad = createWhmcs({ url: "https://b.test", identifier: "i", secret: "s", fetchImpl: async () => new Response(JSON.stringify({ result: "error", message: "Invalid IP 1.2.3.4" })) });
  await assert.rejects(bad.stats(), /Invalid IP/);
  assert.equal(createWhmcs({}).enabled, false);

  const posts = [];
  const n = createNotifier({ env: { NTFY_TOPIC: "eka-hq-secret" }, fetchImpl: async (url, o) => { posts.push({ url, o }); return new Response("{}"); } });
  const r = await n.send({ title: "Henry: 2 things need you", text: "• a\n• b", url: "https://hq.test", urgent: true });
  assert.deepEqual(r.sent, ["ntfy"]);
  assert.equal(posts[0].url, "https://ntfy.sh/eka-hq-secret");
  assert.equal(posts[0].o.headers.Priority, "high");
  assert.equal(posts[0].o.headers.Click, "https://hq.test");
});
