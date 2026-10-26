import { h, api, waitForJob, toast, modal, confirmDialog, timeAgo, demoBanner } from "./ui.js";

const list = document.getElementById("list");
const notice = document.getElementById("notice");
let me = null;
const watching = new Set();


async function load() {
  const [{ sites }, meData] = await Promise.all([api("/sites"), me ? Promise.resolve(me) : api("/me")]);
  if (!me) demoBanner(meData);
  me = meData;
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

function render(sites) {
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
