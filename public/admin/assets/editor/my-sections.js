// "My sections" (designs saved to reuse on any of your websites) and shared
// sections (one section on several pages of a site: edit any copy and they
// all change).

import { findNode, reId, uid } from "/admin/shared/schema.js";
import { h, api, toast, modal } from "../ui.js";

function askName(title, label, value, okText) {
  return new Promise((resolve) => {
    const input = h("input", { class: "input", value, maxlength: "60" });
    const m = modal({
      title,
      body: h("div", { class: "field" }, h("label", {}, label), input),
      footer: [h("button", { class: "btn", onclick: () => { resolve(null); m.close(); } }, "Cancel"), h("button", { class: "btn btn-primary", onclick: () => { resolve(input.value.trim() || value); m.close(); } }, okText)],
      onClose: () => resolve(null),
    });
    input.select();
  });
}

const firstHeading = (sec) => sec.columns.flatMap((c) => c.blocks).find((b) => b.type === "heading")?.props.text?.slice(0, 40);

export async function saveSection(state, id) {
  const f = findNode(state.get().site, id);
  const sec = f?.kind === "section" ? f.node : f?.section;
  if (!sec) return;
  const name = await askName("Save to My sections", "Name", firstHeading(sec) || "My section", "Save");
  if (!name) return;
  try {
    await api("/saved-sections", { method: "POST", body: { name, sections: [sec], siteId: state.get().siteId } });
    toast(`Saved. Find it in the Section library under "My sections", on any of your websites.`);
  } catch (e) { toast(e.message, { error: true }); }
}

export async function makeShared(state, id) {
  const f = findNode(state.get().site, id);
  const sec = f?.kind === "section" ? f.node : f?.section;
  if (!sec) return;
  const name = await askName("Share this section across pages", "Name (to find it in the library)", firstHeading(sec) || "Shared section", "Make it shared");
  if (!name) return;
  state.mutate((site) => { const n = findNode(site, sec.id); if (n) n.node.shared = { id: uid("sh"), name }; }, { label: "Made a section shared" });
  toast(`"${name}" is shared. Add it to other pages from the Section library ("Shared on this site"); editing any copy changes them all.`);
}

export function stopSharing(state, id) {
  state.mutate((site) => { const n = findNode(site, id); if (n) delete n.node.shared; }, { label: "Stopped sharing a section" });
  toast("This copy is now independent. The other copies stay shared.");
}

/** How many pages a shared section is on. */
export function sharedCount(site, sharedId) {
  return site.pages.filter((p) => p.sections.some((s) => s.shared?.id === sharedId)).length;
}

/** Shared sections on this site, one entry each, for the library. */
export function sharedEntries(site) {
  const seen = new Map();
  for (const p of site.pages) for (const s of p.sections) if (s.shared && !seen.has(s.shared.id)) seen.set(s.shared.id, s);
  return [...seen.values()].map((sec) => ({ id: `shared-${sec.shared.id}`, name: sec.shared.name, make: () => reId(sec) }));
}

/** Saved sections, for the library. Pictures from another website are copied into this one when added. */
export async function savedEntries(state) {
  const { saved } = await api("/saved-sections");
  return saved.map((item) => ({
    id: `saved-${item.id}`, name: item.name, saved: item,
    make: () => item.sections.map(reId),
  }));
}

export async function importSavedMedia(state, sections) {
  const siteId = state.get().siteId;
  const urls = [...new Set([...JSON.stringify(sections).matchAll(/\/_m\/([a-f0-9]+)\/[\w.-]+/g)].filter((m) => m[1] !== siteId).map((m) => m[0]))];
  if (!urls.length) return sections;
  try {
    const { map } = await api(`/sites/${siteId}/media/import`, { method: "POST", body: { urls } });
    let json = JSON.stringify(sections);
    for (const [from, to] of Object.entries(map)) json = json.split(from).join(to);
    return JSON.parse(json);
  } catch { return sections; }
}

export async function deleteSaved(item) {
  await api(`/saved-sections/${item.id}`, { method: "DELETE" });
}
