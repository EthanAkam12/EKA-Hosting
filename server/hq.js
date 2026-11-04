// EKA HQ: a small team of AI staff that help run the hosting business.
// Each one has a single job and brings its work to the administrator for
// approval before anything reaches a customer or costs money:
//
//   support    customer help messages → a drafted reply
//   builder    "build a website" missions → a site and a review link
//   account    monthly check-ins with each customer → a drafted email
//   ops        hourly checks (backups, disk, licence, failed sites, forms…) → alerts
//   marketing  weekly social posts, a blog post for your own site, and follow-ups to enquiries
//
// Work is stored as tasks in DATA_DIR/hq/tasks.json:
//   { id, agent, kind, key?, title, summary, status, createdAt, updatedAt, data, draft? }
// status: working → waiting (needs you) / alert → done | dismissed | failed

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const AGENTS = {
  support: { name: "Sam", role: "Support", colour: "#2563eb" },
  builder: { name: "Bea", role: "Website builder", colour: "#16a34a" },
  account: { name: "Alex", role: "Account manager", colour: "#9333ea" },
  ops: { name: "Otto", role: "Operations", colour: "#ea580c" },
  marketing: { name: "Mia", role: "Marketing", colour: "#db2777" },
};

const DEFAULT_SETTINGS = {
  support: { on: true, autoSend: false },
  builder: { on: true },
  account: { on: true },
  ops: { on: true },
  marketing: { on: true, siteId: "", about: "" },
};

const DAY = 86400_000;
const newId = () => crypto.randomBytes(6).toString("hex");

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

export function createHQ({ dataDir, ai, mailer, store, users, stats, licence, backups, siteAdvice, buildFromDesign, cleanBrief, createReviewLink, helpText, publicBase, usageContext, checkDomains, baseDomain = "", serverIp = "" }) {
  const dir = path.join(dataDir, "hq");
  const file = (name) => path.join(dir, name);
  let tasks = [];
  let tickets = [];
  let settings = structuredClone(DEFAULT_SETTINGS);
  let state = { lastAccount: "", lastMarketing: "", lastDomains: 0 };
  let writing = Promise.resolve();
  const busy = new Set(); // agents working right now

  async function init() {
    await fs.mkdir(dir, { recursive: true });
    const read = async (name, fallback) => { try { return JSON.parse(await fs.readFile(file(name), "utf8")); } catch { return fallback; } };
    tasks = await read("tasks.json", []);
    tickets = await read("tickets.json", []);
    const saved = await read("settings.json", {});
    for (const k of Object.keys(DEFAULT_SETTINGS)) settings[k] = { ...DEFAULT_SETTINGS[k], ...(saved[k] || {}) };
    state = { ...state, ...(await read("state.json", {})) };
    // Work cut off by a restart is tried again (or reported).
    for (const t of tasks) if (t.status === "working") Object.assign(t, { status: "failed", summary: "Stopped when the builder restarted. Try it again." });
  }

  function save() {
    writing = writing.then(async () => {
      tasks = tasks.slice(-500);
      for (const [name, value] of [["tasks.json", tasks], ["tickets.json", tickets.slice(-2000)], ["settings.json", settings], ["state.json", state]]) {
        const tmp = `${file(name)}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
        await fs.rename(tmp, file(name));
      }
    }).catch((err) => console.warn("HQ not saved:", err.message));
    return writing;
  }

  function addTask(agent, fields) {
    const now = new Date().toISOString();
    const task = { id: newId(), agent, status: "working", createdAt: now, updatedAt: now, data: {}, ...fields };
    tasks.push(task);
    save();
    return task;
  }
  function update(task, patch) {
    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    save();
    return task;
  }
  // AI work is run as the administrator (not charged to a customer's allowance).
  const asAdmin = (fn) => usageContext.run({ user: { role: "admin" } }, fn);
  const on = (agent) => settings[agent]?.on !== false;

  async function run(agent, task, fn) {
    busy.add(agent);
    try { await asAdmin(fn); } catch (err) {
      console.warn(`[HQ ${agent}]`, err.message);
      update(task, { status: "failed", summary: err.message });
    } finally { busy.delete(agent); }
  }

  const ownerEmail = (meta) => (meta.owner && users.get(meta.owner)?.email) || meta.formEmail || "";

  // ---- Support ----------------------------------------------------------------

  const SUPPORT_SYSTEM = (help) => `You are Sam, the friendly support assistant for a UK web hosting company that provides the EKA website builder to its customers.
Write a reply to the customer's latest message: warm, plain English, short paragraphs, specific steps (name the exact buttons and tabs from the help pages), no jargon. Sign off as "The support team".
Only use facts from the HELP PAGES and the customer's account details. If you're not sure, or it needs someone to look at their account, a refund, a price, or anything you can't do, say a person will look into it, and set needsHuman true.
Respond with ONLY JSON: { "reply": string, "summary": string (one line for the team), "needsHuman": boolean, "confidence": "high" | "low" }

HELP PAGES:
${help}`;

  async function draftSupport(ticket) {
    if (!on("support")) return;
    const task = addTask("support", { kind: "reply", key: `ticket:${ticket.id}`, title: `Reply to ${ticket.from.name || ticket.from.email}: ${ticket.subject}`, summary: "Reading the message and the help pages…", data: { ticketId: ticket.id } });
    if (!ai.enabled) return update(task, { status: "waiting", summary: "AI is off, so write the reply yourself.", draft: { subject: `Re: ${ticket.subject}`, text: "" } });
    await run("support", task, async () => {
      const user = ticket.from.userId && users.get(ticket.from.userId);
      const sites = store.list().filter((m) => user && m.owner === user.id).map((m) => `${m.name} (${m.publishedAt ? "live" : "draft"})`);
      const plan = user && users.plan(user.plan);
      const account = user ? `Customer: ${user.name || user.email}, plan ${plan?.name || "none"} (${plan?.sites ?? "?"} websites), websites: ${sites.join(", ") || "none yet"}.` : "Not logged in (no account details).";
      const thread = ticket.thread.map((m) => `${m.who === "customer" ? "CUSTOMER" : "SUPPORT"} (${m.at.slice(0, 10)}): ${m.text}`).join("\n\n");
      const out = await ai.ask({ kind: "hq-support", system: SUPPORT_SYSTEM(helpText()), prompt: `${account}\nWebsite it's about: ${ticket.site || "not said"}\n\nCONVERSATION:\n${thread}` });
      const reply = String(out.reply || "").trim();
      update(task, { status: "waiting", summary: `${out.needsHuman ? "⚑ Needs a person: " : ""}${String(out.summary || "Reply drafted.").slice(0, 200)}`, draft: { subject: `Re: ${ticket.subject}`, text: reply }, data: { ...task.data, needsHuman: !!out.needsHuman, confidence: out.confidence } });
      if (settings.support.autoSend && out.confidence === "high" && !out.needsHuman && reply) await approve(task.id, {});
    });
  }

  async function newTicket({ user, subject, body, site }) {
    const ticket = {
      id: newId(), subject: String(subject || "Help").slice(0, 140), site: String(site || "").slice(0, 120), status: "open",
      from: { userId: user?.role === "user" ? user.id : null, email: user?.email || "", name: user?.name || "" },
      thread: [{ who: "customer", text: String(body || "").slice(0, 5000), at: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
    };
    tickets.push(ticket);
    await save();
    draftSupport(ticket);
    return ticket;
  }

  async function addToTicket(ticketId, user, body) {
    const t = tickets.find((x) => x.id === ticketId && x.from.userId === user.id);
    if (!t) throw new Error("Message not found.");
    t.thread.push({ who: "customer", text: String(body || "").slice(0, 5000), at: new Date().toISOString() });
    t.status = "open";
    // Any earlier draft is out of date.
    for (const task of tasks) if (task.key === `ticket:${t.id}` && task.status === "waiting") update(task, { status: "dismissed", summary: "Replaced: the customer wrote again." });
    await save();
    draftSupport(t);
    return t;
  }

  const ticketsFor = (user) => tickets.filter((t) => t.from.userId === user.id).map((t) => ({ id: t.id, subject: t.subject, status: t.status, createdAt: t.createdAt, thread: t.thread }));

  // ---- Website builder ----------------------------------------------------------

  async function newMission(input) {
    const brief = cleanBrief({ name: input.name, description: input.description, phone: input.phone, email: input.email, address: input.address, hours: input.hours, siteType: input.siteType, extras: input.extras });
    const design = input.design && input.design !== "auto" ? input.design : guessDesign(`${brief.name} ${brief.description}`);
    const customer = input.customerId && users.get(input.customerId);
    const task = addTask("builder", { kind: "build", title: `Build a website for ${brief.name || "a new customer"}`, summary: `Starting from the "${design}" design…`, data: { design, customerId: customer?.id || null, sendTo: String(input.sendTo || customer?.email || brief.email || "").trim(), brief } });
    run("builder", task, async () => {
      const { meta } = await buildFromDesign({ user: { role: "admin" }, owner: customer?.id, design, brief, fill: ai.enabled });
      update(task, { data: { ...task.data, siteId: meta.id }, summary: ai.enabled ? "Writing every page for the business…" : "Building from the template…" });
      // Wait for the build (it runs as a background job).
      for (let i = 0; ; i++) {
        const m = store.getMeta(meta.id);
        if (!m) throw new Error("The website was deleted while it was being built.");
        if (m.status === "ready") break;
        if (m.status === "error") throw new Error(`The build failed: ${m.error}`);
        if (i > 1200) throw new Error("The build took too long. Open the website to see how far it got.");
        await new Promise((r) => setTimeout(r, 1000));
      }
      const site = await store.getDraft(meta.id);
      const left = site ? siteAdvice(site).map((a) => a.title) : [];
      const token = await createReviewLink(meta.id);
      const review = `${publicBase()}/review/${token}`;
      update(task, {
        status: "waiting",
        summary: `Ready for you to check.${left.length ? ` Suggestions: ${left.slice(0, 3).join("; ")}.` : ""}`,
        data: { ...task.data, siteId: meta.id, review, editor: `/admin/sites/${meta.id}` },
        draft: { to: task.data.sendTo, subject: `Your new website is ready to look at: ${brief.name}`, text: `Hello,\n\nYour new website for ${brief.name} is ready for you to look at:\n${review}\n\nClick anything on the page to leave a comment about what you'd like changed, or press Approve when you're happy.\n\nThe team` },
      });
    });
    return task;
  }

  // ---- Account manager --------------------------------------------------------------

  async function accountCheckins() {
    if (!on("account")) return 0;
    let n = 0;
    for (const meta of store.list()) {
      if (meta.demo || !meta.publishedAt) continue;
      const to = ownerEmail(meta);
      if (!to) continue;
      const key = `checkin:${meta.id}:${new Date().toISOString().slice(0, 7)}`;
      if (tasks.some((t) => t.key === key)) continue;
      const task = addTask("account", { kind: "checkin", key, title: `Monthly check-in: ${meta.name}`, summary: "Looking at the visitors, messages and the site…", data: { siteId: meta.id } });
      n++;
      await run("account", task, async () => {
        const site = await store.getDraft(meta.id);
        const s = await stats.summary(meta.id, { days: 30 });
        const subs = await store.listSubmissions(meta.id);
        const waiting = subs.filter((x) => !x.done && Date.now() - Date.parse(x.at) > 2 * DAY && Date.now() - Date.parse(x.at) < 30 * DAY);
        const advice = site ? siteAdvice(site).slice(0, 3) : [];
        const facts = `Website: ${meta.name}. Last 30 days: ${s.visitors} visitors, ${s.views} page views, top pages ${s.pages.slice(0, 3).map(([p, c]) => `${p} (${c})`).join(", ") || "none"}. Messages/bookings received: ${subs.filter((x) => Date.now() - Date.parse(x.at) < 30 * DAY).length}; still marked to-do after 2 days: ${waiting.length}. Suggestions: ${advice.map((a) => a.title).join("; ") || "none"}.`;
        let text;
        if (ai.enabled) {
          const out = await ai.ask({ kind: "hq-account", system: `You are Alex, a friendly account manager at a small UK web hosting company. Write a short monthly check-in email to a customer about their website: a warm hello, 2-4 short points from the facts (praise what's going well; gently mention unanswered messages; one or two suggestions, saying the team can help), and an invitation to reply. Plain English, no hype, under 160 words. Never invent numbers. Respond with ONLY JSON: { "subject": string, "text": string }`, prompt: facts });
          text = { subject: String(out.subject || `How ${meta.name} is doing`), text: String(out.text || "") };
        } else {
          text = { subject: `How ${meta.name} did this month`, text: `Hello,\n\nA quick check-in on ${meta.name}: ${s.visitors} people visited in the last 30 days.${waiting.length ? ` There ${waiting.length === 1 ? "is 1 message" : `are ${waiting.length} messages`} from visitors still waiting for a reply.` : ""}${advice.length ? `\n\nIdeas to get more from the site: ${advice.map((a) => a.title.toLowerCase()).join("; ")}. We're happy to help.` : ""}\n\nJust reply if you'd like any changes.\n\nThe team` };
        }
        update(task, { status: "waiting", summary: facts.slice(0, 220), draft: { to, ...text } });
      });
    }
    state.lastAccount = new Date().toISOString().slice(0, 7);
    save();
    return n;
  }

  // ---- Operations -----------------------------------------------------------------------

  // An alert stays one task while the problem lasts, and closes itself when it's fixed.
  function alert(key, title, summary, link = "") {
    const open = tasks.find((t) => t.key === key && t.status === "alert");
    if (open) return update(open, { summary, title, data: { ...open.data, link } });
    return addTask("ops", { kind: "alert", key, status: "alert", title, summary, data: { link } });
  }

  async function opsCheck({ domains = false } = {}) {
    if (!on("ops")) return;
    busy.add("ops");
    const found = new Set();
    const flag = (key, ...rest) => { found.add(key); alert(key, ...rest); };
    try {
      const list = await backups.list();
      const last = list.find((b) => !b.label);
      if (!last || Date.now() - Date.parse(last.at) > 36 * 3600_000) flag("ops:backup", "Backups haven't run lately", last ? `The last automatic backup was ${new Date(last.at).toLocaleString("en-GB")}.` : "There are no backups yet.", "/admin/customers");
      try {
        const st = await fs.statfs(dataDir);
        const free = st.bavail / st.blocks;
        if (free < 0.1) flag("ops:disk", "The server is nearly full", `${Math.round(free * 100)}% of the disk is free. Delete old files or upgrade the server.`);
      } catch { /* not available on this system */ }
      const lic = licence.status();
      if (!lic.allowed) flag("ops:licence", "The builder's licence needs attention", lic.reason, "/admin/customers");
      else if (lic.mode === "trial" && lic.daysLeft <= 3) flag("ops:licence", "The free trial ends soon", `${lic.daysLeft} day(s) left. Enter your licence key.`, "/admin/customers");
      if (lic.update) flag("ops:update", `Version ${lic.latest.version} is available`, lic.latest.notes || "A new version of the builder is out.", lic.latest.url || "");
      if (!mailer.enabled) flag("ops:mail", "Email isn't set up", "Form messages, password resets and reports can't be emailed. Add SMTP settings in settings.txt (or install sendmail).");
      for (const meta of store.list()) {
        if (meta.demo) continue;
        if (meta.status === "error") flag(`ops:site-error:${meta.id}`, `${meta.name} failed to build`, meta.error || "Open it to try again.", `/admin/sites/${meta.id}`);
        const subs = await store.listSubmissions(meta.id);
        const old = subs.filter((x) => !x.done && x.kind !== "newsletter" && Date.now() - Date.parse(x.at) > 2 * DAY && Date.now() - Date.parse(x.at) < 21 * DAY);
        if (old.length) flag(`ops:unanswered:${meta.id}`, `${meta.name}: ${old.length} message${old.length === 1 ? "" : "s"} waiting over 2 days`, `Oldest: ${old.at(-1).kind || "message"} from ${new Date(old.at(-1).at).toLocaleDateString("en-GB")}. The owner may not have seen them.`, `/admin/sites/${meta.id}`);
      }
      // Domains: once a day (DNS lookups take a moment).
      if (domains && baseDomain) {
        for (const meta of store.list().filter((m) => m.domains?.length && m.publishedAt && !m.deploy?.enabled)) {
          const r = await checkDomains({ domains: meta.domains, siteId: meta.id, slug: meta.slug, baseDomain, serverIp });
          const bad = r.domains.filter((d) => !d.apex.ok && !d.www.ok);
          if (bad.length) flag(`ops:domain:${meta.id}`, `${meta.name}: domain not connected`, `${bad.map((d) => d.domain).join(", ")} doesn't point here yet.`, `/admin/sites/${meta.id}`);
        }
        state.lastDomains = Date.now();
      }
      // Close alerts whose problem has gone (domain alerts only when domains were checked).
      for (const t of tasks) {
        if (t.status !== "alert" || !t.key?.startsWith("ops:") || found.has(t.key)) continue;
        if (t.key.startsWith("ops:domain:") && !(domains && baseDomain)) continue;
        update(t, { status: "done", summary: `Sorted: ${t.summary}` });
      }
      save();
    } finally { busy.delete("ops"); }
  }

  // ---- Marketing ----------------------------------------------------------------------

  async function marketingRound() {
    if (!on("marketing")) return 0;
    const m = settings.marketing;
    const meta = m.siteId && store.getMeta(m.siteId);
    const about = m.about || (meta ? meta.prompt : "") || "a UK web hosting company offering hosting, an AI website builder and done-for-you websites for small businesses";
    let n = 0;
    const week = `${new Date().getUTCFullYear()}-${Math.ceil((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 1)) / (7 * DAY))}`;
    // Social posts
    if (!tasks.some((t) => t.key === `mk:social:${week}`)) {
      n++;
      const task = addTask("marketing", { kind: "social", key: `mk:social:${week}`, title: "This week's social media posts", summary: "Writing three posts…" });
      await run("marketing", task, async () => {
        const out = ai.enabled
          ? await ai.ask({ kind: "hq-social", system: `You are Mia, marketing assistant for ${about}. Write 3 short social media posts for this week (Facebook/Instagram/LinkedIn): one helpful tip for small business owners about their website, one showing what the company offers, one friendly behind-the-scenes or seasonal post. Each under 60 words with 1-3 relevant hashtags. No invented facts, prices or testimonials. Respond with ONLY JSON: { "posts": [string, string, string] }`, prompt: `Today is ${new Date().toDateString()}.` })
          : { posts: ["Did you know most customers check a business's website on their phone first? Make sure yours is quick and clear. #SmallBusiness", "Need a website without the hassle? We'll build it for you, ready in days. Get in touch! #WebDesign", "Another week of helping local businesses get online. Thanks to everyone who trusts us with their websites! #ShopLocal"] };
        update(task, { status: "waiting", summary: "Copy them into your social media accounts.", draft: { subject: "Social posts", text: (out.posts || []).map((p, i) => `Post ${i + 1}:\n${p}`).join("\n\n") } });
      });
    }
    // A blog post for your own website (saved as a draft there when approved).
    if (meta && ai.enabled && !tasks.some((t) => t.key === `mk:blog:${week}`)) {
      n++;
      const task = addTask("marketing", { kind: "blog", key: `mk:blog:${week}`, title: `A blog post for ${meta.name}`, summary: "Choosing a topic and writing…", data: { siteId: meta.id } });
      await run("marketing", task, async () => {
        const site = await store.getDraft(meta.id);
        const existing = site.pages.filter((p) => p.post).map((p) => p.title);
        const pick = await ai.ask({ kind: "hq-topic", system: `You pick blog topics for ${about}. Respond with ONLY JSON: { "topic": string }`, prompt: `Suggest one useful blog post topic for small business owners that this company's customers would search for. Not one of: ${existing.join("; ") || "(none yet)"}` });
        const { page } = await ai.writePost({ site, topic: String(pick.topic || "Why your small business needs a fast website") });
        update(task, { status: "waiting", summary: `"${page.title}": approve to add it to ${meta.name} as a draft post.`, data: { ...task.data, page }, draft: { subject: page.title, text: page.post.excerpt } });
      });
    }
    // Follow-ups to enquiries on your own website.
    if (meta) {
      const subs = (await store.listSubmissions(meta.id)).filter((x) => !x.done && x.kind !== "newsletter" && Date.now() - Date.parse(x.at) < 14 * DAY);
      for (const sub of subs) {
        if (tasks.some((t) => t.key === `mk:lead:${sub.id}`)) continue;
        const email = Object.values(sub.fields).find((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()));
        if (!email) continue;
        n++;
        const task = addTask("marketing", { kind: "lead", key: `mk:lead:${sub.id}`, title: `Follow up an enquiry from ${email}`, summary: "Drafting a reply…", data: { siteId: meta.id, submissionId: sub.id } });
        await run("marketing", task, async () => {
          const what = Object.entries(sub.fields).map(([k, v]) => `${k}: ${v}`).join("\n");
          const out = ai.enabled
            ? await ai.ask({ kind: "hq-lead", system: `You are Mia at ${about}. Write a friendly, helpful reply to someone who enquired through the website: thank them, answer what you can from what they wrote, suggest a clear next step (a quick call or a reply with details). Under 140 words. No prices or promises you can't know. Respond with ONLY JSON: { "subject": string, "text": string }`, prompt: what })
            : { subject: "Thanks for getting in touch", text: "Hello,\n\nThanks for your enquiry. We'd love to help. Could you tell us a little more about what you need, or let us know a good time for a quick call?\n\nThe team" };
          update(task, { status: "waiting", summary: what.slice(0, 200), draft: { to: email.trim(), subject: String(out.subject), text: String(out.text) } });
        });
      }
    }
    state.lastMarketing = week;
    save();
    return n;
  }

  // ---- approving, editing, dismissing ------------------------------------------------------

  async function approve(id, { draft, manual = false } = {}) {
    const task = tasks.find((t) => t.id === id);
    if (!task || !["waiting", "alert"].includes(task.status)) throw new Error("That's already been dealt with.");
    if (draft) task.draft = { ...task.draft, ...draft };
    const send = async (to, subject, text) => {
      if (manual) return; // sent by hand
      if (!to) throw new Error("There's no email address to send it to.");
      if (!mailer.enabled) throw new Error("Email isn't set up on this server (SMTP settings in settings.txt). Copy the text and send it yourself, then press Done.");
      await mailer.send({ to, subject, text, fromName: "The team" });
    };
    if (task.agent === "support") {
      const t = tickets.find((x) => x.id === task.data.ticketId);
      if (!t) throw new Error("The message has gone.");
      if (!task.draft?.text?.trim()) throw new Error("Write a reply first.");
      t.thread.push({ who: "support", text: task.draft.text.trim(), at: new Date().toISOString() });
      t.status = "answered";
      if (!manual && t.from.email && mailer.enabled) await mailer.send({ to: t.from.email, subject: task.draft.subject, text: `${task.draft.text.trim()}${publicBase() ? `\n\n--\nSee the whole conversation: ${publicBase()}/support` : ""}`, fromName: "Support" }).catch((err) => console.warn("Support email not sent:", err.message));
    } else if (task.kind === "build" || task.kind === "checkin" || task.kind === "lead") {
      await send(task.draft.to, task.draft.subject, task.draft.text);
      if (task.kind === "lead") await store.setSubmissionDone(task.data.siteId, task.data.submissionId, true);
    } else if (task.kind === "blog") {
      const site = await store.getDraft(task.data.siteId);
      site.pages.push({ ...task.data.page, post: { ...task.data.page.post, draft: true } });
      await store.saveDraft(task.data.siteId, site, { version: `HQ added a draft blog post: ${task.data.page.title}` });
    }
    update(task, { status: "done", summary: task.kind === "social" ? "Posted (copied to your social media)." : task.kind === "blog" ? "Added to your website as a draft post." : task.agent === "ops" ? "Marked as sorted." : manual ? "Sent by hand." : "Sent." });
    return task;
  }

  function dismiss(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new Error("Not found.");
    return update(task, { status: "dismissed" });
  }

  function saveDraft(id, draft) {
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new Error("Not found.");
    return update(task, { draft: { ...task.draft, ...draft } });
  }

  function retry(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status !== "failed") throw new Error("Only failed work can be tried again.");
    update(task, { status: "dismissed" });
    if (task.agent === "support") { const t = tickets.find((x) => x.id === task.data.ticketId); if (t) draftSupport(t); }
    else if (task.agent === "builder") newMission({ ...task.data.brief, design: task.data.design, customerId: task.data.customerId, sendTo: task.data.sendTo });
    else if (task.agent === "account") { task.key = `${task.key}:retried:${task.id}`; accountCheckins(); }
    else if (task.agent === "marketing") { task.key = `${task.key}:retried:${task.id}`; marketingRound(); }
  }

  // ---- schedule ------------------------------------------------------------------------------

  async function tick() {
    try {
      await opsCheck({ domains: Date.now() - (state.lastDomains || 0) > DAY });
      const month = new Date().toISOString().slice(0, 7);
      if (on("account") && state.lastAccount !== month && new Date().getUTCDate() <= 7) await accountCheckins();
      const d = new Date();
      if (on("marketing") && d.getUTCDay() === 1 && state.lastMarketing !== `${d.getUTCFullYear()}-${Math.ceil((Date.now() - Date.UTC(d.getUTCFullYear(), 0, 1)) / (7 * DAY))}`) await marketingRound();
    } catch (err) { console.warn("HQ check failed:", err.message); }
  }

  function overview() {
    const counts = {};
    for (const a of Object.keys(AGENTS)) {
      const mine = tasks.filter((t) => t.agent === a);
      counts[a] = {
        working: busy.has(a) || mine.some((t) => t.status === "working"),
        waiting: mine.filter((t) => t.status === "waiting").length,
        alerts: mine.filter((t) => t.status === "alert").length,
        on: on(a),
      };
    }
    const open = tasks.filter((t) => ["waiting", "alert", "working", "failed"].includes(t.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const recent = tasks.filter((t) => ["done", "dismissed"].includes(t.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30);
    return { agents: AGENTS, counts, open, recent, settings, openTickets: tickets.filter((t) => t.status === "open").length };
  }

  function setSettings(patch) {
    for (const [a, v] of Object.entries(patch || {})) {
      if (!settings[a] || typeof v !== "object") continue;
      if (typeof v.on === "boolean") settings[a].on = v.on;
      if (a === "support" && typeof v.autoSend === "boolean") settings.support.autoSend = v.autoSend;
      if (a === "marketing") {
        if (typeof v.siteId === "string") settings.marketing.siteId = /^[a-f0-9]{16}$/.test(v.siteId) ? v.siteId : "";
        if (typeof v.about === "string") settings.marketing.about = v.about.slice(0, 400);
      }
    }
    save();
    return settings;
  }

  return { init, tick, overview, newTicket, addToTicket, ticketsFor, newMission, approve, dismiss, saveDraft, retry, setSettings, accountCheckins, marketingRound, opsCheck, waitingCount: () => tasks.filter((t) => t.status === "waiting" || t.status === "alert").length, _tasks: () => tasks };
}
