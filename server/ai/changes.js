// Applies an AI edit given as a list of changes (see EDIT_SYSTEM) instead of
// a whole new site. The AI writes far less, so edits are cheaper and faster,
// and parts of the site it wasn't asked about can't drift.

import { normalizeSite, normalizeSection, normalizeBlock, normalizePage, findNode } from "../../shared/schema.js";

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

// Objects merge key by key; anything else (strings, arrays) is replaced.
function merge(target, patch) {
  const out = isObj(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch || {})) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
  return out;
}

function sectionIndex(page, id) {
  return page.sections.findIndex((s) => s.id === id);
}

function insertAfter(page, after, section) {
  const i = after ? sectionIndex(page, after) : -1;
  if (after && i === -1) throw new Error(`section ${after} not found`);
  page.sections.splice(i + 1, 0, section);
}

/** Returns { site, applied, failed: [messages] }. Never changes `site` in place. */
export function applyChanges(site, changes) {
  const next = structuredClone(site);
  const failed = [];
  let applied = 0;
  for (const c of Array.isArray(changes) ? changes : []) {
    try {
      switch (c?.op) {
        case "theme": next.theme = merge(next.theme, c.theme); break;
        case "header": next.header = merge(next.header, c.header); break;
        case "footer": next.footer = merge(next.footer, c.footer); break;
        case "site":
          if (typeof c.name === "string") next.name = c.name;
          if (typeof c.customCss === "string") next.customCss = c.customCss;
          break;
        case "replace": {
          const found = findNode(next, c.id);
          if (!found || (found.kind !== "section" && found.kind !== "block")) throw new Error(`${c.id} not found`);
          const node = found.kind === "section" ? normalizeSection({ ...c.node, id: c.id }) : normalizeBlock({ ...c.node, id: c.id });
          if (!node) throw new Error(`${c.id}: not a valid ${found.kind}`);
          found.parent[found.index] = node;
          break;
        }
        case "insert": {
          const page = next.pages.find((p) => p.slug === c.page) || next.pages.find((p) => c.after && sectionIndex(p, c.after) !== -1);
          if (!page) throw new Error(`page ${c.page} not found`);
          const section = normalizeSection(c.section);
          if (!section) throw new Error("not a valid section");
          insertAfter(page, c.after, section);
          break;
        }
        case "remove": {
          const found = findNode(next, c.id);
          if (!found || (found.kind !== "section" && found.kind !== "block")) throw new Error(`${c.id} not found`);
          found.parent.splice(found.index, 1);
          break;
        }
        case "move": {
          const found = findNode(next, c.id);
          if (!found || found.kind !== "section") throw new Error(`section ${c.id} not found`);
          const [section] = found.page.sections.splice(found.index, 1);
          insertAfter(found.page, c.after, section);
          break;
        }
        case "page": {
          const i = next.pages.findIndex((p) => p.slug === c.page?.slug);
          const page = normalizePage(c.page, i === 0 ? 0 : 1);
          if (!page) throw new Error("not a valid page");
          if (i === -1) next.pages.push(page);
          else next.pages[i] = { ...page, id: next.pages[i].id };
          break;
        }
        case "removePage": {
          const i = next.pages.findIndex((p) => p.slug === c.slug);
          if (i <= 0) throw new Error(i === 0 ? "the home page can't be removed" : `page ${c.slug} not found`);
          next.pages.splice(i, 1);
          break;
        }
        default:
          throw new Error(`unknown change "${c?.op}"`);
      }
      applied++;
    } catch (err) {
      failed.push(err.message);
    }
  }
  return { site: normalizeSite(next), applied, failed };
}
