// EKA HQ: the main interface for running EKA Hosting.
import { createOffice } from "./office.js";

// ---- helpers ------------------------------------------------------------------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "string") el.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 401) { location.href = "/login"; throw new Error("Please log in."); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function toast(msg, { error = false } = {}) {
  const t = h("div", { class: `toast${error ? " err" : ""}` }, msg);
  document.getElementById("toasts").append(t);
  setTimeout(() => t.remove(), error ? 7000 : 3500);
}
function ago(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString("en-GB");
}
const when = (iso) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const av = (ag) => h("span", { class: "av", style: `--c:${ag.colour}`, "aria-hidden": "true" }, ag.name[0]);
const pound = (n, c = "£") => (n === null || n === undefined ? "–" : `${c}${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
async function busyBtn(btn, fn) { btn.disabled = true; try { await fn(); } catch (err) { toast(err.message, { error: true }); } finally { btn.disabled = false; } }

// ---- state and navigation ---------------------------------------------------------
const view = document.getElementById("view");
let S = null; // latest state from the server
let tab = location.pathname.replace(/^\//, "") || "office";
let office = null, officeEl = null, drawer = null, filter = "";
const TABS = [["office", "Office"], ["approvals", "To check"], ["activity", "Team"], ["numbers", "Numbers"], ["customers", "Customers"], ["meetings", "Meetings"], ["marketing", "Marketing"], ["settings", "Settings"]];
const waiting = () => S.open.filter((t) => t.status === "waiting" || t.status === "alert").length;

function nav() {
  const n = S ? waiting() : 0;
  document.getElementById("tabs").replaceChildren(...TABS.map(([id, label]) => h("a", { href: `/${id}`, class: tab === id ? "on" : "", onclick: (e) => { e.preventDefault(); go(id); } }, label, id === "approvals" && n ? h("span", { class: "count" }, n) : null)));
  document.title = `${n ? `(${n}) ` : ""}EKA HQ`;
}
function go(id, push = true) {
  tab = TABS.some(([t]) => t === id) ? id : "office";
  if (push) history.pushState({}, "", `/${tab}`);
  render(true);
}
addEventListener("popstate", () => go(location.pathname.replace(/^\//, "") || "office", false));
document.querySelector(".logo").addEventListener("click", (e) => { e.preventDefault(); go("office"); });
document.getElementById("logout").addEventListener("click", async () => { await api("/logout", { method: "POST", body: {} }); location.href = "/login"; });

const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
let pageBuilt = "";
async function render(fresh = false) {
  nav();
  if (tab === "office") return renderOffice();
  office?.stop(); office = null; officeEl = null;
  if (!fresh && typing()) return; // don't redraw under someone typing
  if (!fresh && !["approvals", "activity"].includes(tab)) return; // other pages refresh on demand
  const builders = { approvals: pageApprovals, activity: pageTeam, numbers: pageNumbers, customers: pageCustomers, meetings: pageMeetings, marketing: pageMarketing, settings: pageSettings };
  const scroll = scrollY;
  const el = await builders[tab]();
  view.replaceChildren(el);
  if (!fresh && pageBuilt === tab) scrollTo(0, scroll);
  pageBuilt = tab;
}

async function refresh() {
  try { S = await api("/state"); render(); } catch (err) { console.warn(err); }
  clearTimeout(refresh.t);
  const busy = S && Object.values(S.counts).some((c) => c.working);
  refresh.t = setTimeout(refresh, busy || S?.meeting?.active ? 3000 : 12000);
}
setInterval(() => { if (!document.hidden) api("/seen", { method: "POST", body: {} }).catch(() => {}); }, 60_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

// ---- the office ------------------------------------------------------------------
function renderOffice() {
  if (!office) {
    office = createOffice({ agents: S.agents, staff: S.staff, owner: S.owner, onPick: openDrawer });
    officeEl = h("section", { class: "office-view" }, office.el, h("div", { class: "hud", id: "hud" }));
    view.replaceChildren(officeEl);
  }
  office.update(S, filter);
  const n = waiting();
  const b = S.lastBriefing;
  document.getElementById("hud").replaceChildren(
    h("div", { class: "pixel-box henry-says" }, h("strong", {}, "HENRY SAYS"),
      S.meeting.active ? "The team's in the meeting room. I'll put the minutes in Meetings when we're done."
        : n ? `${n} thing${n === 1 ? "" : "s"} on your desk to check. ${S.open.filter((t) => t.status === "alert").length ? "Some are alerts, so have a look soon." : ""}`
          : b ? b.text.split("\n").slice(0, 3).join(" ") : "All quiet. The team's on top of things."),
    h("div", { class: "grow" }),
    n ? h("a", { class: "pxbtn red", href: "/approvals", onclick: (e) => { e.preventDefault(); go("approvals"); } }, `CHECK ${n}`) : null,
    h("a", { class: "pxbtn alt", href: "/activity", onclick: (e) => { e.preventDefault(); go("activity"); } }, "TEAM"),
  );
  if (drawer) openDrawer(drawer, true);
}

function openDrawer(who, refreshOnly = false) {
  if (who === "you") return go("approvals");
  if (who === "meeting") return go("meetings");
  drawer = who;
  officeEl.querySelector(".drawer")?.remove();
  const ag = S.agents[who], c = S.counts[who];
  const mine = S.activity.filter((a) => a.agent === who).slice(0, 8);
  const runs = { boss: [["briefing", "Write a briefing now"], ["meeting", "Call a team meeting"]], support: [["support", "Check tickets now"]], ops: [["ops", "Run all checks now"]], account: [["account", "Do the rounds now"]], marketing: [["marketing", "Plan this week now"], ["ideas", "Think up new ideas"]], builder: [["briefs", "Check for new website briefs"]] }[who] || [];
  const tasksOf = S.open.filter((t) => t.agent === who);
  const box = h("aside", { class: "drawer pixel-box" },
    h("button", { class: "close", "aria-label": "Close", onclick: () => { drawer = null; box.remove(); } }, "✕"),
    h("h2", {}, `${ag.name.toUpperCase()} · ${ag.role.toUpperCase()}`),
    h("p", { class: "small" }, !c.on ? "Switched off (Settings)." : c.doing ? `Right now: ${c.doing.toLowerCase()}…` : "Not busy right now."),
    tasksOf.length ? h("p", { class: "small" }, h("a", { href: "/approvals", onclick: (e) => { e.preventDefault(); filter = who; go("approvals"); } }, `${tasksOf.length} item${tasksOf.length === 1 ? "" : "s"} from ${ag.name} →`)) : null,
    who === "builder" ? h("p", { class: "small" }, h("a", { href: "/activity", onclick: (e) => { e.preventDefault(); go("activity"); } }, "Give Bea a website to build →")) : null,
    who === "boss" && S.lastBriefing ? h("div", { class: "small", style: "white-space:pre-wrap;margin:8px 0;padding:8px;background:#241f3d" }, S.lastBriefing.text) : null,
    h("div", { class: "row", style: "margin:8px 0" }, runs.map(([what, label]) => { const b = h("button", { class: "btn", onclick: () => busyBtn(b, async () => { const out = await api(`/run/${what}`, { method: "POST", body: {} }); if (out.state) S = { ...S, ...out.state }; toast(`${ag.name} is on it.`); refresh(); }) }, label); return b; })),
    h("h2", { style: "margin-top:12px" }, "LATELY"),
    mine.length ? h("ul", { class: "log" }, mine.map((a) => h("li", {}, h("time", {}, ago(a.at)), a.text))) : h("p", { class: "small muted" }, "Nothing yet."),
  );
  officeEl.append(box);
  if (!refreshOnly) box.querySelector("button.btn")?.focus();
}

// ---- To check ------------------------------------------------------------------------
const EMAIL_KINDS = new Set(["build", "email", "lead"]);
const cards = new Map();
function taskCard(t) {
  const ag = S.agents[t.agent], d = t.draft || {};
  const editable = t.status === "waiting";
  const to = editable && EMAIL_KINDS.has(t.kind) && !t.data?.clientId ? h("input", { class: "input", value: d.to || "", placeholder: "Their email address", "aria-label": "Send to" }) : null;
  const subject = editable && EMAIL_KINDS.has(t.kind) ? h("input", { class: "input", value: d.subject || "", "aria-label": "Subject" }) : null;
  const text = editable && ["reply", "social", "blog", "build-offer", ...EMAIL_KINDS].includes(t.kind) && t.draft !== undefined ? h(t.kind === "blog" ? "input" : "textarea", { class: t.kind === "blog" ? "input" : "textarea", "aria-label": t.kind === "blog" ? "Blog post topic" : "Message", ...(t.kind === "blog" ? { value: d.text || "" } : {}) }, t.kind === "blog" ? "" : d.text || "") : null;
  const current = () => ({ ...(to ? { to: to.value } : {}), ...(subject ? { subject: subject.value } : {}), ...(text ? { text: text.value } : {}) });
  const act = (path, body, ok) => async (e) => busyBtn(e.currentTarget, async () => {
    const out = await api(`/tasks/${t.id}/${path}`, { method: "POST", body: body?.() || {} });
    if (ok) toast(ok);
    S = { ...S, ...out.state }; cards.delete(t.id); render(true);
  });
  const btn = (label, onclick, cls = "") => h("button", { class: `btn ${cls}`, onclick }, label);
  const acts = [];
  const mail = S.connections.mail.on || S.connections.whmcs.on;
  if (t.status === "waiting") {
    const k = t.kind;
    if (k === "reply") { acts.push(btn("Post reply to the ticket", act("approve", () => ({ draft: current() }), "Reply posted."), "primary"), btn("I replied myself", act("approve", () => ({ draft: current(), manual: true })))); }
    else if (EMAIL_KINDS.has(k)) { if (mail) acts.push(btn("Send email", act("approve", () => ({ draft: current() }), "Sent."), "primary")); acts.push(btn(mail ? "I sent it myself" : "Copy and mark sent", async (e) => { if (!mail) await navigator.clipboard?.writeText(`${subject?.value || ""}\n\n${text?.value || ""}`).catch(() => {}); act("approve", () => ({ draft: current(), manual: true }), mail ? "Marked as sent." : "Copied: paste it into your email.")(e); })); }
    else if (k === "order") acts.push(btn("Accept order and set it up", act("approve", null, "Order accepted."), "primary"), btn("I've dealt with it", act("approve", () => ({ manual: true }))));
    else if (k === "suspend") acts.push(btn("Suspend the hosting", act("approve", null, "Suspended."), "danger"));
    else if (k === "build-offer") acts.push(btn("Start building", act("approve", () => ({ draft: current() }), "Bea has started."), "primary"));
    else if (k === "blog") acts.push(btn("Write it (as a draft)", act("approve", () => ({ draft: current() }), "Mia is writing it."), "primary"));
    else if (k === "social") acts.push(btn("Copy", async () => { try { await navigator.clipboard.writeText(text.value); toast("Copied."); } catch { text.select(); } }), btn("Mark as posted", act("approve", () => ({ draft: current() })), "primary"));
    else if (k === "action") acts.push(btn("Agree, let's do it", act("approve", null, "Added to the to-do list."), "primary"));
    if (text || subject || to) acts.push(btn("Save changes", act("draft", () => ({ draft: current() }), "Saved.")));
  }
  if (t.status === "alert") acts.push(btn("Mark as sorted", act("approve"), "primary"));
  if (t.status === "failed") acts.push(btn("Try again", act("retry", null, "Trying again…"), "primary"));
  if (["waiting", "alert", "failed"].includes(t.status)) acts.push(btn("Dismiss", act("dismiss"), "ghost"));
  const links = [];
  if (t.data?.review) links.push(h("a", { href: t.data.review, target: "_blank", rel: "noopener" }, "Open the review link"));
  if (t.data?.editor) links.push(h("a", { href: t.data.editor, target: "_blank", rel: "noopener" }, "Open in the builder"));
  if (t.data?.link) links.push(h("a", { href: t.data.link, target: "_blank", rel: "noopener" }, "Open it"));
  const badge = t.status === "working" ? h("span", { class: "badge busy" }, "Working") : t.status === "alert" ? h("span", { class: "badge err" }, "Alert") : t.status === "failed" ? h("span", { class: "badge err" }, "Didn't work") : h("span", { class: "badge warn" }, t.data?.needsHuman ? "Needs a person" : "Needs you");
  return h("article", { class: "task", style: `--c:${ag.colour}` },
    h("div", { class: "task-head" }, av(ag), h("div", { style: "flex:1;min-width:0" },
      h("div", { class: "task-title" }, t.title),
      h("div", { class: "task-meta" }, `${ag.name} · ${ag.role} · ${ago(t.updatedAt)}`, badge),
      t.summary ? h("p", { class: "task-summary" }, t.summary) : null)),
    to || subject || text ? h("div", { class: "task-draft" }, to, subject, text) : null,
    links.length ? h("div", { class: "task-links" }, links) : null,
    acts.length ? h("div", { class: "task-acts" }, acts) : null);
}
function pageApprovals() {
  const list = S.open.filter((t) => !filter || t.agent === filter);
  const els = list.map((t) => {
    const stamp = `${t.status}|${t.updatedAt}`;
    const old = cards.get(t.id);
    if (old && old.stamp === stamp) return old.el;
    const el = taskCard(t);
    cards.set(t.id, { stamp, el });
    return el;
  });
  return h("div", { class: "page" },
    h("h1", {}, "TO CHECK"), h("p", { class: "sub" }, "Everything the team needs you to approve. Nothing reaches a customer or costs money until you say so."),
    h("div", { class: "chips" }, h("button", { class: `chip${filter ? "" : " on"}`, onclick: () => { filter = ""; render(true); } }, `Everything (${S.open.length})`),
      ["boss", ...S.staff].map((a) => h("button", { class: `chip${filter === a ? " on" : ""}`, onclick: () => { filter = a; render(true); } }, `${S.agents[a].name} (${S.open.filter((t) => t.agent === a).length})`))),
    els.length ? els : h("div", { class: "panel empty" }, h("strong", {}, "ALL CLEAR"), "Henry will bring anything new to your office."));
}

// ---- Team (what the bots are up to) ------------------------------------------------------
let designs = null;
async function pageTeam() {
  if (!designs && S.connections.builder.on) designs = (await api("/designs").catch(() => ({ designs: [] }))).designs;
  const cardsEl = ["boss", ...S.staff].map((a) => {
    const ag = S.agents[a], c = S.counts[a];
    const last = S.activity.find((x) => x.agent === a);
    return h("div", { class: "panel agent-card", style: "margin:0" }, av(ag), h("div", {},
      h("div", { class: "what" }, `${ag.name} · ${ag.role}`),
      h("div", { class: "small" }, !c.on ? h("span", { class: "badge" }, "Off") : c.doing ? h("span", { class: "badge busy" }, c.doing) : h("span", { class: "badge ok" }, "Free"), " ", c.waiting ? h("span", { class: "badge warn" }, `${c.waiting} for you`) : null, " ", c.alerts ? h("span", { class: "badge err" }, `${c.alerts} alert${c.alerts === 1 ? "" : "s"}`) : null),
      last ? h("div", { class: "small muted", style: "margin-top:6px" }, `${ago(last.at)}: ${last.text}`) : null));
  });
  const f = (name, label, attrs = {}) => h("label", { class: "f" }, label, h(attrs.tag || "input", { class: attrs.tag ? "textarea" : "input", name, ...attrs, tag: undefined }));
  const form = h("form", { class: "grid", onsubmit: (e) => { e.preventDefault(); busyBtn(form.querySelector("button"), async () => { await api("/missions", { method: "POST", body: Object.fromEntries(new FormData(form)) }); toast("Bea's on it. It'll come to your office when it's ready."); form.reset(); refresh(); }); } },
    f("name", "Business name", { required: true, maxlength: 120 }),
    f("description", "What they do", { tag: "textarea", rows: 3, maxlength: 6000, style: "min-height:80px" }),
    h("div", { class: "grid g2" }, f("phone", "Phone", { maxlength: 60 }), f("email", "Their email (the review link goes here)", { type: "email", maxlength: 200 })),
    f("address", "Address", { maxlength: 300 }),
    f("services", "Services, one per line (e.g. \"Boiler repairs - Same-day fixes for all makes\")", { tag: "textarea", rows: 4, maxlength: 4000, style: "min-height:90px" }),
    h("div", { class: "grid g2" }, f("area", "Areas they cover", { maxlength: 200 }), f("tagline", "Headline (optional)", { maxlength: 160 })),
    f("hours", "Opening hours, one line each", { tag: "textarea", rows: 3, maxlength: 400, style: "min-height:70px" }),
    h("details", {}, h("summary", { class: "small", style: "cursor:pointer;margin-bottom:8px" }, "More: prices, reviews, highlights, social media, style"),
      h("div", { class: "grid" },
        f("prices", "Prices, one per line (e.g. \"Boiler service - £80\"; a line ending in : starts a group)", { tag: "textarea", rows: 3, maxlength: 6000, style: "min-height:70px" }),
        f("reviews", "Real customer reviews, one per line (\"Great job! - Sarah, York\")", { tag: "textarea", rows: 3, maxlength: 4000, style: "min-height:70px" }),
        f("highlights", "Why customers choose them, one per line (e.g. Gas Safe registered)", { tag: "textarea", rows: 2, maxlength: 1000, style: "min-height:60px" }),
        f("socials", "Social media links", { maxlength: 600 }),
        h("label", { class: "f" }, "Style", h("select", { class: "select", name: "kit" }, h("option", { value: "" }, "The design's own style"), ["modern|Modern", "elegant|Elegant", "bold|Bold", "minimal|Minimal", "playful|Playful", "luxury|Luxury", "natural|Natural", "friendly|Warm & friendly", "corporate|Corporate", "fresh|Fresh"].map((x) => h("option", { value: x.split("|")[0] }, x.split("|")[1])))))),
    h("label", { class: "f" }, "Design", h("select", { class: "select", name: "design" }, h("option", { value: "auto" }, "Choose one for me"), (designs || []).map((d) => h("option", { value: d.id }, d.name)))),
    h("div", {}, h("button", { class: "pxbtn", type: "submit" }, "ASK BEA TO BUILD IT")));
  return h("div", { class: "page" },
    h("h1", {}, "THE TEAM"), h("p", { class: "sub" }, "What everyone's doing right now, and everything they've done."),
    h("div", { class: "grid g3", style: "margin-bottom:18px" }, cardsEl),
    h("div", { class: "grid g2" },
      h("section", { class: "panel" }, h("h2", {}, "ACTIVITY"), h("ul", { class: "log" }, S.activity.map((a) => h("li", {}, h("time", {}, ago(a.at)), h("span", {}, h("strong", { style: `color:${S.agents[a.agent]?.colour}` }, S.agents[a.agent]?.name || a.agent), " ", a.text))))),
      h("section", { class: "panel" }, h("h2", {}, "A WEBSITE FOR A CUSTOMER"), S.connections.builder.on ? [h("p", { class: "small muted", style: "margin-top:0" }, "Bea builds it in the website builder from what you put here: the more you fill in, the fuller the site. She brings you a review link to check before it goes to the customer. Done-for-you orders in WHMCS and the Get started form on our website come to her automatically."), form] : h("p", { class: "muted" }, "Connect the builder in Settings first."))));
}

// ---- Numbers --------------------------------------------------------------------------
function lineChart(points, key, colour, label, fmt) {
  const data = points.filter((p) => p[key] !== null && p[key] !== undefined);
  if (data.length < 2) return h("p", { class: "small muted" }, `${label}: a chart appears after a couple of days.`);
  const w = 560, ht = 160, pad = 30;
  const max = Math.max(...data.map((p) => p[key]), 1), min = Math.min(0, ...data.map((p) => p[key]));
  const x = (i) => pad + (i / (data.length - 1)) * (w - pad - 8), y = (v) => ht - 20 - ((v - min) / (max - min || 1)) * (ht - 34);
  const svg = `<svg class="chart" viewBox="0 0 ${w} ${ht}" role="img" aria-label="${label}"><polyline fill="none" stroke="${colour}" stroke-width="2.5" points="${data.map((p, i) => `${x(i)},${y(p[key])}`).join(" ")}"/>${data.map((p, i) => `<circle cx="${x(i)}" cy="${y(p[key])}" r="2.5" fill="${colour}"><title>${p.date}: ${fmt(p[key])}</title></circle>`).join("")}<text class="ax" x="${pad}" y="${ht - 4}">${data[0].date.slice(5)}</text><text class="ax" x="${w - 8}" y="${ht - 4}" text-anchor="end">${data.at(-1).date.slice(5)}</text><text class="ax" x="2" y="${y(max) + 4}">${fmt(max)}</text></svg>`;
  const box = h("div", {}, h("div", { class: "small muted" }, label));
  box.insertAdjacentHTML("beforeend", svg);
  return box;
}
async function pageNumbers() {
  const n = await api("/stats").catch((err) => ({ error: err.message }));
  const w = n.whmcs, b = n.builder, cur = w?.currency || "£";
  const tile = (k, v, hint) => h("div", { class: "tile" }, h("div", { class: "k" }, k), h("div", { class: "v" }, v), hint ? h("div", { class: "h" }, hint) : null);
  const refreshBtn = h("button", { class: "btn", onclick: () => busyBtn(refreshBtn, async () => { await api("/stats?fresh=1"); render(true); }) }, "Refresh");
  return h("div", { class: "page" },
    h("div", { class: "row", style: "justify-content:space-between" }, h("div", {}, h("h1", {}, "THE NUMBERS"), h("p", { class: "sub" }, `Updated ${ago(n.at)}.`)), refreshBtn),
    !w ? h("div", { class: "panel" }, n.whmcsError ? `WHMCS: ${n.whmcsError}` : "Connect WHMCS (Settings) to see revenue, customers, services and orders here.") : null,
    w ? h("div", { class: "tiles" },
      tile("Revenue this month", pound(w.incomeMonth, cur), `Today ${pound(w.incomeToday, cur)}`),
      tile("Monthly recurring", pound(w.mrr, cur), `${w.servicesActive} active services`),
      tile("Revenue this year", pound(w.incomeYear, cur), `All time ${pound(w.incomeAll, cur)}`),
      tile("Active customers", String(w.clientsActive), `${w.clientsTotal} in total`),
      tile("Orders to accept", String(w.ordersPending), w.cancellations ? `${w.cancellations} cancellation requests` : "No cancellations waiting"),
      tile("Tickets waiting", String(w.ticketsAwaiting), "Sam drafts the replies")) : null,
    b ? h("div", { class: "tiles" },
      tile("Live websites", String(b.live), `${b.sites} in total`),
      tile("Built this month", String(b.builtThisMonth)),
      tile("Builder customers", String(b.customers)),
      tile("HQ's AI spend this month", n.aiSpend === null || n.aiSpend === undefined ? "–" : `$${Number(n.aiSpend).toFixed(2)}`)) : h("div", { class: "panel" }, n.builderError ? `Builder: ${n.builderError}` : "Connect the builder (Settings) to see websites here."),
    h("div", { class: "grid g2" },
      h("section", { class: "panel" }, h("h2", {}, "TRENDS"), lineChart(n.history || [], "mrr", "#14b8a6", "Monthly recurring revenue", (v) => pound(v, cur)), lineChart(n.history || [], "customers", "#a855f7", "Customers", (v) => String(v)), lineChart(n.history || [], "websites", "#f59e0b", "Live websites", (v) => String(v))),
      w ? h("section", { class: "panel" }, h("h2", {}, "WHERE THE MONEY COMES FROM"), h("div", { class: "table-wrap" }, h("table", { class: "t", style: "min-width:0" }, h("thead", {}, h("tr", {}, h("th", {}, "Product"), h("th", {}, "Active"), h("th", {}, "Per month"))), h("tbody", {}, w.products.map((p) => h("tr", {}, h("td", {}, p.name), h("td", {}, p.count), h("td", {}, pound(p.mrr, cur)))))))) : null));
}

// ---- Customers --------------------------------------------------------------------------
let custQuery = "";
async function pageCustomers() {
  const box = h("div");
  const load = async () => {
    const d = await api(`/customers?q=${encodeURIComponent(custQuery)}`).catch((err) => ({ error: err.message }));
    if (d.error) return box.replaceChildren(h("div", { class: "panel" }, d.error));
    box.replaceChildren(h("p", { class: "small muted" }, `${d.total} customer${d.total === 1 ? "" : "s"}${d.source === "builder" ? " (from the builder; connect WHMCS for billing and hosting)" : ""}.`),
      h("div", { class: "panel table-wrap", style: "padding:6px 10px" }, h("table", { class: "t" },
        h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "Email"), h("th", {}, "Status"), h("th", {}, "Websites"), h("th", {}, "Since"))),
        h("tbody", {}, d.customers.map((c) => h("tr", { class: d.source === "whmcs" ? "click" : "", tabindex: d.source === "whmcs" ? 0 : undefined, onclick: d.source === "whmcs" ? () => customerDetail(c.id) : undefined, onkeydown: (e) => { if (e.key === "Enter" && d.source === "whmcs") customerDetail(c.id); } },
          h("td", {}, h("strong", {}, c.name || "–"), c.company ? h("div", { class: "small muted" }, c.company) : null), h("td", {}, c.email), h("td", {}, h("span", { class: `badge ${c.status === "Active" ? "ok" : c.status === "Suspended" ? "err" : ""}` }, c.status || "–")),
          h("td", {}, c.sites.length ? c.sites.map((s) => h("div", { class: "small" }, s.url ? h("a", { href: s.url, target: "_blank", rel: "noopener" }, s.name) : s.name, s.live ? "" : " (draft)")) : h("span", { class: "muted small" }, "–")),
          h("td", { class: "small muted" }, c.since ? String(c.since).slice(0, 10) : "–")))))));
  };
  const search = h("input", { class: "input", type: "search", placeholder: "Search by name, email or company", value: custQuery, style: "max-width:420px", onkeydown: (e) => { if (e.key === "Enter") { custQuery = search.value; load(); } } });
  load();
  return h("div", { class: "page" }, h("h1", {}, "CUSTOMERS"), h("p", { class: "sub" }, "Everyone with an account, their hosting, invoices, tickets and websites."),
    h("div", { class: "row", style: "margin-bottom:14px" }, search, h("button", { class: "btn", onclick: () => { custQuery = search.value; load(); } }, "Search")), box);
}
async function customerDetail(id) {
  const d = await api(`/customers/${id}`).catch((err) => { toast(err.message, { error: true }); return null; });
  if (!d) return;
  const c = d.customer;
  const svcBtn = (p) => {
    const action = p.status === "Suspended" ? "unsuspend" : p.status === "Active" ? "suspend" : null;
    if (!action) return null;
    const b = h("button", { class: `btn ${action === "suspend" ? "danger" : "primary"}`, onclick: () => busyBtn(b, async () => {
      if (!confirm(`${action === "suspend" ? "Suspend" : "Unsuspend"} ${p.domain || p.name}?`)) return;
      await api(`/customers/${id}/services/${p.id}/${action}`, { method: "POST", body: {} }); toast("Done."); customerDetail(id);
    }) }, action === "suspend" ? "Suspend" : "Unsuspend");
    return b;
  };
  view.replaceChildren(h("div", { class: "page" },
    h("button", { class: "btn ghost", onclick: () => render(true) }, "← All customers"),
    h("h1", { style: "margin-top:10px" }, (c.name || c.email).toUpperCase()),
    h("p", { class: "sub" }, [c.company, c.email, c.phone, c.address].filter(Boolean).join(" · "), " · ", h("a", { href: c.link, target: "_blank", rel: "noopener" }, "Open in WHMCS")),
    h("div", { class: "tiles" },
      h("div", { class: "tile" }, h("div", { class: "k" }, "Status"), h("div", { class: "v" }, c.status)),
      h("div", { class: "tile" }, h("div", { class: "k" }, "Paid so far"), h("div", { class: "v" }, c.stats.income || "–")),
      h("div", { class: "tile" }, h("div", { class: "k" }, "Unpaid"), h("div", { class: "v" }, c.stats.numdueinvoices ? `${c.stats.numdueinvoices} (${c.stats.dueinvoicesbalance})` : "None")),
      h("div", { class: "tile" }, h("div", { class: "k" }, "Customer since"), h("div", { class: "v", style: "font-size:12px" }, String(c.since || "").slice(0, 10)))),
    h("section", { class: "panel table-wrap" }, h("h2", {}, "SERVICES"), d.products.length ? h("table", { class: "t" }, h("tbody", {}, d.products.map((p) => h("tr", {}, h("td", {}, h("strong", {}, p.name), h("div", { class: "small muted" }, p.domain || "")), h("td", {}, h("span", { class: `badge ${p.status === "Active" ? "ok" : p.status === "Suspended" ? "err" : ""}` }, p.status)), h("td", {}, `${p.amount} ${p.cycle}`), h("td", { class: "small" }, `Next due ${p.next}`), h("td", {}, svcBtn(p)))))) : h("p", { class: "muted" }, "No services.")),
    h("div", { class: "grid g2" },
      h("section", { class: "panel" }, h("h2", {}, "INVOICES"), d.invoices.length ? h("ul", { class: "log" }, d.invoices.map((i) => h("li", {}, h("time", {}, i.due), `#${i.num} · ${i.total} · `, h("span", { class: `badge ${i.status === "Paid" ? "ok" : i.status === "Overdue" ? "err" : "warn"}` }, i.status)))) : h("p", { class: "muted" }, "None.")),
      h("section", { class: "panel" }, h("h2", {}, "TICKETS"), d.tickets.length ? h("ul", { class: "log" }, d.tickets.map((t) => h("li", {}, h("time", {}, String(t.last).slice(0, 10)), `#${t.tid} ${t.subject} · ${t.status}`))) : h("p", { class: "muted" }, "None.")),
      h("section", { class: "panel" }, h("h2", {}, "WEBSITES"), d.sites.length ? h("ul", { class: "log" }, d.sites.map((s) => h("li", {}, h("span", {}, h("strong", {}, s.name), s.live ? " · live " : " · draft ", s.url ? h("a", { href: s.url, target: "_blank", rel: "noopener" }, "visit") : null, " · ", h("a", { href: s.editor, target: "_blank", rel: "noopener" }, "edit"))))) : h("p", { class: "muted" }, "No websites in the builder.")))));
  scrollTo(0, 0);
}

// ---- Meetings ----------------------------------------------------------------------------
async function pageMeetings() {
  const d = await api("/meetings");
  const callBtn = h("button", { class: "pxbtn", onclick: () => busyBtn(callBtn, async () => { await api("/run/meeting", { method: "POST", body: {} }); toast("Henry's calling everyone in. Watch the meeting room!"); go("office"); }) }, "CALL A MEETING NOW");
  const briefBtn = h("button", { class: "pxbtn alt", onclick: () => busyBtn(briefBtn, async () => { await api("/run/briefing", { method: "POST", body: {} }); setTimeout(() => render(true), 2500); }) }, "NEW BRIEFING");
  return h("div", { class: "page" },
    h("h1", {}, "MEETINGS & BRIEFINGS"), h("p", { class: "sub" }, `Henry holds a team meeting every ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][S.settings.boss.meetingDay]} at ${S.settings.boss.meetingHour}:00 and writes you a briefing every morning at ${S.settings.boss.briefingHour}:00.`),
    h("div", { class: "row", style: "margin-bottom:18px" }, callBtn, briefBtn),
    h("div", { class: "grid g2" },
      h("div", {}, d.meetings.length ? d.meetings.slice(0, 8).map((m) => h("section", { class: "panel minutes" }, h("h2", {}, `TEAM MEETING · ${when(m.at).toUpperCase()}`), h("p", {}, m.summary),
        S.staff.map((a) => m.reports[a] ? [h("h3", {}, `${S.agents[a].name.toUpperCase()} · ${S.agents[a].role.toUpperCase()}`), h("dl", {}, h("dt", {}, "Did"), h("dd", { style: "margin:0" }, m.reports[a].done || "–"), h("dt", {}, "Next"), h("dd", { style: "margin:0" }, m.reports[a].next || "–"), m.reports[a].idea ? [h("dt", {}, "Idea"), h("dd", { style: "margin:0" }, m.reports[a].idea)] : null)] : null),
        m.actions.length ? [h("h3", {}, "HENRY SUGGESTS"), h("ol", {}, m.actions.map((a) => h("li", {}, h("strong", {}, a.title), " ", a.text)))] : null)) : h("div", { class: "panel empty" }, h("strong", {}, "NO MEETINGS YET"), "Call one now and watch the team gather in the meeting room.")),
      h("div", {}, h("section", { class: "panel" }, h("h2", {}, "MORNING BRIEFINGS"), d.briefings.length ? d.briefings.slice(0, 10).map((b) => h("div", { style: "margin-bottom:14px" }, h("div", { class: "small muted" }, when(b.at)), h("div", { style: "white-space:pre-wrap" }, b.text))) : h("p", { class: "muted" }, "The first one arrives tomorrow morning.")))));
}

// ---- Marketing ---------------------------------------------------------------------------
async function pageMarketing() {
  const d = await api("/marketing");
  const move = (i, status) => async () => { await api(`/ideas/${i.id}`, { method: "POST", body: { status } }); render(true); };
  const col = (status, title) => h("div", { class: "col" }, h("h3", {}, title), d.ideas.filter((i) => i.status === status).map((i) => h("div", { class: "card" },
    h("div", { class: "t" }, i.title), h("p", {}, i.text), h("div", { class: "row small" }, i.channel ? h("span", { class: "badge" }, i.channel) : null, i.effort ? h("span", { class: "badge" }, `${i.effort} effort`) : null),
    h("div", { class: "row", style: "margin-top:8px" }, status !== "idea" ? h("button", { class: "btn ghost", onclick: move(i, status === "done" ? "doing" : "idea") }, "←") : null, status !== "done" ? h("button", { class: "btn", onclick: move(i, status === "idea" ? "doing" : "done") }, status === "idea" ? "Start" : "Done ✓") : null, status === "idea" ? h("button", { class: "btn ghost", onclick: move(i, "dropped") }, "Drop") : null))));
  const ideasBtn = h("button", { class: "pxbtn", onclick: () => busyBtn(ideasBtn, async () => { await api("/run/ideas", { method: "POST", body: {} }); toast("Mia's thinking…"); setTimeout(() => render(true), 6000); }) }, "ASK MIA FOR NEW IDEAS");
  const add = h("form", { class: "row", onsubmit: async (e) => { e.preventDefault(); const f = new FormData(add); await api("/ideas", { method: "POST", body: { title: f.get("title"), text: f.get("text") } }).catch((err) => toast(err.message, { error: true })); render(true); } },
    h("input", { class: "input", name: "title", placeholder: "Your idea", required: true, style: "max-width:260px" }), h("input", { class: "input", name: "text", placeholder: "Details (optional)", style: "max-width:380px" }), h("button", { class: "btn" }, "Add"));
  return h("div", { class: "page" },
    h("h1", {}, "MARKETING"), h("p", { class: "sub" }, "Mia's plan for winning customers. She writes social posts every Monday, blog posts for our website, replies to enquiries, and new ideas every month."),
    h("section", { class: "panel" }, h("div", { class: "row", style: "justify-content:space-between;margin-bottom:10px" }, h("h2", { style: "margin:0" }, "IDEAS BOARD"), ideasBtn), h("div", { class: "board" }, col("idea", "IDEAS"), col("doing", "DOING"), col("done", "DONE")), h("div", { style: "margin-top:10px" }, add)),
    h("div", { class: "grid g2" },
      h("section", { class: "panel" }, h("h2", {}, "STRATEGY"), d.strategies.map((s) => h("div", { style: "margin-bottom:12px" }, h("strong", {}, s.title), h("div", { class: "small muted" }, s.text)))),
      h("div", {},
        h("section", { class: "panel" }, h("h2", {}, "FIRST 4 WEEKS OF POSTS"), [1, 2, 3, 4].map((w) => h("div", { style: "margin-bottom:10px" }, h("div", { class: "small", style: "font-weight:700" }, `Week ${w}`), h("ul", { class: "small", style: "margin:4px 0;padding-left:18px" }, d.calendar.filter((c) => c.week === w).map((c) => h("li", {}, h("strong", {}, `${c.day}: `), c.text)))))),
        h("section", { class: "panel" }, h("h2", {}, "SOCIAL MEDIA SET-UP"), h("ol", { class: "small setup", style: "padding-left:18px;margin:0" }, d.social.map((x) => h("li", {}, x)))))));
}

// ---- Settings ------------------------------------------------------------------------------
function pageSettings() {
  const c = S.connections;
  const save = async (patch) => { try { const out = await api("/settings", { method: "POST", body: patch }); S.settings = out.settings; toast("Saved."); } catch (err) { toast(err.message, { error: true }); } };
  const conn = (on, title, okText, howTo) => h("div", { class: "agent-card", style: "padding:8px 0;border-bottom:1px solid var(--line)" }, h("span", { class: `badge ${on ? "ok" : "warn"}` }, on ? "Connected" : "Not set up"), h("div", {}, h("strong", {}, title), h("div", { class: "small muted" }, on ? okText : howTo)));
  const check = (a, k, label) => { const box = h("input", { type: "checkbox", checked: !!S.settings[a][k], onchange: () => save({ [a]: { [k]: box.checked } }) }); return h("label", { class: "row small", style: "gap:8px;margin:6px 0" }, box, label); };
  const num = (a, k, label, min, max) => { const i = h("input", { class: "input", type: "number", min, max, value: S.settings[a][k], style: "width:90px", onchange: () => save({ [a]: { [k]: Number(i.value) } }) }); return h("label", { class: "row small", style: "gap:8px;margin:6px 0" }, label, i); };
  const testBtn = h("button", { class: "btn", onclick: () => busyBtn(testBtn, async () => { const r = await api("/notify/test", { method: "POST", body: {} }); toast(`Sent by ${r.sent.join(", ")}. Check your phone!`); }) }, "Send a test message to my phone");
  const tgBtn = h("button", { class: "btn ghost", onclick: () => busyBtn(tgBtn, async () => { const r = await api("/notify/telegram-id"); toast(`Your Telegram chat id is ${r.chatId}. Put it in TELEGRAM_CHAT_ID.`); }) }, "Find my Telegram chat id");
  const siteBtn = h("button", { class: "pxbtn", onclick: () => busyBtn(siteBtn, async () => {
    if (S.settings.marketing.siteId && !confirm("You already have a website set for Mia. Make a fresh copy of the EKA Hosting website in the builder anyway?")) return;
    const r = await api("/website/create", { method: "POST", body: {} });
    S.settings.marketing.siteId = r.siteId;
    toast("Done! Opening it in the builder…");
    window.open(r.editor, "_blank", "noopener");
    render(true);
  }) }, "CREATE OUR WEBSITE IN THE BUILDER");
  const about = h("textarea", { class: "textarea", style: "min-height:80px", onchange: () => save({ marketing: { about: about.value } }) }, S.settings.marketing.about || "");
  const siteId = h("input", { class: "input", value: S.settings.marketing.siteId || "", placeholder: "e.g. 3f2a9c1d7b6e4a58", style: "max-width:260px", onchange: () => save({ marketing: { siteId: siteId.value.trim() } }) });
  return h("div", { class: "page" },
    h("h1", {}, "SETTINGS"), h("p", { class: "sub" }, "Connections are set in hq-settings.txt (next to HQ's files); restart HQ after changing it."),
    h("div", { class: "grid g2" },
      h("section", { class: "panel" }, h("h2", {}, "CONNECTIONS"),
        conn(c.ai.on, "AI", `Using ${c.ai.provider}.`, "Add ANTHROPIC_API_KEY (or a free AI_PROVIDER) so the team can write."),
        conn(c.whmcs.on, "WHMCS", h("a", { href: c.whmcs.admin, target: "_blank", rel: "noopener" }, c.whmcs.admin), "Add WHMCS_URL, WHMCS_IDENTIFIER and WHMCS_SECRET (WHMCS → System Settings → API Credentials)."),
        conn(c.builder.on, "Website builder", c.builder.url, "Start the builder (start-windows.bat) at least once, then restart HQ: it connects by itself. (If the builder is on another computer, put BUILDER_URL and BUILDER_API_KEY in hq-settings.txt.)"),
        conn(c.mail.on, "Email", "HQ can send emails that don't go through WHMCS.", "Optional: SMTP_HOST etc. Emails to WHMCS customers are sent by WHMCS anyway."),
        conn(c.notify.on, "Messages to your phone", `By ${c.notify.channels.join(", ")}.`, "Install the free ntfy app, subscribe to a secret topic name, and put it in NTFY_TOPIC. Or use Telegram."),
        h("div", { class: "row", style: "margin-top:12px" }, testBtn, tgBtn)),
      h("section", { class: "panel" }, h("h2", {}, "THE TEAM"),
        ["boss", ...S.staff].map((a) => check(a, "on", `${S.agents[a].name} (${S.agents[a].role}) is at work`)),
        h("h2", { style: "margin-top:14px" }, "HENRY"),
        check("boss", "notifyAway", "Message my phone when something needs me and I'm not in HQ"),
        num("boss", "briefingHour", "Morning briefing at (hour)", 0, 23), num("boss", "meetingDay", "Meeting day (0 Sun … 6 Sat)", 0, 6), num("boss", "meetingHour", "Meeting at (hour)", 0, 23),
        h("h2", { style: "margin-top:14px" }, "SAM"), check("support", "autoSend", "Post replies Sam is sure about without asking me (off is safest)"),
        h("h2", { style: "margin-top:14px" }, "ALEX"), check("account", "welcome", "Welcome emails for new customers"), check("account", "overdue", "Friendly notes about overdue invoices"), check("account", "checkins", "Monthly check-ins with website customers"),
        h("h2", { style: "margin-top:14px" }, "OTTO"), num("ops", "suspendAfterDays", "Suggest suspending hosting after an invoice is overdue for (days)", 1, 120),
        h("h2", { style: "margin-top:14px" }, "BEA"), check("builder", "autoBuild", "Start building straight away when a customer orders a done-for-you website or fills in the Get started form"), check("builder", "useAi", "Use AI to write the pages (better words, costs about 10–30p a site). Off: Bea uses the customer's own words, free"),
        h("p", { class: "small muted" }, "For WHMCS orders, add custom fields to your done-for-you products (Business name, What does your business do?, Services, Areas you cover, Opening hours, Prices, Customer reviews, Why do customers choose you?, Which style do you like?). Bea reads them automatically. The full list is in the README."),
        h("h2", { style: "margin-top:14px" }, "MIA"), h("p", { class: "small muted" }, "The EKA Hosting website (home, website builder, hosting, web design, pricing, blog and contact pages) is ready-made: one click adds it to the builder for you to check, change and publish."), siteBtn, h("label", { class: "f" }, "Our own website in the builder (its id, from the address bar when you edit it: /admin/sites/<id>)", siteId), h("label", { class: "f", style: "margin-top:8px" }, "About the business (Mia uses this)", about))));
}

// ---- start -----------------------------------------------------------------------------
S = await api("/state");
render(true);
refresh();
