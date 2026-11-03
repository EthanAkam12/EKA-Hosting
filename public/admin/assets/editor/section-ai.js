// "✦ Fill with AI" (writes a section's text for this business, with photos)
// and "✦ Restyle" (a new design, same words) for sections in the editor.

import { h, api, waitForJob, toast, modal } from "../ui.js";

const busy = new Set();

export async function reworkSections(state, ids, mode = "fill", wishes = "") {
  if (!ids.length || ids.some((id) => busy.has(id))) return;
  ids.forEach((id) => busy.add(id));
  const note = toast(mode === "restyle" ? "✦ Restyling the section…" : "✦ Writing the section for this business…", { sticky: true });
  try {
    const s = state.get();
    const { jobId } = await api(`/sites/${s.siteId}/ai/sections`, { method: "POST", body: { site: s.site, ids, mode, wishes } });
    const { sections } = await waitForJob(jobId, () => {});
    state.mutate((site) => {
      for (const sec of sections) {
        for (const page of site.pages) {
          const i = page.sections.findIndex((x) => x.id === sec.id);
          if (i !== -1) page.sections[i] = sec;
        }
      }
    }, { label: mode === "restyle" ? "AI restyled a section" : "AI filled a section" });
    toast(mode === "restyle" ? "Restyled. Undo (Ctrl+Z) to go back." : "Done. Change anything you like, or Undo (Ctrl+Z).");
  } catch (err) {
    toast(err.message, { error: true });
  } finally {
    note?.remove?.();
    ids.forEach((id) => busy.delete(id));
  }
}

/** Asks how to restyle (optional), then does it. */
export function restyleDialog(state, ids) {
  const wishes = h("input", { class: "input", placeholder: "Optional: e.g. darker and more premium, or with a photo background" });
  const m = modal({
    title: "✦ Restyle with AI",
    body: h("div", {}, h("p", { style: { marginTop: 0 } }, "The AI gives this section a new design and keeps all its words, links and pictures."), h("div", { class: "field" }, h("label", {}, "Any wishes?"), wishes)),
    footer: [h("button", { class: "btn", onclick: () => m.close() }, "Cancel"), h("button", { class: "btn btn-primary", onclick: () => { m.close(); reworkSections(state, ids, "restyle", wishes.value.trim()); } }, "Restyle it")],
  });
}
