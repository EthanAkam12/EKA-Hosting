// Editor state: the site document, selection, undo/redo and autosave.

import { normalizeSite, findNode, BLOCKS } from "/admin/shared/schema.js";
import { api } from "../ui.js";

const MAX_UNDO = 100;

// A short description of an undo step, from the change's key (see mutate).
function labelFor(key, site) {
  if (!key) return "Change";
  const [area, id, field] = key.split(":");
  const what = (nodeId) => {
    const f = nodeId && findNode(site, nodeId);
    return f ? (f.kind === "block" ? BLOCKS[f.node.type]?.label || "Block" : "Section") : "";
  };
  const names = { prop: () => `Edited ${what(id).toLowerCase() || "block"}`, style: () => `Styled ${what(id).toLowerCase() || "item"}`, sec: () => "Section settings", theme: () => "Site style", header: () => "Header", footer: () => "Footer", page: () => "Page settings", biz: () => "Business details", site: () => "Site settings", menu: () => "Menu links", inline: () => `Typed in ${what(id).toLowerCase() || "text"}` };
  const base = names[area]?.() || "Change";
  return field && area === "style" ? `${base} (${field})` : base;
}

export function createState({ siteId }) {
  const listeners = new Set();
  const state = {
    siteId,
    meta: null,
    site: null,
    pageId: null,
    selectedId: null,
    device: "desktop",
    saving: false,
    dirty: false,
    lastError: null,
  };
  // Undo steps: { snap (JSON of the site before), label, at }.
  let past = [];
  let future = [];
  let coalesce = { key: null, at: 0 };
  let saveTimer = null;
  let savePromise = null;

  const emit = (what, source = null) => listeners.forEach((fn) => fn(what, source));

  const api_ = {
    get: () => state,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    page() {
      return state.site.pages.find((p) => p.id === state.pageId) || state.site.pages[0];
    },
    selected() {
      if (!state.selectedId) return null;
      if (state.selectedId === "header" || state.selectedId === "footer") return { kind: state.selectedId, node: state.site[state.selectedId] };
      return findNode(state.site, state.selectedId);
    },

    load(meta, site) {
      state.meta = meta;
      state.site = normalizeSite(site);
      state.pageId = state.site.pages[0].id;
      past = [];
      future = [];
      emit("all");
    },

    setMeta(meta) {
      state.meta = meta;
      emit("meta");
    },

    // Apply a change. `key` lets rapid edits to the same field (typing)
    // collapse into one undo step.
    mutate(fn, { key = null, silent = false, source = null, label = null } = {}) {
      const now = Date.now();
      const snapshot = JSON.stringify(state.site);
      if (!(key && coalesce.key === key && now - coalesce.at < 1200)) {
        past.push({ snap: snapshot, label: label || labelFor(key, state.site), at: now });
        if (past.length > MAX_UNDO) past.shift();
        future = [];
      }
      coalesce = { key, at: now };
      const draft = structuredClone(state.site);
      fn(draft);
      state.site = normalizeSite(draft);
      if (!state.site.pages.some((p) => p.id === state.pageId)) state.pageId = state.site.pages[0].id;
      if (state.selectedId && !["header", "footer"].includes(state.selectedId) && !findNode(state.site, state.selectedId)) state.selectedId = null;
      api_.scheduleSave();
      emit(silent ? "site-silent" : "site", source);
    },

    // Replace the whole document (AI edits, restores) as a single undo step.
    replaceSite(site, label = "AI change") {
      past.push({ snap: JSON.stringify(state.site), label, at: Date.now() });
      future = [];
      coalesce = { key: null, at: 0 };
      state.site = normalizeSite(site);
      if (!state.site.pages.some((p) => p.id === state.pageId)) state.pageId = state.site.pages[0].id;
      if (state.selectedId && !["header", "footer"].includes(state.selectedId) && !findNode(state.site, state.selectedId)) state.selectedId = null;
      emit("site");
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    // Recent steps, newest first: [{ label, at }].
    history: () => past.map(({ label, at }) => ({ label, at })).reverse(),
    // Undo the newest `n` steps at once.
    undoSteps(n) {
      for (let i = 0; i < n && past.length; i++) api_.undo({ quiet: i < n - 1 });
    },
    undo({ quiet = false } = {}) {
      if (!past.length) return;
      const step = past.pop();
      future.push({ snap: JSON.stringify(state.site), label: step.label, at: step.at });
      state.site = normalizeSite(JSON.parse(step.snap));
      coalesce = { key: null, at: 0 };
      if (!state.site.pages.some((p) => p.id === state.pageId)) state.pageId = state.site.pages[0].id;
      api_.scheduleSave();
      if (!quiet) emit("site");
    },
    redo() {
      if (!future.length) return;
      const step = future.pop();
      past.push({ snap: JSON.stringify(state.site), label: step.label, at: step.at });
      state.site = normalizeSite(JSON.parse(step.snap));
      coalesce = { key: null, at: 0 };
      api_.scheduleSave();
      emit("site");
    },

    select(id) {
      if (state.selectedId === id) return;
      state.selectedId = id;
      emit("selection");
    },

    setPage(id) {
      state.pageId = id;
      state.selectedId = null;
      emit("page");
    },

    setDevice(d) {
      state.device = d;
      emit("device");
    },

    // ---- saving ------------------------------------------------------------
    scheduleSave() {
      state.dirty = true;
      emit("save");
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => api_.save(), 900);
    },

    async save() {
      clearTimeout(saveTimer);
      if (savePromise) await savePromise.catch(() => {});
      if (!state.dirty) return;
      state.dirty = false;
      state.saving = true;
      emit("save");
      savePromise = api(`/sites/${state.siteId}`, { method: "PUT", body: { site: state.site } })
        .then(() => { state.lastError = null; })
        .catch((err) => {
          state.dirty = true;
          state.lastError = err.message;
          saveTimer = setTimeout(() => api_.save(), 5000); // retry
          throw err;
        })
        .finally(() => {
          state.saving = false;
          savePromise = null;
          emit("save");
        });
      return savePromise;
    },

    async flush() {
      clearTimeout(saveTimer);
      if (savePromise) await savePromise.catch(() => {});
      if (state.dirty) await api_.save();
    },
  };

  window.addEventListener("beforeunload", (e) => {
    if (state.dirty || state.saving) {
      api_.save();
      e.preventDefault();
      e.returnValue = "";
    }
  });

  return api_;
}
