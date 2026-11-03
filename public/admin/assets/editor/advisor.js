// "Suggestions for this site" in the AI tab: free checks with one-click
// fixes, AI ideas, Google descriptions and local pages.

import { siteAdvice } from "/admin/shared/advice.js";
import { SECTION_LIBRARY } from "/admin/shared/library.js";
import { h, api, waitForJob, toast, modal } from "../ui.js";
import { reworkSections } from "./section-ai.js";

const KEY = (siteId) => `eka-advice-hidden-${siteId}`;
const hidden = (siteId) => { try { return JSON.parse(localStorage.getItem(KEY(siteId))) || []; } catch { return []; } };
const hide = (siteId, id) => { try { localStorage.setItem(KEY(siteId), JSON.stringify([...hidden(siteId), id])); } catch { /* ignore */ } };

let aiIdeas = null; // the last ideas from the AI, kept while the editor is open

async function runJob(path, body) {
  const { jobId } = await api(path, { method: "POST", body });
  return waitForJob(jobId, () => {});
}

export function adviceCard({ state, rerender, runInstruction }) {
  const s = state.get();
  const items = siteAdvice(s.site, { dismissed: hidden(s.siteId) });
  const ai = s.aiEnabled;

  async function fix(item) {
    const f = item.fix;
    if (f.type === "addSection") {
      const entry = SECTION_LIBRARY.find((e) => e.id === f.library);
      const sections = [].concat(entry.make());
      const ids = sections.map((x) => x.id);
      state.mutate((site) => {
        const page = site.pages.find((p) => p.slug === f.page && !p.post) || site.pages[0];
        let at = page.sections.length;
        if (f.before === "contact") { const i = page.sections.findIndex((x) => x.props.anchor === "contact"); if (i !== -1) at = i; }
        if (typeof f.after === "number") at = f.after + 1;
        page.sections.splice(at, 0, ...sections);
      }, { label: `Suggestion: ${item.title}` });
      const page = state.get().site.pages.find((p) => p.slug === f.page && !p.post) || state.get().site.pages[0];
      state.setPage(page.id);
      state.select(ids[0]);
      if (ai) await reworkSections(state, ids, "fill");
      else toast("Added. Change its text to suit the business.");
    } else if (f.type === "fillPage") {
      const page = state.get().site.pages.find((p) => p.slug === f.page);
      state.setPage(page.id);
      if (!ai) return toast("Add more about the business on this page.");
      await reworkSections(state, page.sections.slice(0, 10).map((x) => x.id), "fill");
    } else if (f.type === "seo") {
      if (!ai) return toast("Write them in each page's settings (click an empty part of the page).");
      await writeSeo(state);
    } else if (f.type === "local") {
      if (!ai) return toast("Local pages are written by AI. Add your API key to use this.");
      localPagesDialog(state, rerender);
    } else if (f.type === "site") {
      if (f.select) state.select(f.select);
      if (f.tab) document.querySelector(`[data-tab=${f.tab}]`)?.click();
    }
    rerender();
  }

  const list = items.slice(0, 6).map((item) => h("div", { class: "advice" },
    h("div", { class: "grow" }, h("strong", {}, item.title), h("div", { class: "small muted" }, item.why)),
    h("div", { class: "advice-acts" },
      h("button", { class: "btn btn-sm", onclick: (e) => { e.target.disabled = true; fix(item).finally(() => { e.target.disabled = false; }); } }, ai && !["site", "local"].includes(item.fix.type) ? "✦ Fix it" : "Do it"),
      h("button", { class: "icon-btn", title: "Not for this site", "aria-label": "Hide this suggestion", onclick: () => { hide(s.siteId, item.id); rerender(); } }, "✕"))));

  const ideas = (aiIdeas?.siteId === s.siteId ? aiIdeas.ideas : []).map((idea, i) => h("div", { class: "advice" },
    h("div", { class: "grow" }, h("strong", {}, `✦ ${idea.title}`), h("div", { class: "small muted" }, idea.why)),
    h("div", { class: "advice-acts" }, h("button", { class: "btn btn-sm", onclick: () => { aiIdeas.ideas.splice(i, 1); runInstruction(idea.instruction); } }, "Do it"))));

  return h("details", { class: "card advice-card", open: items.length > 0 || ideas.length > 0 },
    h("summary", {}, h("strong", {}, "💡 Suggestions for this site"), h("span", { class: "small muted" }, items.length ? ` ${items.length}` : " ✓")),
    list.length ? list : h("p", { class: "small muted" }, "Nothing obvious missing. Nice work!"),
    ideas,
    ai ? h("div", { class: "row", style: { flexWrap: "wrap", gap: "6px", marginTop: "8px" } },
      h("button", { class: "btn btn-sm", onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = "Thinking…";
        try {
          const { ideas: got } = await runJob(`/sites/${s.siteId}/ai/ideas`, { site: state.get().site });
          aiIdeas = { siteId: s.siteId, ideas: got };
          if (!got.length) toast("The AI had no further ideas.");
        } catch (err) { toast(err.message, { error: true }); }
        rerender();
      } }, "✦ More ideas from the AI"),
      h("button", { class: "btn btn-sm", onclick: () => writeSeo(state).then(rerender) }, "✦ Google descriptions"),
      h("button", { class: "btn btn-sm", onclick: () => localPagesDialog(state, rerender) }, "✦ Local pages…")) : null);
}

async function writeSeo(state) {
  const note = toast("✦ Writing Google titles and descriptions…", { sticky: true });
  try {
    const { pages } = await runJob(`/sites/${state.get().siteId}/ai/seo`, { site: state.get().site });
    state.mutate((site) => {
      for (const p of pages) {
        const page = site.pages.find((x) => x.slug === p.slug);
        if (page) { page.seo.title = p.title; page.seo.description = p.description; }
      }
    }, { label: "AI wrote Google descriptions" });
    toast(`Done for ${pages.length} page${pages.length === 1 ? "" : "s"}. See them in each page's settings.`);
  } catch (err) { toast(err.message, { error: true }); } finally { note.remove(); }
}

function localPagesDialog(state, rerender) {
  const service = h("input", { class: "input", placeholder: "e.g. Plumber, Wedding photographer, Dog groomer", value: state.get().site.business?.type || "" });
  const towns = h("textarea", { class: "textarea", rows: "3", placeholder: "Leeds, Wakefield, Harrogate" });
  const m = modal({
    title: "✦ Local pages",
    body: h("div", {},
      h("p", { style: { marginTop: 0 } }, "A page for each town you cover, like \"Plumber in Leeds\", so you show up when people search for your service there. Each is written separately (not copies), kept out of the menu, and linked from the footer."),
      h("div", { class: "field" }, h("label", {}, "What you do"), service),
      h("div", { class: "field" }, h("label", {}, "Towns or areas (up to 6, separated by commas)"), towns)),
    footer: [h("button", { class: "btn", onclick: () => m.close() }, "Cancel"), h("button", { class: "btn btn-primary", onclick: async (e) => {
      const list = towns.value.split(/[,\n]/).map((t) => t.trim()).filter(Boolean).slice(0, 6);
      if (!service.value.trim() || !list.length) return toast("Fill in both boxes.", { error: true });
      m.close();
      const note = toast(`✦ Writing ${list.length} local page${list.length === 1 ? "" : "s"}…`, { sticky: true });
      try {
        const { pages } = await runJob(`/sites/${state.get().siteId}/ai/local`, { site: state.get().site, service: service.value.trim(), towns: list });
        state.mutate((site) => {
          for (const page of pages) {
            if (site.pages.some((p) => p.slug === page.slug)) continue;
            site.pages.push(page);
            site.footer.links.push({ text: page.title, href: `/${page.slug}` });
          }
        }, { label: "AI added local pages" });
        toast(`Added ${pages.length} page${pages.length === 1 ? "" : "s"} (Pages tab), linked from the footer.`);
      } catch (err) { toast(err.message, { error: true }); } finally { note.remove(); rerender(); }
    } }, "Write the pages")],
  });
}
