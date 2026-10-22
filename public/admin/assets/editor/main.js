// Editor entry point: loads the site and wires the canvas, panels and top bar together.

import { h, api, waitForJob, toast, modal, confirmDialog, timeAgo } from "../ui.js";
import { createState } from "./state.js";
import { createCanvas } from "./canvas.js";
import { createInspector } from "./inspector.js";
import { createPanels } from "./panels.js";
import { openMediaPicker } from "./media.js";
import { findNode } from "/admin/shared/schema.js";

const siteId = location.pathname.split("/").filter(Boolean)[2];
const $ = (id) => document.getElementById(id);
const frameWrap = $("frame-wrap");

const state = createState({ siteId });

// Image picking: either for a field (callback) or for an image block on the canvas.
function pickImage(cb) {
  openMediaPicker(siteId, cb);
}

function pickImageForBlock(blockId) {
  const f = findNode(state.get().site, blockId);
  if (!f) return;
  openMediaPicker(siteId, (url) => state.mutate((site) => {
    const n = findNode(site, blockId);
    if (!n) return;
    if (n.node.type === "gallery") n.node.props.images.push({ src: url, alt: "" });
    else n.node.props.src = url;
  }));
}

const canvas = createCanvas({
  state,
  iframe: $("canvas"),
  overlay: $("overlay"),
  frameWrap,
  onRequestMedia: pickImageForBlock,
  onAskAi: (id) => panels.askAi(id),
  onKey: handleKey,
});

const inspector = createInspector({
  state,
  canvas,
  root: $("inspector"),
  head: $("inspector-head"),
  pickImage,
  askAi: (id) => panels.askAi(id),
});

const panels = createPanels({
  state,
  canvas,
  root: $("left-panel"),
  tabs: [...document.querySelectorAll(".tab")],
  pickImage,
  onMetaChange: (meta) => state.setMeta(meta),
});

// --------------------------------------------------------------- top bar --

function renderBar() {
  const s = state.get();
  $("site-name").textContent = s.site.name;
  document.title = `${s.site.name} · Editor`;
  const status = $("site-status");
  status.textContent = s.meta.publishedAt ? "● Live" : "Draft";
  status.className = `badge${s.meta.publishedAt ? " badge-live" : ""}`;
  const live = $("live-btn");
  live.hidden = !s.meta.publishedAt;
  live.href = s.meta.liveUrl;

  const sel = $("page-select");
  sel.replaceChildren(...s.site.pages.map((p) => h("option", { value: p.id, selected: p.id === s.pageId }, p.title)));
  $("undo").disabled = !state.canUndo();
  $("redo").disabled = !state.canRedo();
}

function renderSaveState() {
  const s = state.get();
  const el = $("save-state");
  if (s.lastError) { el.textContent = "Not saved – retrying"; el.style.color = "var(--danger)"; return; }
  el.style.color = "";
  el.textContent = s.saving ? "Saving…" : s.dirty ? "Unsaved changes" : "All changes saved";
}

$("page-select").addEventListener("change", (e) => state.setPage(e.target.value));
$("undo").addEventListener("click", () => state.undo());
$("redo").addEventListener("click", () => state.redo());
document.querySelectorAll("[data-device]").forEach((b) => b.addEventListener("click", () => state.setDevice(b.dataset.device)));

$("preview-btn").addEventListener("click", async (e) => {
  e.preventDefault();
  const w = window.open("about:blank", "_blank");
  await state.flush().catch(() => {});
  const page = state.page();
  const url = `/admin/preview/${siteId}/${page.slug === "index" ? "" : `${page.slug}/`}`;
  if (w) w.location.href = url; else location.href = url;
});

$("publish-btn").addEventListener("click", async () => {
  const btn = $("publish-btn");
  btn.disabled = true;
  btn.textContent = "Publishing…";
  try {
    await state.flush();
    const first = !state.get().meta.publishedAt;
    const { meta } = await api(`/sites/${siteId}/publish`, { method: "POST", body: {} });
    state.setMeta(meta);
    if (first) {
      modal({
        title: "Your site is live 🎉",
        body: h("div", {},
          h("p", { style: { marginTop: 0 } }, "The site is published at:"),
          h("p", {}, h("a", { href: meta.liveUrl, target: "_blank", rel: "noopener", style: { fontWeight: 600, wordBreak: "break-all" } }, new URL(meta.liveUrl, location.href).href)),
          h("p", { class: "muted small" }, "Keep editing as much as you like. Visitors only see changes after you click Publish again."),
        ),
      });
    } else toast("Published. Your changes are live.");
  } catch (err) {
    toast(err.message, { error: true });
  } finally {
    btn.disabled = false;
    btn.textContent = "Publish";
  }
});

$("history-btn").addEventListener("click", openHistory);

async function openHistory() {
  await state.flush().catch(() => {});
  const list = h("div", {}, h("p", { class: "muted" }, "Loading…"));
  const label = h("input", { class: "input", placeholder: "Name this version, e.g. 'Before client feedback'" });
  const m = modal({
    title: "History",
    body: h("div", {},
      h("div", { class: "row", style: { marginBottom: "14px" } }, label, h("button", { class: "btn", onclick: async () => {
        await api(`/sites/${siteId}/versions`, { method: "POST", body: { label: label.value.trim() || "Saved version", site: state.get().site } });
        label.value = "";
        toast("Version saved.");
        load();
      } }, "Save current version")),
      h("p", { class: "field-hint" }, "A version is saved automatically before every AI change, on every publish and before restoring."),
      list,
    ),
  });
  async function load() {
    const { versions } = await api(`/sites/${siteId}/versions`);
    list.replaceChildren(...(versions.length ? versions.map((v) => h("div", { class: "version" },
      h("div", { class: "grow" }, h("div", { style: { fontWeight: 600 } }, v.label), h("div", { class: "small muted" }, `${new Date(v.createdAt).toLocaleString()} · ${timeAgo(v.createdAt)}`)),
      h("button", { class: "btn btn-sm", onclick: async () => {
        if (!(await confirmDialog(`Restore "${v.label}"? Your current version is saved in History first.`, { okText: "Restore" }))) return;
        const { site } = await api(`/sites/${siteId}/versions/${v.id}/restore`, { method: "POST", body: {} });
        state.replaceSite(site);
        m.close();
        toast("Version restored.");
      } }, "Restore"),
    )) : [h("p", { class: "muted" }, "No saved versions yet.")]));
  }
  load().catch((e) => toast(e.message, { error: true }));
}

// -------------------------------------------------------------- keyboard --

function handleKey(e) {
  const t = e.target;
  const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && key === "s") { e.preventDefault(); state.flush().then(() => toast("Saved.")); return; }
  if (typing || canvas.isEditingText()) return;
  const sel = state.get().selectedId;
  if (mod && key === "z" && !e.shiftKey) { e.preventDefault(); state.undo(); }
  else if (mod && (key === "y" || (key === "z" && e.shiftKey))) { e.preventDefault(); state.redo(); }
  else if (mod && key === "d" && sel) { e.preventDefault(); canvas.duplicate(sel); }
  else if ((key === "delete" || key === "backspace") && sel && !["header", "footer"].includes(sel)) {
    const f = findNode(state.get().site, sel);
    if (f && (f.kind === "block" || f.kind === "section")) { e.preventDefault(); canvas.remove(sel); }
  } else if (key === "escape") state.select(null);
  else if (e.altKey && (key === "arrowup" || key === "arrowdown") && sel) { e.preventDefault(); canvas.moveBy(sel, key === "arrowup" ? -1 : 1); }
}
document.addEventListener("keydown", handleKey);
// Lay the canvas out at the device's real width, scaled to fit the stage.
const DEVICE_WIDTH = { desktop: 1280, tablet: 820, mobile: 390 };
function layoutFrame() {
  const stage = $("stage");
  const cs = getComputedStyle(stage);
  const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const logical = DEVICE_WIDTH[state.get().device];
  const scale = Math.min(1, availW / logical);
  const inner = $("frame-scale");
  frameWrap.style.width = `${Math.round(logical * scale)}px`;
  inner.style.width = `${logical}px`;
  inner.style.height = `${availH / scale}px`;
  inner.style.transform = scale < 1 ? `scale(${scale})` : "";
  canvas.setScale(scale);
}
window.addEventListener("resize", layoutFrame);

// ------------------------------------------------------------- reactions --

state.on((what, source) => {
  const active = panels.active();
  switch (what) {
    case "all":
      canvas.render({ keepScroll: false });
      inspector.render();
      panels.render();
      renderBar();
      renderSaveState();
      break;
    case "site":
      canvas.render();
      if (source !== "inspector") inspector.render();
      if (source !== "panel" && ["pages", "theme", "settings"].includes(active)) panels.render();
      renderBar();
      break;
    case "site-silent":
      inspector.render();
      renderBar();
      break;
    case "selection":
      canvas.updateSelection();
      inspector.render();
      break;
    case "page":
      canvas.render({ keepScroll: false });
      inspector.render();
      if (active === "pages") panels.render();
      renderBar();
      break;
    case "device":
      document.querySelectorAll("[data-device]").forEach((b) => b.classList.toggle("active", b.dataset.device === state.get().device));
      layoutFrame();
      break;
    case "save":
      renderSaveState();
      break;
    case "meta":
      renderBar();
      if (active === "settings") panels.render();
      break;
  }
});

// ------------------------------------------------------------------ boot --

async function boot() {
  const [{ meta, site }, me] = await Promise.all([api(`/sites/${siteId}`), api("/me")]);
  if (meta.status === "generating" && meta.jobId) {
    const msg = h("div", { class: "empty-insp", style: { position: "fixed", inset: 0, background: "var(--bg)", display: "grid", placeItems: "center", zIndex: 50 } },
      h("div", {}, h("div", { class: "spinner", style: { width: "28px", height: "28px", color: "var(--brand)" } }), h("h2", { style: { margin: "14px 0 6px" } }, "The AI is building this site…"), h("p", { id: "gen-progress" }, "This usually takes a minute or two.")));
    document.body.append(msg);
    try {
      await waitForJob(meta.jobId, (job) => { $("gen-progress").textContent = job.progress.chars ? `Writing the site… ${(job.progress.chars / 1024).toFixed(1)} KB · ${Math.round(job.elapsedMs / 1000)}s` : `Planning… ${Math.round(job.elapsedMs / 1000)}s`; });
    } catch (err) {
      $("gen-progress").textContent = `Generation failed: ${err.message}`;
      return;
    }
    location.reload();
    return;
  }
  if (!site) {
    document.body.replaceChildren(h("div", { style: { padding: "40px", textAlign: "center" } }, h("h2", {}, "This site has no content"), h("p", {}, meta.error || ""), h("a", { class: "btn", href: "/admin" }, "Back to websites")));
    return;
  }
  const s = state.get();
  s.aiEnabled = me.ai.enabled;
  s.baseDomain = me.baseDomain;
  await canvas.boot();
  layoutFrame();
  state.load(meta, site);
}

boot().catch((err) => toast(err.message, { error: true }));
