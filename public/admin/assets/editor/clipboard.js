// Copy and paste of sections and blocks (within a page, across pages and
// across websites), and copy/paste of an element's style. Kept in the
// browser's storage so it works between editor tabs.

import { findNode, reId, createSection, BLOCKS } from "/admin/shared/schema.js";
import { api, toast } from "../ui.js";

const KEY = "eka-clipboard";
const STYLE_KEY = "eka-style-clipboard";

const read = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const write = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } };

export const clipboard = {
  peek: () => read(KEY),
  peekStyle: () => read(STYLE_KEY),

  copy(state, id) {
    const f = findNode(state.get().site, id);
    if (!f || (f.kind !== "block" && f.kind !== "section")) return;
    write(KEY, { kind: f.kind, node: f.node, siteId: state.get().siteId });
    toast(`Copied ${f.kind === "block" ? BLOCKS[f.node.type]?.label.toLowerCase() : "section"}. Select where it should go and paste (Ctrl+V).`);
  },

  // Pastes after the selected item: a block next to the selected block (or
  // into the selected section); a section after the selected section.
  async paste(state) {
    const clip = read(KEY);
    if (!clip) return toast("Nothing copied yet.", { error: true });
    const s = state.get();
    let node = reId(clip.node);
    // From another website: bring its images along.
    if (clip.siteId && clip.siteId !== s.siteId) {
      const urls = [...new Set([...JSON.stringify(node).matchAll(/\/_m\/[a-f0-9]+\/[\w.-]+/g)].map((m) => m[0]))];
      if (urls.length) {
        try {
          const { map } = await api(`/sites/${s.siteId}/media/import`, { method: "POST", body: { urls } });
          let json = JSON.stringify(node);
          for (const [from, to] of Object.entries(map)) json = json.split(from).join(to);
          node = JSON.parse(json);
        } catch (e) { toast(`Images couldn't be copied: ${e.message}`, { error: true }); }
      }
    }
    const sel = s.selectedId ? findNode(s.site, s.selectedId) : null;
    state.mutate((site) => {
      const page = site.pages.find((p) => p.id === s.pageId) || site.pages[0];
      const f = sel ? findNode(site, sel.node.id) : null;
      if (clip.kind === "section") {
        const at = f ? page.sections.indexOf(f.kind === "section" ? f.node : f.section) : -1;
        page.sections.splice(at === -1 ? page.sections.length : at + 1, 0, node);
      } else if (f?.kind === "block") f.parent.splice(f.index + 1, 0, node);
      else if (f?.kind === "column") f.node.blocks.push(node);
      else if (f?.kind === "section") f.node.columns[0].blocks.push(node);
      else page.sections.push(createSection({}, [[node]]));
    }, { label: `Pasted ${clip.kind === "block" ? BLOCKS[clip.node.type]?.label.toLowerCase() : "section"}` });
    state.select(node.id);
    return node.id;
  },

  copyStyle(state, id) {
    const f = id === "header" || id === "footer" ? { node: state.get().site[id] } : findNode(state.get().site, id);
    if (!f) return;
    write(STYLE_KEY, { style: f.node.style || {} });
    toast("Style copied. Select something else and choose Paste style.");
  },

  pasteStyle(state, id) {
    const clip = read(STYLE_KEY);
    if (!clip) return toast("No style copied yet.", { error: true });
    state.mutate((site) => {
      const f = id === "header" || id === "footer" ? { node: site[id] } : findNode(site, id);
      if (f) f.node.style = structuredClone(clip.style);
    }, { label: "Pasted style" });
  },
};
