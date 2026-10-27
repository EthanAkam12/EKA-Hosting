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
  notice.replaceChildren(
    me.ai.enabled
      ? ""
      : h("div", { class: "notice" }, h("strong", {}, "AI isn't set up yet. "), "New websites will start from a template, and AI edits are off. Set ANTHROPIC_API_KEY on the server to turn AI on."),
  );
  render(sites);
}

function statusBadge(site) {
  if (site.status === "generating") return h("span", { class: "badge badge-busy" }, h("span", { class: "spinner", style: { width: "10px", height: "10px", borderWidth: "2px" } }), "Building");
  if (site.status === "error") return h("span", { class: "badge badge-err" }, "Failed");
  if (site.publishedAt) return h("span", { class: "badge badge-live" }, "● Live");
  return h("span", { class: "badge" }, "Draft");
}

// ---- getting started ---------------------------------------------------------

const HIDE_KEY = "eka-getting-started-hidden";
function gettingStarted(sites) {
  try { if (localStorage.getItem(HIDE_KEY)) return null; } catch { /* ignore */ }
  if (me.demo) return null;
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
      progress,
    ),
    h("div", { class: "card-actions" },
      ready ? h("a", { class: "btn btn-sm btn-primary", href: `/admin/sites/${site.id}` }, "Edit") : null,
      site.publishedAt ? h("a", { class: "btn btn-sm", href: site.liveUrl, target: "_blank", rel: "noopener" }, "View live ↗") : null,
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
  if (me.demo || !me.ai.enabled) return;
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
