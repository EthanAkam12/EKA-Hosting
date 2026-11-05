// EKA HQ's staff: six AI team members who run the day-to-day of EKA Hosting
// and bring anything that reaches a customer or costs money to you first.
//
//   Henry (boss)       morning briefing, weekly team meeting, hands you the work, messages your phone
//   Sam   (support)    WHMCS tickets → a drafted reply
//   Bea   (builder)    done-for-you website orders → a site and a review link
//   Alex  (accounts)   welcome emails, overdue-invoice reminders, monthly check-ins
//   Otto  (operations) new orders to accept, servers, backups, disk, licence, failed sites, domains, unpaid services
//   Mia   (marketing)  social posts, blog posts, enquiry follow-ups, new ideas
//
// Work is stored as tasks: { id, agent, kind, key?, title, summary, status, createdAt, updatedAt, data, draft? }
// status: working → waiting (needs you) / alert → done | dismissed | failed

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { monthlyAmount } from "./whmcs.js";
import { IDEAS } from "./marketing-plan.js";

export const AGENTS = {
  boss: { name: "Henry", role: "Boss", colour: "#0f766e" },
  support: { name: "Sam", role: "Support", colour: "#2563eb" },
  builder: { name: "Bea", role: "Web designer", colour: "#16a34a" },
  account: { name: "Alex", role: "Accounts", colour: "#9333ea" },
  ops: { name: "Otto", role: "Operations", colour: "#ea580c" },
  marketing: { name: "Mia", role: "Marketing", colour: "#db2777" },
};
export const STAFF = ["support", "builder", "account", "ops", "marketing"];

const DEFAULT_SETTINGS = {
  boss: { on: true, briefingHour: 8, meetingDay: 1, meetingHour: 9, notifyAway: true },
  support: { on: true, autoSend: false },
  builder: { on: true },
  account: { on: true, welcome: true, overdue: true, checkins: true },
  ops: { on: true, suspendAfterDays: 21 },
  marketing: { on: true, siteId: "", about: "" },
};

const MIN = 60_000, HOUR = 3600_000, DAY = 86400_000;
const newId = () => crypto.randomBytes(6).toString("hex");
const money = (v) => { const m = String(v ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : 0; };

// A design for a business description, without AI.
export function guessDesign(text) {
  const t = String(text || "").toLowerCase();
  const rules = [
    [/restaurant|caf[eé]|coffee|bakery|pub|bistro|takeaway|food|bar\b/, "restaurant"],
    [/plumb|electric|build|roof|joiner|carpent|clean|garden|landscap|decorat|handyman|heating|locksmith|removal/, "trades"],
    [/salon|beauty|hair|nail|barber|spa|massage|lash|brow|aesthetic/, "salon"],
    [/gym|fitness|personal train|yoga|pilates|coach|boxing|martial/, "fitness"],
    [/shop|boutique|store|gift|jewel|clothing|fashion|candle|crafts/, "boutique"],
    [/account|solicitor|lawyer|legal|consult|financ|mortgage|insurance|agency|architect/, "professional"],
    [/photo|videograph|design|artist|illustrat|studio|wedding/, "portfolio"],
    [/b&b|bed and breakfast|cottage|holiday|guest house|hotel|glamping|camping/, "bnb"],
    [/charity|community|club|church|school|volunteer|association|society/, "community"],
  ];
  return rules.find(([re]) => re.test(t))?.[1] || "onepage";
}

// Local date and time (the business's time zone) for schedules.
export function localNow(tz = "Europe/London", now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, month: `${p.year}-${p.month}`, hour: Number(p.hour), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), day: Number(p.day) };
}
const weekKey = (d) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };

export function createStaff({ dataDir, ai, whmcs, builder, mailer, notifier, ownerName = "", publicUrl = "", tz = "Europe/London", helpText = () => "", business = "EKA Hosting", now = () => new Date() }) {
  const file = (name) => path.join(dataDir, name);
  let tasks = [], activity = [], meetings = [], briefings = [], snapshots = {}, ideas = [];
  let settings = structuredClone(DEFAULT_SETTINGS);
  let state = { last: {}, notifiedAt: 0 };
  let writing = Promise.resolve();
  const busy = new Map(); // agent → what they're doing
  let pendingNotes = [];
  let lastSeen = 0;
  let meetingLive = null; // { id, until }
  let statsCache = { at: 0, value: null };

  // ---- storage ----------------------------------------------------------------
  async function init() {
    await fs.mkdir(dataDir, { recursive: true });
    const read = async (name, fallback) => { try { return JSON.parse(await fs.readFile(file(name), "utf8")); } catch { return fallback; } };
    tasks = await read("tasks.json", []);
    activity = await read("activity.json", []);
    meetings = await read("meetings.json", []);
    briefings = await read("briefings.json", []);
    snapshots = await read("snapshots.json", {});
    ideas = await read("ideas.json", null) || IDEAS.map((i) => ({ id: newId(), ...i, status: "idea", by: "marketing", at: now().toISOString() }));
    const saved = await read("settings.json", {});
    for (const k of Object.keys(DEFAULT_SETTINGS)) settings[k] = { ...DEFAULT_SETTINGS[k], ...(saved[k] || {}) };
    state = { ...state, ...(await read("state.json", {})) };
    for (const t of tasks) if (t.status === "working") Object.assign(t, { status: "failed", summary: "Stopped when HQ restarted. Try it again." });
    await save();
  }
  function save() {
    writing = writing.then(async () => {
      tasks = tasks.slice(-1000);
      activity = activity.slice(-3000);
      const files = [["tasks.json", tasks], ["activity.json", activity], ["meetings.json", meetings.slice(-100)], ["briefings.json", briefings.slice(-120)], ["snapshots.json", snapshots], ["ideas.json", ideas], ["settings.json", settings], ["state.json", state]];
      for (const [name, value] of files) {
        const tmp = `${file(name)}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
        await fs.rename(tmp, file(name));
      }
    }).catch((err) => console.warn("HQ not saved:", err.message));
    return writing;
  }

  // ---- tasks and the activity log --------------------------------------------------
  function log(agent, text) {
    activity.push({ at: now().toISOString(), agent, text: String(text).slice(0, 300) });
    save();
  }
  function addTask(agent, fields) {
    const at = now().toISOString();
    const task = { id: newId(), agent, status: "working", createdAt: at, updatedAt: at, data: {}, ...fields };
    tasks.push(task);
    if (["waiting", "alert"].includes(task.status)) noteForYou(task);
    save();
    return task;
  }
  function update(task, patch) {
    const before = task.status;
    Object.assign(task, patch, { updatedAt: now().toISOString() });
    if (before !== task.status && ["waiting", "alert"].includes(task.status)) noteForYou(task);
    save();
    return task;
  }
  const on = (agent) => settings[agent]?.on !== false;
  async function run(agent, what, fn) {
    busy.set(agent, what);
    try { return await fn(); } catch (err) {
      console.warn(`[HQ ${agent}]`, err.message);
      log(agent, `Problem while ${what.toLowerCase()}: ${err.message}`);
    } finally { busy.delete(agent); }
  }
  async function work(agent, task, what, fn) {
    busy.set(agent, what);
    try { await fn(); } catch (err) {
      console.warn(`[HQ ${agent}]`, err.message);
      update(task, { status: "failed", summary: err.message });
      log(agent, `Couldn't finish "${task.title}": ${err.message}`);
    } finally { busy.delete(agent); }
  }
  const has = (key) => tasks.some((t) => t.key === key);

  async function sendEmail({ clientId, to, subject, text }) {
    if (clientId && whmcs.enabled) return whmcs.email(clientId, subject, text);
    if (!to) throw new Error("There's no email address to send it to.");
    if (!mailer.enabled) throw new Error("Email isn't set up for HQ (SMTP settings in hq-settings.txt). Copy the text and send it yourself, then press \"I sent it myself\".");
    await mailer.send({ to, subject, text, fromName: business });
  }

  // ---- Henry: messages to your phone ------------------------------------------------
  function noteForYou(task) {
    pendingNotes.push({ title: task.title, urgent: task.status === "alert" && /down|offline|failed|full/i.test(task.title) });
  }
  const away = () => now().getTime() - lastSeen > 10 * MIN;
  async function sendNotes({ force = false } = {}) {
    if (!pendingNotes.length || !notifier.enabled || !settings.boss.notifyAway || !on("boss")) return;
    if (!force && !away()) { pendingNotes = []; return; } // you're looking at HQ already
    const urgent = pendingNotes.some((n) => n.urgent);
    if (!force && !urgent && now().getTime() - (state.notifiedAt || 0) < 30 * MIN) return; // at most every half hour
    const waiting = tasks.filter((t) => t.status === "waiting" || t.status === "alert").length;
    const lines = pendingNotes.slice(0, 6).map((n) => `• ${n.title}`);
    if (pendingNotes.length > 6) lines.push(`…and ${pendingNotes.length - 6} more`);
    pendingNotes = [];
    state.notifiedAt = now().getTime();
    save();
    await notifier.send({ title: `Henry: ${waiting} thing${waiting === 1 ? "" : "s"} need${waiting === 1 ? "s" : ""} you`, text: lines.join("\n"), url: publicUrl, urgent });
    log("boss", `Messaged your phone about ${lines.length} new item${lines.length === 1 ? "" : "s"}.`);
  }

  // ---- Sam: WHMCS tickets -----------------------------------------------------------
  const SUPPORT_SYSTEM = (help) => `You are Sam, the friendly support assistant at ${business}, a UK web hosting company that also provides the EKA website builder and done-for-you websites.
Write a reply to the customer's latest message in this support ticket: warm, plain English, short paragraphs, specific steps (name the exact buttons and menus), no jargon. Sign off as "${business} Support".
Only use facts from the HELP PAGES and the customer's account details. If it needs someone to look at their account or server, a refund, a price change, a cancellation, or anything you can't be sure of, say a person will look into it, and set needsHuman true.
Respond with ONLY JSON: { "reply": string, "summary": string (one line for the team), "needsHuman": boolean, "confidence": "high" | "low" }

HELP PAGES:
${help}`;

  async function checkTickets() {
    if (!on("support") || !whmcs.enabled) return 0;
    let n = 0;
    await run("support", "Reading new tickets", async () => {
      const list = await whmcs.ticketsAwaitingReply();
      for (const row of list) {
        const key = `ticket:${row.id}:${row.lastreply}`;
        if (has(key)) continue;
        // An older draft for this ticket is out of date now.
        for (const t of tasks) if (t.data?.ticketId === Number(row.id) && t.status === "waiting") update(t, { status: "dismissed", summary: "Replaced: the customer wrote again." });
        n++;
        await draftTicket(row, key);
      }
    });
    return n;
  }

  async function draftTicket(row, key) {
    const task = addTask("support", { kind: "reply", key, title: `Ticket #${row.tid}: ${row.subject}`, summary: "Reading the ticket and the help pages…", data: { ticketId: Number(row.id), tid: row.tid, clientId: Number(row.userid) || 0, from: row.name || row.email } });
    await work("support", task, "Drafting a reply", async () => {
      const t = await whmcs.ticket(row.id);
      if (!ai.enabled) return update(task, { status: "waiting", summary: `From ${t.name || t.email}. AI is off, so write the reply yourself.`, draft: { text: "" } });
      let account = "Not a registered customer.";
      if (t.userid) {
        const [c, p] = await Promise.all([whmcs.client(t.userid).catch(() => null), whmcs.products({ clientId: t.userid }).catch(() => ({ products: [] }))]);
        account = `Customer: ${c?.fullname || t.name} (${c?.companyname || "no company"}). Services: ${p.products.map((x) => `${x.name || x.groupname} ${x.domain ? `for ${x.domain}` : ""} (${x.status}, next due ${x.nextduedate})`).join("; ") || "none"}.`;
      }
      const thread = t.replies.map((m) => `${m.from === "customer" ? "CUSTOMER" : "SUPPORT"} (${String(m.at).slice(0, 16)}): ${m.text}`).join("\n\n");
      const out = await ai.ask({ kind: "hq-support", system: SUPPORT_SYSTEM(helpText()), prompt: `${account}\nDepartment: ${t.deptname}\nSubject: ${t.subject}\n\nTICKET:\n${thread}` });
      const reply = String(out.reply || "").trim();
      update(task, { status: "waiting", summary: `${out.needsHuman ? "⚑ Needs a person. " : ""}${String(out.summary || "Reply drafted.").slice(0, 200)}`, draft: { text: reply }, data: { ...task.data, needsHuman: !!out.needsHuman, confidence: out.confidence } });
      log("support", `Drafted a reply to ticket #${row.tid} (${row.subject}).`);
      if (settings.support.autoSend && out.confidence === "high" && !out.needsHuman && reply) await approve(task.id, {});
    });
  }

  // ---- Bea: done-for-you websites ------------------------------------------------------
  async function newMission(input) {
    if (!builder.enabled) throw new Error("Connect the builder first (Settings tab).");
    const brief = { name: String(input.name || "").trim().slice(0, 120), description: String(input.description || "").trim().slice(0, 6000), phone: String(input.phone || "").slice(0, 60), email: String(input.email || "").slice(0, 200), address: String(input.address || "").slice(0, 300) };
    if (!brief.name) throw new Error("Give the business a name.");
    const design = input.design && input.design !== "auto" ? input.design : guessDesign(`${brief.name} ${brief.description}`);
    const sendTo = String(input.sendTo || brief.email || "").trim();
    const task = addTask("builder", { kind: "build", title: `Build a website for ${brief.name}`, summary: `Starting from the "${design}" design…`, data: { design, brief, sendTo, clientId: Number(input.clientId) || 0 } });
    log("builder", `Started building a website for ${brief.name}.`);
    work("builder", task, "Building a website", async () => {
      let account;
      if (sendTo) { await builder.account({ email: sendTo, name: brief.name, account: input.clientId ? `whmcs:${input.clientId}` : undefined }).catch(() => null); account = sendTo; }
      const { site, editor } = await builder.build({ design, brief, email: account });
      update(task, { data: { ...task.data, siteId: site.id, editor }, summary: ai.enabled ? "Writing every page for the business…" : "Building from the template…" });
      for (let i = 0; ; i++) {
        const info = await builder.site(site.id).catch(() => null);
        if (info?.site.status === "ready") { task.data.advice = info.advice; break; }
        if (info?.site.status === "error") throw new Error(`The build failed: ${info.site.error}`);
        if (i > 400) throw new Error("The build took too long. Open it in the builder to see how far it got.");
        await new Promise((r) => setTimeout(r, 3000));
      }
      const { url } = await builder.reviewLink(site.id);
      const left = task.data.advice || [];
      update(task, {
        status: "waiting",
        summary: `Ready for you to check before it goes to the customer.${left.length ? ` Still to do: ${left.slice(0, 3).join("; ")}.` : ""}`,
        data: { ...task.data, review: url },
        draft: { to: sendTo, subject: `Your new website is ready to look at: ${brief.name}`, text: `Hello,\n\nYour new website for ${brief.name} is ready for you to look at:\n${url}\n\nClick anything on the page to leave a comment about what you'd like changed, or press Approve when you're happy.\n\n${business}` },
      });
      log("builder", `Finished ${brief.name}'s website and sent it to Henry for checking.`);
    });
    return task;
  }

  // ---- Otto: hosting and the builder ----------------------------------------------------
  function alert(key, title, summary, link = "") {
    const open = tasks.find((t) => t.key === key && t.status === "alert");
    if (open) return open.summary === summary ? open : update(open, { summary, title, data: { ...open.data, link } });
    log("ops", `Raised an alert: ${title}.`);
    return addTask("ops", { kind: "alert", key, status: "alert", title, summary, data: { link } });
  }

  async function opsCheck({ domains = false } = {}) {
    if (!on("ops")) return;
    const found = new Set();
    const checked = new Set();
    const flag = (key, ...rest) => { found.add(key); alert(key, ...rest); };
    await run("ops", "Running checks", async () => {
      // The builder
      if (builder.enabled) {
        checked.add("ops:b:");
        let o;
        try { o = await builder.overview(); } catch (err) { flag("ops:b:down", "The website builder isn't answering", `${err.message} Customers' live websites may be down too.`); }
        if (o) {
          const base = o.builderUrl;
          if (!o.lastBackup || now() - Date.parse(o.lastBackup) > 36 * HOUR) flag("ops:b:backup", "Builder backups haven't run lately", o.lastBackup ? `The last automatic backup was ${new Date(o.lastBackup).toLocaleString("en-GB")}.` : "There are no backups yet.", `${base}/admin/customers`);
          if (o.disk && o.disk.free < 0.1) flag("ops:b:disk", "The server is nearly full", `${Math.round(o.disk.free * 100)}% of the disk is free. Delete old files or upgrade the server.`);
          if (!o.licence.allowed) flag("ops:b:licence", "The builder's licence needs attention", o.licence.reason, `${base}/admin/customers`);
          if (o.licence.update) flag("ops:b:update", `Builder version ${o.licence.latest?.version} is available`, o.licence.latest?.notes || "A new version of the builder is out.");
          if (!o.mail) flag("ops:b:mail", "The builder can't send email", "Website form messages aren't being emailed to customers. Add SMTP settings to the builder's settings.txt.");
          for (const s of o.sites) {
            if (s.status === "error") flag(`ops:b:site-error:${s.id}`, `${s.name} failed to build`, s.error || "Open it to try again.", `${base}/admin/sites/${s.id}`);
          }
          // Visitors' messages that nobody has dealt with (customers' websites).
          for (const s of o.sites.filter((x) => x.publishedAt && x.owner)) {
            const info = await builder.site(s.id, 7).catch(() => null);
            const old = (info?.submissions || []).filter((x) => !x.done && x.kind !== "newsletter" && now() - Date.parse(x.at) > 2 * DAY && now() - Date.parse(x.at) < 21 * DAY);
            if (old.length) flag(`ops:b:unanswered:${s.id}`, `${s.name}: ${old.length} visitor message${old.length === 1 ? "" : "s"} waiting over 2 days`, `The owner (${s.owner.email}) may not have seen them. Alex can nudge them.`, `${base}/admin/sites/${s.id}`);
          }
          if (domains) {
            checked.add("ops:b:domain:");
            const d = await builder.domains().catch(() => null);
            for (const s of d?.sites || []) {
              const bad = (s.domains || []).filter((x) => !x.ok);
              if (bad.length) flag(`ops:b:domain:${s.siteId}`, `${s.name}: domain not connected`, `${bad.map((x) => x.domain).join(", ")} doesn't point to the server.`, `${o.builderUrl}/admin/sites/${s.siteId}`);
            }
            state.last.domains = now().getTime();
          }
        }
      }
      // WHMCS: servers, new orders and unpaid services
      if (whmcs.enabled) {
        checked.add("ops:w:");
        try {
          for (const s of await whmcs.servers()) {
            const st = s.status || {};
            if (s.active !== false && st.http === false) flag(`ops:w:server:${s.id}`, `Hosting server ${s.name} looks down`, `${s.hostname || s.ipaddress} isn't answering. Customers' websites and email on it may be offline.`, `${whmcs.adminUrl}/configservers.php`);
          }
        } catch (err) { if (!/permission|not found|invalid/i.test(err.message)) flag("ops:w:api", "Can't reach WHMCS", err.message); }
        try {
          for (const o of await whmcs.orders({ status: "Pending" })) {
            const key = `order:${o.id}`;
            if (has(key)) continue;
            const items = (o.lineitems?.lineitem || []).map((l) => `${l.product || l.producttype}${l.domain ? ` (${l.domain})` : ""}`).join(", ");
            const paid = String(o.paymentstatus).toLowerCase() === "paid";
            addTask("ops", { kind: "order", key, status: "waiting", title: `New order #${o.ordernum} from ${o.name}`, summary: `${items || "Order"} · ${o.amount} · ${paid ? "paid" : "not paid yet"}. Approve to accept it and set up the hosting.`, data: { orderId: Number(o.id), clientId: Number(o.userid), paid, items, link: `${whmcs.adminUrl}/orders.php?action=view&id=${o.id}` } });
            log("ops", `Spotted new order #${o.ordernum} from ${o.name}.`);
            // Done-for-you websites go to Bea too.
            if (/done.?for.?you|web ?design|launch|growth|website package/i.test(items) && on("builder")) {
              addTask("builder", { kind: "build-offer", key: `dfy:${o.id}`, status: "waiting", title: `Done-for-you website ordered by ${o.name}`, summary: `${items}. Approve and Bea will start building, using what they told us in the order. Check the details first.`, data: { clientId: Number(o.userid), name: o.name, orderId: Number(o.id) } });
            }
          }
          const days = settings.ops.suspendAfterDays;
          const overdue = (await whmcs.invoices({ status: "Overdue" })).filter((i) => now() - Date.parse(i.duedate) > days * DAY);
          for (const inv of overdue) {
            const key = `suspend:${inv.id}`;
            if (has(key)) continue;
            const services = (await whmcs.products({ clientId: inv.userid })).products.filter((p) => p.status === "Active");
            if (!services.length) continue;
            addTask("ops", { kind: "suspend", key, status: "waiting", title: `Suspend ${inv.firstname} ${inv.lastname}'s hosting? Invoice #${inv.invoicenum || inv.id} is ${days}+ days overdue`, summary: `${inv.total} due ${inv.duedate}. Services: ${services.map((s) => s.domain || s.name).join(", ")}. Approve to suspend them (they come back on when paid if WHMCS automation is on).`, data: { clientId: Number(inv.userid), invoiceId: Number(inv.id), services: services.map((s) => Number(s.id)), link: `${whmcs.adminUrl}/invoices.php?action=edit&id=${inv.id}` } });
            log("ops", `Invoice #${inv.invoicenum || inv.id} is long overdue; asked whether to suspend.`);
          }
        } catch (err) { flag("ops:w:api", "Can't reach WHMCS", err.message, whmcs.adminUrl); }
      }
      // Close alerts whose problem has gone (only for things checked this time).
      for (const t of tasks) {
        if (t.status !== "alert" || !t.key?.startsWith("ops:") || found.has(t.key)) continue;
        const prefix = [...checked].find((p) => t.key.startsWith(p));
        if (!prefix || (t.key.startsWith("ops:b:domain:") && !domains)) continue;
        update(t, { status: "done", summary: `Sorted: ${t.summary}` });
        log("ops", `${t.title}: sorted now.`);
      }
      state.last.ops = now().getTime();
      log("ops", `Checked ${[builder.enabled && "the builder", whmcs.enabled && "WHMCS"].filter(Boolean).join(" and ") || "what I can (nothing connected yet)"}${found.size ? `: ${found.size} problem${found.size === 1 ? "" : "s"}` : ": all fine"}.`);
    });
  }

  // ---- Alex: accounts ------------------------------------------------------------------
  async function writeEmail(kind, system, facts, fallback) {
    if (!ai.enabled) return fallback;
    const out = await ai.ask({ kind, system: `${system} Plain English, warm and brief (under 150 words), no hype, never invent numbers or promises. Sign off as "${business}". Respond with ONLY JSON: { "subject": string, "text": string }`, prompt: facts });
    return { subject: String(out.subject || fallback.subject), text: String(out.text || fallback.text) };
  }

  async function accountRound() {
    if (!on("account")) return 0;
    let n = 0;
    await run("account", "Looking after customers", async () => {
      const lt = localNow(tz, now());
      if (whmcs.enabled) {
        // Welcome new customers (joined in the last 3 days).
        if (settings.account.welcome) {
          const { clients } = await whmcs.clients({ limit: 25 });
          for (const c of clients.filter((x) => x.datecreated && now() - Date.parse(x.datecreated) < 3 * DAY)) {
            const key = `welcome:${c.id}`;
            if (has(key)) continue;
            n++;
            const task = addTask("account", { kind: "email", key, title: `Welcome ${c.firstname} ${c.lastname}`, summary: "Writing a welcome email…", data: { clientId: Number(c.id) } });
            await work("account", task, "Writing a welcome email", async () => {
              const products = (await whmcs.products({ clientId: c.id })).products.map((p) => p.name).join(", ");
              const draft = await writeEmail("hq-welcome", `You are Alex, account manager at ${business}. Write a personal welcome email to a new customer: thank them, say what they've got, point to the 2-3 most useful first steps (log in to the client area; if they have the website builder, start their site; how to get help) and invite them to reply with any questions.`, `Customer: ${c.firstname} ${c.lastname} (${c.companyname || "no company"}). Services: ${products || "none yet"}.`, { subject: `Welcome to ${business}, ${c.firstname}!`, text: `Hello ${c.firstname},\n\nThank you for choosing ${business}! We're really pleased to have you.\n\nIf you have any questions at all, just reply to this email or open a ticket in your client area and a real person will help.\n\n${business}` });
              update(task, { status: "waiting", summary: `New customer: ${products || "no services yet"}.`, draft: { to: c.email, ...draft } });
              log("account", `Wrote a welcome email for ${c.firstname} ${c.lastname}.`);
            });
          }
        }
        // A friendly personal note for overdue invoices (WHMCS sends its own automatic reminders too).
        if (settings.account.overdue) {
          for (const inv of (await whmcs.invoices({ status: "Overdue" })).filter((i) => now() - Date.parse(i.duedate) > 3 * DAY)) {
            const key = `overdue:${inv.id}`;
            if (has(key)) continue;
            n++;
            const draft = await writeEmail("hq-overdue", `You are Alex, account manager at ${business}. Write a kind, personal note to a customer whose invoice is overdue: no threats, assume it's an oversight, say how to pay (the client area), and offer to help if something's wrong or they'd like to change their plan.`, `Customer: ${inv.firstname} ${inv.lastname}. Invoice #${inv.invoicenum || inv.id}, ${inv.total}, due ${inv.duedate}.`, { subject: `A quick note about invoice #${inv.invoicenum || inv.id}`, text: `Hello ${inv.firstname},\n\nJust a friendly note that invoice #${inv.invoicenum || inv.id} (${inv.total}) was due on ${inv.duedate}. You can pay it any time in your client area.\n\nIf something's not right, or you'd like to change your plan, just reply and we'll sort it out.\n\n${business}` }).catch(() => null);
            if (!draft) continue;
            addTask("account", { kind: "email", key, status: "waiting", title: `Overdue invoice: ${inv.firstname} ${inv.lastname} (${inv.total})`, summary: `Due ${inv.duedate}. A personal note to go with WHMCS's automatic reminders.`, data: { clientId: Number(inv.userid), link: `${whmcs.adminUrl}/invoices.php?action=edit&id=${inv.id}` }, draft });
            log("account", `Drafted a friendly reminder for invoice #${inv.invoicenum || inv.id}.`);
          }
        }
      }
      // Monthly check-ins with builder customers (first week of the month).
      if (settings.account.checkins && builder.enabled && lt.day <= 7) {
        const o = await builder.overview();
        for (const s of o.sites.filter((x) => x.publishedAt && x.owner?.email)) {
          const key = `checkin:${s.id}:${lt.month}`;
          if (has(key)) continue;
          n++;
          const task = addTask("account", { kind: "email", key, title: `Monthly check-in: ${s.name}`, summary: "Looking at the visitors and messages…", data: { siteId: s.id, link: `${o.builderUrl}/admin/sites/${s.id}` } });
          await work("account", task, "Writing check-ins", async () => {
            const info = await builder.site(s.id, 30);
            const recent = info.submissions.filter((x) => now() - Date.parse(x.at) < 30 * DAY);
            const waiting = recent.filter((x) => !x.done && x.kind !== "newsletter" && now() - Date.parse(x.at) > 2 * DAY);
            const facts = `Website: ${s.name}. Last 30 days: ${info.stats.visitors} visitors, ${info.stats.views} page views, top pages ${info.stats.pages.slice(0, 3).map(([p, c]) => `${p} (${c})`).join(", ") || "none"}. Messages/bookings received: ${recent.length}; not dealt with yet: ${waiting.length}. Suggestions: ${info.advice.slice(0, 3).join("; ") || "none"}.`;
            const draft = await writeEmail("hq-checkin", `You are Alex, account manager at ${business}. Write a short monthly check-in email to a customer about their website: a warm hello, 2-4 short points from the facts (praise what's going well; gently mention messages not dealt with; one or two suggestions, saying we can help), and an invitation to reply.`, facts, { subject: `How ${s.name} did this month`, text: `Hello,\n\nA quick check-in on ${s.name}: ${info.stats.visitors} people visited in the last 30 days.${waiting.length ? ` There ${waiting.length === 1 ? "is 1 message" : `are ${waiting.length} messages`} from visitors still waiting for a reply.` : ""}\n\nJust reply if you'd like any changes.\n\n${business}` });
            update(task, { status: "waiting", summary: facts.slice(0, 220), draft: { to: s.owner.email, ...draft } });
          });
        }
        log("account", "Wrote this month's check-ins.");
      }
      state.last.account = now().getTime();
    });
    return n;
  }

  // ---- Mia: marketing ------------------------------------------------------------------
  const aboutUs = () => settings.marketing.about || `${business}: UK web hosting with an AI website builder (describe your business, get a finished website in minutes), done-for-you websites from £299, and the builder for other hosting companies. Honest prices, UK support, free email.`;

  async function marketingWeek() {
    if (!on("marketing")) return 0;
    const lt = localNow(tz, now());
    const week = weekKey(lt.date);
    let n = 0;
    await run("marketing", "Planning this week's marketing", async () => {
      if (!has(`mk:social:${week}`)) {
        n++;
        const task = addTask("marketing", { kind: "social", key: `mk:social:${week}`, title: "This week's social media posts", summary: "Writing posts…" });
        await work("marketing", task, "Writing posts", async () => {
          const doing = ideas.filter((i) => i.status === "doing").map((i) => i.title).join("; ");
          const out = ai.enabled
            ? await ai.ask({ kind: "hq-social", system: `You are Mia, marketing at ${aboutUs()}. Write 4 social media posts for this week: (1) a helpful tip for small business owners about their website, (2) one showing the AI website builder (what it does, how fast), (3) one about done-for-you websites or hosting, (4) a friendly behind-the-scenes or seasonal post. Mark which platform suits each best (Facebook, Instagram, LinkedIn, TikTok). Each under 70 words with 1-3 hashtags; suggest a picture or short video for each. No invented facts, prices other than ours, or testimonials. Respond with ONLY JSON: { "posts": [{ "platform": string, "text": string, "visual": string }] }`, prompt: `Today is ${now().toDateString()}. Campaigns we're running now: ${doing || "none"}.` })
            : { posts: [{ platform: "Facebook", text: "Most customers look you up on their phone first. Is your website easy to use on one? #SmallBusiness", visual: "A phone showing a website" }, { platform: "Instagram", text: "Describe your business in a sentence and our AI website builder makes the whole site, ready to change and publish. #WebsiteBuilder", visual: "Screen recording of the builder" }, { platform: "LinkedIn", text: "Too busy to build a website? Our done-for-you websites start at £299, built and ready in days. #SmallBusinessUK", visual: "A finished customer site" }, { platform: "Facebook", text: "Another week helping local businesses get online. Thanks for trusting us! #ShopLocal", visual: "Your desk or team" }] };
          const posts = (out.posts || []).map((p) => (typeof p === "string" ? { text: p } : p)).map((p, i) => `Post ${i + 1}${p.platform ? ` (${p.platform})` : ""}:\n${p.text}${p.visual ? `\n[Picture: ${p.visual}]` : ""}`);
          update(task, { status: "waiting", summary: "Copy them into your social media accounts, then press Mark as posted.", draft: { text: posts.join("\n\n") } });
          log("marketing", "Wrote this week's social media posts.");
        });
      }
      const siteId = settings.marketing.siteId;
      if (siteId && builder.enabled && !has(`mk:blog:${week}`)) {
        n++;
        const task = addTask("marketing", { kind: "blog", key: `mk:blog:${week}`, title: "A blog post for our website", summary: "Choosing a topic…", data: { siteId } });
        await work("marketing", task, "Choosing a blog topic", async () => {
          const info = await builder.site(siteId);
          const pick = ai.enabled
            ? await ai.ask({ kind: "hq-topic", system: `You pick blog topics for ${aboutUs()}. The topic should be something UK small business owners search for, so the post brings in visitors who might need a website or hosting. Respond with ONLY JSON: { "topic": string, "why": string }`, prompt: `Posts already written: ${info.posts.map((p) => p.title).join("; ") || "(none yet)"}` })
            : { topic: "How much does a small business website cost in the UK?", why: "People search for this when they're about to buy." };
          update(task, { status: "waiting", summary: `${pick.why || ""} Approve and Mia writes it as a draft on the website for you to check and publish.`.trim(), draft: { text: String(pick.topic) } });
          log("marketing", `Suggested a blog post: "${pick.topic}".`);
        });
      }
      state.last.marketing = week;
    });
    return n;
  }

  async function marketingDaily() {
    if (!on("marketing") || !builder.enabled || !settings.marketing.siteId) return 0;
    let n = 0;
    await run("marketing", "Answering enquiries", async () => {
      const info = await builder.site(settings.marketing.siteId, 7);
      for (const sub of info.submissions.filter((x) => !x.done && x.kind !== "newsletter" && now() - Date.parse(x.at) < 14 * DAY)) {
        if (has(`mk:lead:${sub.id}`)) continue;
        const email = Object.values(sub.fields).find((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()));
        if (!email) continue;
        n++;
        const task = addTask("marketing", { kind: "lead", key: `mk:lead:${sub.id}`, title: `Enquiry from ${String(email).trim()}`, summary: "Drafting a reply…", data: { siteId: settings.marketing.siteId, submissionId: sub.id } });
        await work("marketing", task, "Answering an enquiry", async () => {
          const what = Object.entries(sub.fields).map(([k, v]) => `${k}: ${v}`).join("\n");
          const draft = await writeEmail("hq-lead", `You are Mia at ${aboutUs()}. Reply to someone who enquired through our website: thank them, answer what you can from what they wrote using what we offer, suggest the package that fits if it's clear, and propose a clear next step (a quick call, or a free website check-up).`, what, { subject: "Thanks for getting in touch", text: `Hello,\n\nThanks for your enquiry. We'd love to help. Could you tell us a little more about what you need, or let us know a good time for a quick call?\n\n${business}` });
          update(task, { status: "waiting", summary: what.slice(0, 200), draft: { to: String(email).trim(), ...draft } });
          log("marketing", `Drafted a reply to an enquiry from ${String(email).trim()}.`);
        });
      }
    });
    return n;
  }

  async function newIdeas() {
    if (!on("marketing")) return 0;
    if (!ai.enabled) throw new Error("New ideas need AI (Settings tab).");
    return run("marketing", "Thinking up new ideas", async () => {
      const numbers = await stats().catch(() => null);
      const out = await ai.ask({ kind: "hq-ideas", system: `You are Mia, marketing at ${aboutUs()}. Suggest 5 new, practical, low-cost ideas to win customers or grow revenue that a one-person UK business can do this month. Mix channels (local, social, partnerships, offers, content, the website builder for other hosts). Don't repeat existing ideas. Respond with ONLY JSON: { "ideas": [{ "title": string, "text": string (2-3 sentences: what to do and why), "channel": string, "effort": "Low" | "Medium" | "High" }] }`, prompt: `Ideas we already have: ${ideas.map((i) => `${i.title} (${i.status})`).join("; ")}\nNumbers: ${numbers ? JSON.stringify(numbers.headline) : "not connected"}` });
      const fresh = (out.ideas || []).slice(0, 6).map((i) => ({ id: newId(), title: String(i.title).slice(0, 120), text: String(i.text || "").slice(0, 600), channel: String(i.channel || ""), effort: String(i.effort || ""), status: "idea", by: "marketing", at: now().toISOString() }));
      ideas.push(...fresh);
      log("marketing", `Added ${fresh.length} new marketing ideas to the board.`);
      save();
      return fresh.length;
    });
  }

  // ---- numbers -------------------------------------------------------------------------
  async function stats({ fresh = false } = {}) {
    if (!fresh && statsCache.value && now() - statsCache.at < 10 * MIN) return statsCache.value;
    const out = { at: now().toISOString(), whmcs: null, builder: null, headline: {} };
    if (whmcs.enabled) {
      try {
        const [s, active, all, pending] = await Promise.all([whmcs.stats(), whmcs.clients({ status: "Active", limit: 1 }), whmcs.clients({ limit: 1 }), whmcs.orders({ status: "Pending" })]);
        let mrr = 0, services = 0;
        const byProduct = {};
        for (let offset = 0; offset < 5000; offset += 250) {
          const { products, total } = await whmcs.products({ offset, limit: 250 });
          for (const p of products.filter((x) => x.status === "Active")) {
            const m = monthlyAmount(p.recurringamount, p.billingcycle);
            mrr += m; services++;
            const name = p.name || p.groupname || "Other";
            byProduct[name] = byProduct[name] || { count: 0, mrr: 0 };
            byProduct[name].count++; byProduct[name].mrr += m;
          }
          if (offset + 250 >= total) break;
        }
        out.whmcs = {
          incomeToday: money(s.income_today), incomeMonth: money(s.income_thismonth), incomeYear: money(s.income_thisyear), incomeAll: money(s.income_alltime),
          ordersPending: pending.length, ticketsAwaiting: Number(s.tickets_awaitingreply) || 0, cancellations: Number(s.cancellations_pending) || 0,
          clientsActive: active.total, clientsTotal: all.total, servicesActive: services, mrr: Math.round(mrr * 100) / 100,
          products: Object.entries(byProduct).map(([name, v]) => ({ name, count: v.count, mrr: Math.round(v.mrr * 100) / 100 })).sort((a, b) => b.mrr - a.mrr),
          currency: (String(s.income_thismonth).match(/[£$€]/) || ["£"])[0],
        };
      } catch (err) { out.whmcsError = err.message; }
    }
    if (builder.enabled) {
      try {
        const o = await builder.overview();
        const month = now().toISOString().slice(0, 7);
        out.builder = { sites: o.sites.length, live: o.sites.filter((s) => s.publishedAt).length, builtThisMonth: o.sites.filter((s) => String(s.createdAt).startsWith(month)).length, customers: o.customers, url: o.builderUrl };
      } catch (err) { out.builderError = err.message; }
    }
    out.headline = { revenueMonth: out.whmcs?.incomeMonth ?? null, mrr: out.whmcs?.mrr ?? null, customers: out.whmcs?.clientsActive ?? out.builder?.customers ?? null, websites: out.builder?.live ?? null };
    // One snapshot a day for the trend charts.
    const day = localNow(tz, now()).date;
    snapshots[day] = { revenueMonth: out.headline.revenueMonth, mrr: out.headline.mrr, customers: out.headline.customers, websites: out.headline.websites, tickets: out.whmcs?.ticketsAwaiting ?? null };
    out.history = Object.entries(snapshots).sort(([a], [b]) => a.localeCompare(b)).slice(-90).map(([date, v]) => ({ date, ...v }));
    statsCache = { at: now().getTime(), value: out };
    save();
    return out;
  }

  // ---- Henry: briefings and meetings ------------------------------------------------------
  const since = (ms) => activity.filter((a) => now() - Date.parse(a.at) < ms);
  const waitingList = () => tasks.filter((t) => t.status === "waiting" || t.status === "alert");

  async function briefing() {
    return run("boss", "Writing the morning briefing", async () => {
      const numbers = await stats({ fresh: true }).catch(() => null);
      const day = since(DAY);
      const per = STAFF.map((a) => `${AGENTS[a].name} (${AGENTS[a].role}): ${day.filter((x) => x.agent === a).map((x) => x.text).slice(-6).join(" | ") || "quiet"}`).join("\n");
      const waiting = waitingList();
      const facts = `Numbers: ${numbers ? JSON.stringify({ ...numbers.headline, ticketsAwaiting: numbers.whmcs?.ticketsAwaiting, ordersPending: numbers.whmcs?.ordersPending }) : "not connected"}\nLast 24 hours:\n${per}\nWaiting for the owner (${waiting.length}): ${waiting.slice(0, 10).map((t) => t.title).join("; ") || "nothing"}`;
      let text;
      if (ai.enabled) {
        const out = await ai.ask({ kind: "hq-briefing", system: `You are Henry, the boss of the AI team that runs ${business}. Write the owner${ownerName ? ` (${ownerName})` : ""} a short morning briefing to read on their phone: a one-line greeting, the key numbers, what the team did in the last day (only notable things), what needs them today (most important first), and one suggestion. Under 140 words, plain text with short lines, no markdown headings. Never invent numbers. Respond with ONLY JSON: { "text": string }`, prompt: facts });
        text = String(out.text || "").trim();
      }
      if (!text) {
        const h = numbers?.headline || {};
        text = [`Good morning${ownerName ? ` ${ownerName}` : ""}!`, h.revenueMonth !== null && h.revenueMonth !== undefined ? `Revenue this month: ${numbers.whmcs.currency}${h.revenueMonth.toFixed(2)}. Monthly recurring: ${numbers.whmcs.currency}${(h.mrr || 0).toFixed(2)}.` : "", h.customers !== null && h.customers !== undefined ? `Customers: ${h.customers}.${h.websites !== null ? ` Live websites: ${h.websites}.` : ""}` : "", `The team did ${day.length} thing${day.length === 1 ? "" : "s"} yesterday.`, waiting.length ? `${waiting.length} thing${waiting.length === 1 ? "" : "s"} need${waiting.length === 1 ? "s" : ""} you: ${waiting.slice(0, 4).map((t) => t.title).join("; ")}.` : "Nothing needs you right now."].filter(Boolean).join("\n");
      }
      const b = { id: newId(), at: now().toISOString(), text };
      briefings.push(b);
      state.last.briefing = localNow(tz, now()).date;
      log("boss", "Wrote the morning briefing.");
      save();
      if (notifier.enabled && on("boss")) await notifier.send({ title: "Henry's morning briefing", text, url: publicUrl }).catch(() => {});
      return b;
    });
  }

  async function meeting() {
    if (meetingLive && now() < meetingLive.until) throw new Error("The team is already in a meeting.");
    meetingLive = { id: newId(), until: now().getTime() + 5 * MIN, started: now().getTime() };
    log("boss", "Called the team into the meeting room.");
    return run("boss", "Running the team meeting", async () => {
      const week = since(7 * DAY);
      const numbers = await stats({ fresh: true }).catch(() => null);
      const facts = STAFF.map((a) => {
        const mine = tasks.filter((t) => t.agent === a && now() - Date.parse(t.updatedAt) < 7 * DAY);
        return `${AGENTS[a].name} (${AGENTS[a].role}) — on: ${on(a)}; done this week: ${mine.filter((t) => t.status === "done").length}; waiting for owner: ${mine.filter((t) => t.status === "waiting").length}; failed: ${mine.filter((t) => t.status === "failed").length}; log: ${week.filter((x) => x.agent === a).map((x) => x.text).slice(-8).join(" | ") || "nothing"}`;
      }).join("\n");
      const ideaBoard = ideas.map((i) => `${i.title} (${i.status})`).join("; ");
      let minutes;
      if (ai.enabled) {
        minutes = await ai.ask({ kind: "hq-meeting", system: `You are Henry, the boss of the AI team that runs ${aboutUs()}. Write the minutes of this week's team meeting. Each team member reports what they did (from their log, honestly; "quiet week" is fine), what they'll do next, and one concrete idea to improve the business from their area. Then you give a short summary and up to 4 actions you recommend the owner approves, most valuable first (growing customers and revenue, better service, saving time). Be specific and practical for a one-person UK business. Never invent numbers. Respond with ONLY JSON: { "reports": { "support": {"done": string, "next": string, "idea": string}, "builder": {...}, "account": {...}, "ops": {...}, "marketing": {...} }, "summary": string, "actions": [{ "title": string, "text": string, "owner": "support"|"builder"|"account"|"ops"|"marketing"|"boss" }] }`, prompt: `Numbers: ${numbers ? JSON.stringify(numbers.headline) : "not connected"}\n\nTEAM THIS WEEK:\n${facts}\n\nMarketing idea board: ${ideaBoard}` });
      } else {
        const count = (a) => week.filter((x) => x.agent === a).length;
        minutes = {
          reports: Object.fromEntries(STAFF.map((a) => [a, { done: count(a) ? week.filter((x) => x.agent === a).map((x) => x.text).slice(-3).join(" ") : "A quiet week.", next: "Carry on with my usual rounds.", idea: "" }])),
          summary: `A ${week.length > 20 ? "busy" : "quiet"} week: ${week.length} things done. ${waitingList().length} waiting for you. (Add AI in the Settings tab for real discussion and ideas.)`,
          actions: [],
        };
      }
      const m = { id: meetingLive.id, at: now().toISOString(), reports: minutes.reports || {}, summary: String(minutes.summary || ""), actions: (minutes.actions || []).slice(0, 5) };
      meetings.push(m);
      for (const a of m.actions) addTask("boss", { kind: "action", status: "waiting", title: `From the meeting: ${String(a.title).slice(0, 120)}`, summary: String(a.text || "").slice(0, 500), data: { meetingId: m.id, owner: AGENTS[a.owner] ? a.owner : "boss" } });
      state.last.meeting = weekKey(localNow(tz, now()).date);
      log("boss", `Wrote up the team meeting${m.actions.length ? ` with ${m.actions.length} suggestion${m.actions.length === 1 ? "" : "s"} for you` : ""}.`);
      meetingLive.until = Math.max(meetingLive.until, now().getTime() + 2 * MIN);
      save();
      return m;
    }).catch((err) => { meetingLive = null; throw err; });
  }

  // ---- approving -----------------------------------------------------------------------
  async function approve(id, { draft, manual = false } = {}) {
    const task = tasks.find((t) => t.id === id);
    if (!task || !["waiting", "alert"].includes(task.status)) throw new Error("That's already been dealt with.");
    if (draft) task.draft = { ...task.draft, ...draft };
    const d = task.draft || {};
    let summary = "Done.";
    if (task.kind === "reply") {
      if (!d.text?.trim()) throw new Error("Write a reply first.");
      if (!manual) await whmcs.reply(task.data.ticketId, d.text.trim());
      summary = manual ? "Replied by hand." : "Reply posted to the ticket (WHMCS emails the customer).";
      log("support", `Replied to ticket #${task.data.tid}.`);
    } else if (task.kind === "build" || task.kind === "email" || task.kind === "lead") {
      if (!manual) await sendEmail({ clientId: task.kind === "lead" ? 0 : task.data.clientId, to: d.to, subject: d.subject, text: d.text });
      if (task.kind === "lead") await builder.markDone(task.data.siteId, task.data.submissionId).catch(() => {});
      summary = manual ? "Sent by hand." : "Sent.";
      log(task.agent, `Sent: ${d.subject}.`);
    } else if (task.kind === "build-offer") {
      const c = await whmcs.client(task.data.clientId);
      const t = await newMission({ name: c.companyname || `${c.firstname} ${c.lastname}`, description: d.text || c.notes || "", phone: c.phonenumber, email: c.email, address: [c.address1, c.city, c.postcode].filter(Boolean).join(", "), clientId: task.data.clientId, sendTo: c.email });
      summary = `Bea has started building it (${t.title}).`;
    } else if (task.kind === "order") {
      if (!manual) await whmcs.acceptOrder(task.data.orderId);
      summary = manual ? "Accepted by hand." : "Order accepted; WHMCS is setting it up.";
      log("ops", `Accepted order: ${task.title}.`);
    } else if (task.kind === "suspend") {
      for (const sid of task.data.services) await whmcs.suspend(sid, "Overdue invoice");
      summary = `Suspended ${task.data.services.length} service${task.data.services.length === 1 ? "" : "s"}.`;
      log("ops", `Suspended services for an overdue invoice (${task.title}).`);
    } else if (task.kind === "blog") {
      const topic = String(d.text || "").trim();
      if (!topic) throw new Error("Give the post a topic.");
      update(task, { status: "working", summary: "Writing the post…" });
      work("marketing", task, "Writing a blog post", async () => {
        const out = await builder.writePost(task.data.siteId, topic);
        update(task, { status: "done", summary: `"${out.title}" is on the website as a draft. Check it and publish it in the builder.`, data: { ...task.data, link: out.editor } });
        log("marketing", `Wrote the blog post "${out.title}" (a draft on the website).`);
      });
      return task;
    } else if (task.kind === "social") {
      summary = "Posted.";
      log("marketing", "This week's posts went out.");
    } else if (task.kind === "action") {
      summary = "Agreed. It's on the to-do list.";
      ideas.push({ id: newId(), title: task.title.replace(/^From the meeting: /, ""), text: task.summary, channel: "Meeting", effort: "", status: "doing", by: task.data.owner, at: now().toISOString() });
      log("boss", `You agreed: ${task.title.replace(/^From the meeting: /, "")}.`);
    } else if (task.status === "alert") {
      summary = "Marked as sorted.";
    }
    update(task, { status: "done", summary });
    return task;
  }

  const find = (id) => { const t = tasks.find((x) => x.id === id); if (!t) throw new Error("Not found."); return t; };
  function dismiss(id) { const t = find(id); log(t.agent, `You dismissed: ${t.title}.`); return update(t, { status: "dismissed" }); }
  function saveDraft(id, draft) { const t = find(id); return update(t, { draft: { ...t.draft, ...draft } }); }
  function retry(id) {
    const task = find(id);
    if (task.status !== "failed") throw new Error("Only failed work can be tried again.");
    update(task, { status: "dismissed" });
    if (task.kind === "build") return newMission({ ...task.data.brief, design: task.data.design, clientId: task.data.clientId, sendTo: task.data.sendTo });
    if (task.key) task.key = `${task.key}:retried:${task.id}`;
    if (task.agent === "support") checkTickets();
    else if (task.agent === "account") accountRound();
    else if (task.agent === "marketing") { marketingWeek(); marketingDaily(); }
    return task;
  }
  function setIdea(id, patch) {
    const i = ideas.find((x) => x.id === id);
    if (!i) throw new Error("Not found.");
    if (["idea", "doing", "done", "dropped"].includes(patch.status)) i.status = patch.status;
    save();
    return i;
  }
  function addIdea({ title, text }) {
    const i = { id: newId(), title: String(title || "").trim().slice(0, 120), text: String(text || "").slice(0, 600), channel: "Yours", effort: "", status: "idea", by: "you", at: now().toISOString() };
    if (!i.title) throw new Error("Give the idea a title.");
    ideas.push(i);
    save();
    return i;
  }

  // ---- schedule ------------------------------------------------------------------------
  async function tick() {
    const lt = localNow(tz, now());
    const due = (name, every) => now() - (state.last[name] || 0) >= every;
    try {
      if (on("support") && due("tickets", 10 * MIN)) { state.last.tickets = now().getTime(); await checkTickets(); }
      if (on("ops") && due("ops", HOUR)) await opsCheck({ domains: due("domains", DAY) });
      if (on("account") && due("accountRound", 6 * HOUR) && lt.hour >= 9 && lt.hour < 18) { state.last.accountRound = now().getTime(); await accountRound(); }
      if (on("marketing")) {
        if (lt.weekday === 1 && lt.hour >= 9 && state.last.marketing !== weekKey(lt.date)) await marketingWeek();
        if (due("leads", HOUR)) { state.last.leads = now().getTime(); await marketingDaily(); }
        if (ai.enabled && lt.day <= 7 && lt.weekday === 1 && state.last.ideas !== lt.month && lt.hour >= 10) { state.last.ideas = lt.month; await newIdeas(); }
      }
      if (on("boss")) {
        if (lt.hour >= settings.boss.briefingHour && state.last.briefing !== lt.date) await briefing();
        if (lt.weekday === settings.boss.meetingDay && lt.hour >= settings.boss.meetingHour && state.last.meeting !== weekKey(lt.date) && !(meetingLive && now() < meetingLive.until)) await meeting().catch(() => {});
      }
      await sendNotes();
      save();
    } catch (err) { console.warn("HQ round failed:", err.message); }
  }

  // ---- what the office shows -------------------------------------------------------------
  function overview() {
    const counts = {};
    for (const a of Object.keys(AGENTS)) {
      const mine = tasks.filter((t) => t.agent === a);
      counts[a] = { working: busy.has(a) || mine.some((t) => t.status === "working"), doing: busy.get(a) || "", waiting: mine.filter((t) => t.status === "waiting").length, alerts: mine.filter((t) => t.status === "alert").length, failed: mine.filter((t) => t.status === "failed").length, on: on(a) };
    }
    const open = tasks.filter((t) => ["waiting", "alert", "working", "failed"].includes(t.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const recent = tasks.filter((t) => ["done", "dismissed"].includes(t.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 40);
    return {
      agents: AGENTS, staff: STAFF, counts, open, recent, settings,
      meeting: meetingLive && now() < meetingLive.until ? { active: true, writing: busy.has("boss") } : { active: false },
      lastBriefing: briefings.at(-1) || null,
      lastMeeting: meetings.at(-1) ? { id: meetings.at(-1).id, at: meetings.at(-1).at } : null,
      activity: activity.slice(-60).reverse(),
      away: away(),
    };
  }

  function setSettings(patch) {
    for (const [a, v] of Object.entries(patch || {})) {
      if (!settings[a] || typeof v !== "object" || !v) continue;
      for (const [k, val] of Object.entries(v)) {
        if (!(k in DEFAULT_SETTINGS[a])) continue;
        const def = DEFAULT_SETTINGS[a][k];
        if (typeof def === "boolean" && typeof val === "boolean") settings[a][k] = val;
        if (typeof def === "number" && Number.isFinite(Number(val))) settings[a][k] = Math.max(0, Math.min(k === "meetingDay" ? 6 : k.endsWith("Hour") ? 23 : 365, Math.round(Number(val))));
        if (typeof def === "string" && typeof val === "string") settings[a][k] = k === "siteId" ? (/^[a-f0-9]{16}$/.test(val) ? val : "") : val.slice(0, 600);
      }
    }
    save();
    return settings;
  }

  return {
    init, tick, overview, stats, newMission, approve, dismiss, saveDraft, retry, setSettings,
    checkTickets, opsCheck, accountRound, marketingWeek, marketingDaily, newIdeas, briefing, meeting, sendNotes,
    seen: () => { lastSeen = now().getTime(); },
    activityLog: (limit = 300) => activity.slice(-limit).reverse(),
    meetings: () => meetings.slice().reverse(),
    briefings: () => briefings.slice(-30).reverse(),
    ideas: () => ideas, setIdea, addIdea,
    waitingCount: () => waitingList().length,
    _tasks: () => tasks,
  };
}
