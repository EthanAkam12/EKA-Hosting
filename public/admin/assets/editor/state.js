// Editor state: the site document, selection, undo/redo and autosave.

import { normalizeSite, findNode } from "/admin/shared/schema.js";
import { api } from "../ui.js";

const MAX_UNDO = 100;

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
    mutate(fn, { key = null, silent = false, source = null } = {}) {
      const now = Date.now();
      const snapshot = JSON.stringify(state.site);
      if (!(key && coalesce.key === key && now - coalesce.at < 1200)) {
        past.push(snapshot);
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
    replaceSite(site) {
      past.push(JSON.stringify(state.site));
      future = [];
      coalesce = { key: null, at: 0 };
      state.site = normalizeSite(site);
      if (!state.site.pages.some((p) => p.id === state.pageId)) state.pageId = state.site.pages[0].id;
      if (state.selectedId && !["header", "footer"].includes(state.selectedId) && !findNode(state.site, state.selectedId)) state.selectedId = null;
      emit("site");
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    undo() {
      if (!past.length) return;
      future.push(JSON.stringify(state.site));
      state.site = normalizeSite(JSON.parse(past.pop()));
      coalesce = { key: null, at: 0 };
      if (!state.site.pages.some((p) => p.id === state.pageId)) state.pageId = state.site.pages[0].id;
      api_.scheduleSave();
      emit("site");
    },
    redo() {
      if (!future.length) return;
      past.push(JSON.stringify(state.site));
      state.site = normalizeSite(JSON.parse(future.pop()));
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
