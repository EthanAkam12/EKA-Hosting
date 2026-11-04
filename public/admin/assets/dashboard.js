import { h, api, waitForJob, toast, modal, confirmDialog, timeAgo, demoBanner } from "./ui.js";

const list = document.getElementById("list");
const notice = document.getElementById("notice");
let me = null;
const watching = new Set();


async function load() {
  const [{ sites }, meData] = await Promise.all([api("/sites"), me ? Promise.resolve(me) : api("/me")]);
  if (!me) demoBanner(meData);
  me = meData;
  showUsageButton();
  setupHeader();
  notice.replaceChildren(
    licenceNotice(),
    me.account ? accountBar(me.account, sites) : me.ai.enabled || me.role !== "admin"
      ? ""
      : h("div", { class: "notice" }, h("strong", {}, "AI isn't set up yet. "), "New websites will start from a template, and AI edits are off. Set ANTHROPIC_API_KEY on the server to turn AI on."),
  );
  render(sites);
}

function statusBadge(site) {
  if (site.status === "generating") return h("span", { class: "badge badge-busy" }, h("span", { class: "spinner", style: { width: "10px", height: "10px", borderWidth: "2px" } }), "Building");
  if (site.status === "error") return h("span", { class: "badge badge-err" }, "Failed");
  if (site.suspended) return h("span", { class: "badge badge-err", title: "The customer's account is suspended, so the site is offline" }, "Suspended");
  if (site.publishedAt) return h("span", { class: "badge badge-live" }, "● Live");
  return h("span", { class: "badge" }, "Draft");
}

// The licence: trial days, renewals and updates (administrator), or a pause notice (customers).
function licenceNotice() {
  const l = me.licence;
  if (!l) return "";
  const box = (cls, ...kids) => h("div", { class: `notice ${cls}`, style: { marginBottom: "10px" } }, ...kids);
  if (me.role !== "admin") return l.allowed ? "" : box("notice-err", "Making new websites and AI are paused on this server. Your published websites are still online, and you can still edit them. Please contact your hosting provider.");
  const link = h("a", { href: "/admin/customers" }, "Enter your licence key");
  if (l.mode === "needed") return box("notice-err", h("strong", {}, `${l.reason}. `), "New websites, new customers and AI are paused; published websites stay online. ", link, ".");
  const out = [];
  if (l.mode === "trial") out.push(box("notice-info", `Free trial: ${l.daysLeft} day${l.daysLeft === 1 ? "" : "s"} left. `, link, " to keep going after that."));
  if (l.update) out.push(box("notice-info", h("strong", {}, `Version ${l.latest.version} is available. `), l.latest.notes || "", " ", l.latest.url ? h("a", { href: l.latest.url, target: "_blank", rel: "noopener" }, "How to update") : ""));
  return out.length ? h("div", {}, out) : "";
}

// ---- accounts ------------------------------------------------------------------

// The administrator gets a Customers link; customers see their plan.
function setupHeader() {
  const top = document.querySelector(".top-in");
  if (top.dataset.ready) return;
  top.dataset.ready = "1";
  const logout = document.getElementById("logout");
  if (me.role === "admin") {
    logout.before(h("a", { class: "btn btn-ghost", href: "/admin/hq", title: "EKA HQ: your AI staff" }, "HQ", me.hqWaiting ? h("span", { class: "hq-count", title: `${me.hqWaiting} waiting for you` }, String(me.hqWaiting)) : null));
    logout.before(h("a", { class: "btn btn-ghost", href: "/admin/customers" }, "Customers"));
  }
  if (me.account) {
    logout.before(h("button", { class: "btn btn-ghost", onclick: changePassword, title: me.account.email }, "My account"));
    document.querySelector(".head p").textContent = "Create, edit and publish your websites.";
  }
}

function accountBar(acc, sites) {
  const parts = [];
  if (acc.plan) parts.push(h("span", {}, h("strong", {}, acc.plan.name), ` plan · ${acc.sites} of ${acc.plan.sites} website${acc.plan.sites === 1 ? "" : "s"}`));
  else parts.push(h("span", {}, "No plan yet: ask your hosting provider."));
  if (me.ai.enabled && acc.plan) {
    parts.push(acc.plan.ai
      ? h("span", { class: "row", style: { gap: "8px" } }, "AI this month:", h("span", { class: "meter", title: `${acc.aiPercent}% used` }, h("span", { style: { width: `${acc.aiPercent}%`, background: acc.aiPercent >= 90 ? "var(--danger)" : "" } })), `${acc.aiPercent}% used`)
      : h("span", {}, "AI isn't included in your plan"));
  }
  if (acc.plan && sites.length >= acc.plan.sites) document.getElementById("new").title = "You've used all the websites in your plan";
  return h("div", { class: "notice notice-info row", style: { flexWrap: "wrap", gap: "8px 24px" } }, parts);
}

function changePassword() {
  const current = h("input", { class: "input", type: "password", autocomplete: "current-password" });
  const next = h("input", { class: "input", type: "password", autocomplete: "new-password", minlength: "8" });
  const m = modal({
    title: "My account",
    body: h("div", {},
      h("p", { class: "muted", style: { marginTop: 0 } }, `Logged in as ${me.account.email}.`),
      h("div", { class: "field" }, h("label", {}, "Current password"), current),
      h("div", { class: "field" }, h("label", {}, "New password (at least 8 characters)"), next)),
    footer: [h("button", { class: "btn", onclick: () => m.close() }, "Cancel"), h("button", { class: "btn btn-primary", onclick: async () => {
      try {
        await api("/account/password", { method: "POST", body: { current: current.value, password: next.value } });
        m.close();
        toast("Password changed.");
      } catch (e) { toast(e.message, { error: true }); }
    } }, "Change password")],
  });
}

// ---- getting started ---------------------------------------------------------

const HIDE_KEY = "eka-getting-started-hidden";
function gettingStarted(sites) {
  try { if (localStorage.getItem(HIDE_KEY)) return null; } catch { /* ignore */ }
  if (me.demo) return null;
  if (me.account) return null; // customers: their host has set everything up
  const steps = [
    { done: sites.length > 0, title: "Make your first website", text: "Describe a business and pick the designs you like.", action: h("a", { class: "btn btn-sm btn-primary", href: "/admin/new" }, "+ New website") },
    { done: me.ai.enabled, title: "Turn on AI", text: "For AI-written designs and changes you describe. Paste your Anthropic API key into settings.txt.", action: h("a", { class: "btn btn-sm", href: "/help#ai", target: "_blank" }, "How") },
    { done: me.stockPhotos, title: "Turn on stock photos (optional)", text: "New designs get real photos that suit the business. A free Pixabay API key goes in settings.txt.", action: h("a", { class: "btn btn-sm", href: "/help#media", target: "_blank" }, "How") },
    { done: sites.some((s) => s.review), title: "Send a customer a review link", text: "They comment on the draft and approve it. In the editor: Site tab → Customer review.", action: null },
    { done: sites.some((s) => s.deploy?.enabled), title: "Connect a customer's hosting", text: "Publish then uploads the site there by FTP. In the editor: Site tab → Your hosting.", action: h("a", { class: "btn btn-sm", href: "/help#publish", target: "_blank" }, "How") },
    { done: sites.some((s) => s.publishedAt), title: "Publish a website", text: "Press Publish in the editor. The site check catches anything unfinished first.", action: null },
  ];
  const done = steps.filter((x) => x.done).length;
  if (done === steps.length) return null;
  const card = h("div", { class: "card getting-started" },
    h("div", { class: "row" },
      h("div", { class: "grow" }, h("h2", { style: { fontSize: "17px", margin: 0 } }, "Getting started"), h("div", { class: "small muted" }, `${done} of ${steps.length} done`)),
      h("button", { class: "btn btn-sm btn-ghost", onclick: () => { try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* ignore */ } card.remove(); } }, "Hide")),
    h("div", { class: "gs-bar" }, h("span", { style: { width: `${(done / steps.length) * 100}%` } })),
    h("ol", { class: "gs-steps" }, steps.map((st) => h("li", { class: st.done ? "done" : "" },
      h("span", { class: "gs-tick", "aria-hidden": "true" }, st.done ? "✓" : ""),
      h("div", { class: "grow" }, h("strong", {}, st.title), h("div", { class: "small muted" }, st.text)),
      st.done ? null : st.action))),
  );
  return card;
}

function render(sites) {
  const gs = document.getElementById("getting-started");
  gs.replaceChildren(...[gettingStarted(sites)].filter(Boolean));
  if (!sites.length) {
    list.replaceChildren(
      h("div", { class: "empty" },
        h("h2", {}, "No websites yet"),
        h("p", { class: "muted" }, "Describe a business and the AI will build the whole site. You can then drag, drop and tweak anything."),
        h("a", { class: "btn btn-primary", href: "/admin/new" }, "+ Create your first website"),
      ),
    );
    return;
  }
  list.replaceChildren(h("div", { class: "grid" }, sites.map(card)));
  for (const s of sites) if (s.status === "generating" && s.jobId) watch(s);
}

function card(site) {
  const ready = site.status !== "generating" && site.status !== "error";
  const thumb = ready
    ? h("a", { class: "thumb", href: `/admin/sites/${site.id}`, "aria-label": `Edit ${site.name}` }, h("iframe", { src: `/admin/preview/${site.id}/`, loading: "lazy", tabindex: "-1", title: "" }))
    : h("div", { class: "thumb" }, h("div", { class: "thumb-name" }, site.name));

  let progress = null;
  if (site.status === "generating") progress = h("div", { class: "progress", "data-progress": site.id }, h("span", { class: "spinner" }), "AI is building this site…");
  if (site.status === "error") progress = h("div", { class: "small", style: { color: "var(--danger)" } }, site.error || "Generation failed.");

  const menuList = h("div", { class: "menu-list", hidden: true },
    h("button", { onclick: () => duplicate(site) }, "Duplicate"),
    site.status === "error" || site.prompt ? h("button", { onclick: () => regenerate(site) }, "Rebuild with AI") : null,
    h("button", { onclick: () => remove(site), style: { color: "var(--danger)" } }, "Delete"),
  );
  const menuBtn = h("button", { class: "btn btn-sm", "aria-label": "More actions", onclick: (e) => { e.stopPropagation(); menuList.hidden = !menuList.hidden; } }, "•••");

  return h("article", { class: "card" },
    thumb,
    h("div", { class: "card-body" },
      h("div", { class: "card-title" }, h("h2", { title: site.name }, site.name), statusBadge(site)),
      h("div", { class: "small muted" }, `Edited ${timeAgo(site.updatedAt)}`, site.publishedAt ? ` · Published ${timeAgo(site.publishedAt)}` : ""),
      site.ownerEmail ? h("div", { class: "small muted", title: "This customer's website" }, `👤 ${site.ownerEmail}`) : null,
      progress,
    ),
    h("div", { class: "card-actions" },
      ready ? h("a", { class: "btn btn-sm btn-primary", href: `/admin/sites/${site.id}` }, "Edit") : null,
      site.publishedAt ? h("a", { class: "btn btn-sm", href: site.liveUrl, target: "_blank", rel: "noopener" }, "View live ↗") : null,
      site.publishedAt ? h("button", { class: "btn btn-sm", onclick: () => openStats(site) }, "📈 Stats") : null,
      h("span", { class: "grow" }),
      h("div", { class: "menu" }, menuBtn, menuList),
    ),
  );
}

function watch(site) {
  if (watching.has(site.jobId)) return;
  watching.add(site.jobId);
  waitForJob(site.jobId, (job) => {
    const el = document.querySelector(`[data-progress="${site.id}"]`);
    if (el && job.status === "running") {
      const kb = (job.progress.chars / 1024).toFixed(1);
      el.lastChild.textContent = job.progress.chars ? `Writing the site… ${kb} KB · ${Math.round(job.elapsedMs / 1000)}s` : `AI is planning the site… ${Math.round(job.elapsedMs / 1000)}s`;
    }
  })
    .then(() => toast(`"${site.name}" is ready to edit.`))
    .catch((err) => toast(`"${site.name}": ${err.message}`, { error: true }))
    .finally(() => { watching.delete(site.jobId); load(); });
}

async function duplicate(site) {
  try {
    await api(`/sites/${site.id}/duplicate`, { method: "POST", body: {} });
    toast("Site duplicated.");
    load();
  } catch (e) { toast(e.message, { error: true }); }
}

async function regenerate(site) {
  if (!(await confirmDialog(`Rebuild "${site.name}" from its original description? The current version is kept in History, so you can restore it.`, { okText: "Rebuild" }))) return;
  try {
    await api(`/sites/${site.id}/regenerate`, { method: "POST", body: {} });
    load();
  } catch (e) { toast(e.message, { error: true }); }
}

async function remove(site) {
  if (!(await confirmDialog(`Delete "${site.name}"? Its pages, images and form messages will be removed and the live site will go offline. This can't be undone.`, { okText: "Delete site", danger: true }))) return;
  try {
    await api(`/sites/${site.id}`, { method: "DELETE" });
    toast("Site deleted.");
    load();
  } catch (e) { toast(e.message, { error: true }); }
}

document.addEventListener("click", () => document.querySelectorAll(".menu-list").forEach((m) => (m.hidden = true)));
document.getElementById("new").addEventListener("click", () => { location.href = "/admin/new"; });
document.getElementById("logout").addEventListener("click", async () => {
  await api("/logout", { method: "POST", body: {} });
  location.href = "/admin/login";
});

load().catch((e) => toast(e.message, { error: true }));

// ---- AI usage ---------------------------------------------------------------

const money = (usd) => (usd < 0.01 && usd > 0 ? "under 1¢" : `$${usd.toFixed(2)}`);

async function showUsageButton() {
  const btn = document.getElementById("usage");
  if (me.role !== "admin" || !me.ai.enabled) return;
  try {
    const { thisMonth } = await api("/usage");
    btn.textContent = `AI this month: ${money(thisMonth.total.cost)}`;
    btn.hidden = false;
    btn.onclick = openUsage;
  } catch { /* leave hidden */ }
}

const KIND_NAMES = {
  concept: "Homepage designs", "concept-another": "Homepage: generate another",
  page: "Page designs", "page-another": "Pages: generate another",
  build: "Building the rest of a site", edit: "Changes (AI tab and wizard)", generate: "Whole sites (quick start)",
};

async function openUsage() {
  const { thisMonth, allTime, names } = await api("/usage");
  const t = thisMonth.total;
  const table = (rows) => h("table", { class: "usage-table" },
    h("tr", {}, h("th", {}, ""), h("th", {}, "Calls"), h("th", {}, "Cost")),
    rows.sort((a, b) => b[1].cost - a[1].cost).map(([label, v]) => h("tr", {}, h("td", {}, label), h("td", {}, String(v.calls)), h("td", {}, money(v.cost)))));
  const saved = t.cacheRead ? Math.round((t.cacheRead / (t.input + t.cacheRead + t.cacheWrite)) * 100) : 0;
  modal({
    title: "AI usage",
    wide: true,
    body: h("div", {},
      h("p", {}, h("strong", {}, `This month: ${money(t.cost)}`), ` from ${t.calls} AI calls. All time: ${money(allTime.total.cost)}.`),
      h("p", { class: "small muted" }, `Estimated from Anthropic's list prices; your Anthropic bill is the exact figure. ${saved ? `${saved}% of what the AI read this month came from the cache at a fraction of the price.` : ""}`),
      h("h3", {}, "By type of job"),
      table(Object.entries(thisMonth.byKind).map(([k, v]) => [KIND_NAMES[k] || k, v])),
      h("h3", {}, "By website"),
      table(Object.entries(thisMonth.bySite).map(([id, v]) => [names[id] || ({ "(not saved yet)": "Designs not built yet", "(demo visitors)": "Demo visitors" })[id] || "Deleted website", v])),
    ),
  });
}

// ---- visitor statistics (counted without cookies) ---------------------------------

async function openStats(site) {
  let days = 30;
  const body = h("div", {}, h("p", { class: "muted" }, "Loading…"));
  modal({ title: `${site.name}: visitors`, wide: true, body });
  async function paint() {
    const { stats, previous, forms, hosted } = await api(`/sites/${site.id}/stats?days=${days}`);
    const change = (a, b) => (b ? h("span", { class: "small", style: { color: a >= b ? "#15803d" : "var(--danger)", fontWeight: 600 } }, ` ${a >= b ? "▲" : "▼"} ${Math.abs(Math.round(((a - b) / b) * 100))}%`) : null);
    const tile = (label, value, extra) => h("div", { class: "stat-tile" }, h("div", { class: "small muted" }, label), h("div", { class: "stat-num" }, String(value), extra));
    const leads = (forms.booking || 0) + (forms.enquiry || 0) + (forms.contact || 0);
    const list = (title, rows, empty) => h("div", {}, h("h3", { style: { fontSize: "14px" } }, title), rows.length
      ? h("table", { class: "usage-table" }, rows.map(([k, n]) => h("tr", {}, h("td", {}, k), h("td", {}, String(n)))))
      : h("p", { class: "small muted" }, empty));
    const dev = stats.devices, devTotal = Object.values(dev).reduce((a, b) => a + b, 0);
    body.replaceChildren(
      h("div", { class: "row", style: { justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "12px" } },
        h("div", { class: "chips" }, [7, 30, 90].map((d) => h("span", { class: `chip${d === days ? " on" : ""}`, role: "button", tabindex: "0", onclick: () => { days = d; paint(); } }, `Last ${d} days`))),
        h("span", { class: "small muted" }, "Counted without cookies; bots and your own previews aren't included.")),
      hosted ? "" : h("div", { class: "notice", style: { marginBottom: "12px" } }, "This site is published to the customer's own hosting, so visits there aren't counted here. Their host's control panel has visitor statistics."),
      h("div", { class: "stat-tiles" },
        tile("Visitors", stats.visitors, change(stats.visitors, previous.visitors)),
        tile("Pages viewed", stats.views, change(stats.views, previous.views)),
        tile("Enquiries & bookings", leads),
        tile("Visitors on phones", devTotal ? `${Math.round(((dev.mobile || 0) / devTotal) * 100)}%` : "–")),
      barChart(stats.daily),
      h("div", { class: "grid2", style: { marginTop: "14px" } },
        list("Most visited pages", stats.pages, "No visits yet."),
        list("Where visitors came from", stats.refs, "Mostly typed in or from bookmarks so far.")),
      reportSettings(site),
    );
  }
  paint().catch((e) => body.replaceChildren(h("p", { class: "notice notice-err" }, e.message)));
}

// One series (visitors per day): bars in the brand colour, hover for the numbers.
function barChart(daily) {
  const W = 760, H = 180, pad = { l: 34, r: 8, t: 10, b: 22 };
  const max = Math.max(4, ...daily.map((d) => d.visitors));
  const nice = Math.ceil(max / 4) * 4;
  const step = (W - pad.l - pad.r) / daily.length, bw = Math.max(2, step - 2);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / nice);
  const ns = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "stat-chart", role: "img", "aria-label": `Visitors per day: ${daily.reduce((a, d) => a + d.visitors, 0)} in total, most on one day ${max}` });
  for (let i = 0; i <= 4; i++) {
    const v = (nice / 4) * i;
    svg.append(el("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: "grid" }), el("text", { x: pad.l - 6, y: y(v) + 4, class: "axis", "text-anchor": "end" }, String(v)));
  }
  const tip = h("div", { class: "stat-tip", hidden: true });
  daily.forEach((d, i) => {
    const x = pad.l + i * step + 1, top = y(d.visitors), hgt = H - pad.b - top;
    const r = Math.min(4, bw / 2, hgt);
    // Rounded at the top, square on the baseline.
    const path = hgt > 0 ? `M${x},${H - pad.b}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${H - pad.b}Z` : "";
    if (path) svg.append(el("path", { d: path, class: "bar" }));
    const hit = el("rect", { x: pad.l + i * step, y: pad.t, width: step, height: H - pad.t - pad.b, class: "hit" });
    hit.addEventListener("mouseenter", () => {
      tip.hidden = false;
      tip.textContent = `${new Date(d.day + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}: ${d.visitors} visitor${d.visitors === 1 ? "" : "s"}, ${d.views} page${d.views === 1 ? "" : "s"}`;
      const pct = ((pad.l + i * step + step / 2) / W) * 100;
      tip.style.left = `${pct}%`;
      // Keep it inside the chart at the edges.
      tip.style.transform = pct > 75 ? "translateX(-100%)" : pct < 25 ? "none" : "translateX(-50%)";
    });
    hit.addEventListener("mouseleave", () => { tip.hidden = true; });
    svg.append(hit);
    if (daily.length <= 31 ? i % Math.ceil(daily.length / 6) === 0 : i % 15 === 0) svg.append(el("text", { x: pad.l + i * step + step / 2, y: H - 6, class: "axis", "text-anchor": "middle" }, new Date(d.day + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" })));
  });
  return h("div", { class: "stat-chart-wrap" }, h("div", { class: "small muted", style: { margin: "14px 0 4px" } }, "Visitors per day"), svg, tip);
}

function reportSettings(site) {
  const on = h("input", { type: "checkbox", checked: site.monthlyReport !== false, onchange: async (e) => {
    try { await api(`/sites/${site.id}/meta`, { method: "PATCH", body: { monthlyReport: e.target.checked } }); site.monthlyReport = e.target.checked; toast("Saved."); } catch (err) { toast(err.message, { error: true }); }
  } });
  return h("div", { style: { marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--line)" } },
    h("label", { class: "check" }, on, "Email a monthly report (visitors, enquiries and bookings) early each month"),
    h("div", { class: "row", style: { marginTop: "8px" } },
      h("button", { class: "btn btn-sm", onclick: async () => {
        const { report } = await api(`/sites/${site.id}/report`, { method: "POST", body: {} });
        modal({ title: report.subject, body: h("div", {}, h("p", { class: "small muted", style: { marginTop: 0 } }, `To: ${report.to || "(no email yet: add one in the editor's Site tab → Forms)"}`), h("pre", { class: "report-preview" }, report.text)),
          footer: [h("button", { class: "btn btn-primary", onclick: async (e) => {
            try { await api(`/sites/${site.id}/report`, { method: "POST", body: { send: true } }); toast("Sent."); e.target.closest(".modal-backdrop").remove(); } catch (err) { toast(err.message, { error: true }); }
          } }, "Send it now")] });
      } }, "Preview last month's report")));
}
