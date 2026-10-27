// AI layer. Picks a provider from the environment and turns its text output
// into validated site documents.
//
// To add another AI provider, write a module that exports
//   { name, model, complete({ system, prompt, model, effort, onProgress }) → Promise<string> }
// and register it in pickProvider() below. Everything else is shared.

import { normalizeSite, normalizeSection, normalizeBlock, normalizePage, findNode, slugify } from "../../shared/schema.js";
import { createAnthropicProvider } from "./anthropic.js";
import { applyChanges } from "./changes.js";
import { partialDesign } from "./partial.js";
import { createDemoProvider } from "./demo.js";
import { GENERATE_SYSTEM, EDIT_SYSTEM, CONCEPT_SYSTEM, BUILD_SYSTEM, PAGE_SYSTEM, generatePrompt, editPrompt, conceptPrompt, buildPrompt, pagePrompt, describeLayout, describePage } from "./prompts.js";

function pickProvider() {
  const choice = (process.env.AI_PROVIDER || "").toLowerCase();
  const hasClaude = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  if (choice === "demo" || (!choice && !hasClaude)) return createDemoProvider();
  if (choice === "" || choice === "claude" || choice === "anthropic") {
    return createAnthropicProvider({
      model: process.env.AI_MODEL || "claude-opus-5-5",
      effort: process.env.AI_EFFORT || "medium",
    });
  }
  throw new Error(`Unknown AI_PROVIDER "${choice}". Use "claude" or "demo".`);
}

// `provider` can be injected (used by the tests); normally it comes from env.
export function createAi({ provider = pickProvider() } = {}) {
  const generateEffort = process.env.AI_GENERATE_EFFORT || "high";
  // Homepage and page designs are what the owner judges first: a strong first
  // design saves rounds of changes, so they get the same effort as full builds.
  const conceptEffort = process.env.AI_CONCEPT_EFFORT || "high";
  // New sites use the strongest model; changes use a faster, cheaper one.
  const generateModel = process.env.AI_MODEL || provider.model;
  const editModel = process.env.AI_EDIT_MODEL || (provider.name === "claude" ? "claude-sonnet-5-5" : provider.model);

  return {
    provider: provider.name,
    model: generateModel,
    editModel,
    enabled: provider.name !== "demo",

    async generateSite({ name, prompt, media = [], onProgress }) {
      if (provider.generateSite) {
        const result = await provider.generateSite({ name, prompt });
        return { ...result, site: normalizeSite(result.site) };
      }
      const text = await provider.complete({
        kind: "generate",
        system: GENERATE_SYSTEM,
        prompt: generatePrompt({ name, prompt, media }),
        model: generateModel,
        effort: generateEffort,
        onProgress,
      });
      const data = parseJson(text);
      const site = normalizeSite(data.site && data.pages === undefined ? data.site : data);
      if (name) site.name = name;
      return { site, summary: "Site generated." };
    },

    // ---- new-site wizard ---------------------------------------------------

    // A home-page-only design for the owner to judge. `previous` = layout
    // descriptions of concepts already shown, so the next one differs.
    async generateConcept({ brief, previous = [], images = [], onProgress }) {
      let site;
      if (provider.generateConcept) {
        site = normalizeSite((await provider.generateConcept({ brief, variant: previous.length })).site);
      } else {
        const text = await provider.complete({
          kind: previous.length ? "concept-another" : "concept",
          system: CONCEPT_SYSTEM,
          prompt: conceptPrompt({ brief: { ...brief, imagesAttached: images.length > 0 }, previous }),
          images,
          model: generateModel,
          effort: conceptEffort,
          onProgress: previewProgress(onProgress, (part) => applyBrief(normalizeSite({
            name: brief.name, theme: part.theme, header: part.header, footer: part.footer,
            pages: [{ title: "Home", slug: "index", sections: part.sections }],
          }), brief)),
        });
        const data = parseJson(text);
        site = normalizeSite(data.site && data.pages === undefined ? data.site : data);
      }
      site = applyBrief(site, brief);
      return { site, layout: describeLayout(site) };
    },

    // Applies a written change ("make it darker") to a concept. With pageSlug,
    // the change is about that page (the wizard's "design each page" step).
    async refineConcept({ concept, instruction, pageSlug, onProgress }) {
      const page = pageSlug ? concept.pages.find((p) => p.slug === pageSlug) : null;
      const result = await this.editSite({ site: concept, instruction, pageId: page?.id, onProgress });
      return { ...result, layout: page ? describePage(result.site.pages.find((p) => p.slug === pageSlug) || page) : describeLayout(result.site) };
    },

    // One page in the approved style; `previous` = layouts already shown for it.
    async generatePage({ brief, concept, title, previous = [], wishes = "", onProgress }) {
      let page;
      if (provider.generatePage) {
        page = (await provider.generatePage({ brief, concept, title, variant: previous.length })).page;
      } else {
        const text = await provider.complete({
          kind: previous.length ? "page-another" : "page",
          system: PAGE_SYSTEM,
          prompt: pagePrompt({ brief, concept, title, previous, wishes }),
          model: generateModel,
          effort: conceptEffort,
          onProgress: previewProgress(onProgress, (part) => normalizePage({ title, slug: slugify(title), sections: part.sections }, 1)),
        });
        const data = parseJson(text);
        page = data.page || data;
      }
      page = normalizePage({ ...page, title, slug: slugify(title) }, 1);
      return { page, layout: describePage(page) };
    },

    // Builds the remaining pages in the approved concept's style.
    async buildFromConcept({ brief, concept, requests = [], pageNotes = {}, onProgress }) {
      if (provider.buildFromConcept) {
        return { site: applyBrief(normalizeSite((await provider.buildFromConcept({ brief, concept, pageNotes })).site), brief) };
      }
      const text = await provider.complete({
        kind: "build",
        system: BUILD_SYSTEM,
        prompt: buildPrompt({ brief, concept, requests, pageNotes }),
        model: generateModel,
        effort: generateEffort,
        onProgress,
      });
      const data = parseJson(text);
      const extra = (Array.isArray(data.pages) ? data.pages : []).filter((p) => p && p.slug !== "index");
      const site = structuredClone(concept);
      site.pages = [concept.pages[0], ...extra];
      const links = Array.isArray(data.headerLinks) ? data.headerLinks.filter((l) => l && l.text) : [];
      site.header.links = links.length ? links : null;
      return { site: applyBrief(normalizeSite(site), brief) };
    },

    // Returns { site, summary, changed }
    async editSite({ site, instruction, selectedId, pageId, media = [], onProgress }) {
      if (provider.editSite) return provider.editSite({ site, instruction });
      const selected = selectedId ? findNode(site, selectedId) : null;
      const page = site.pages.find((p) => p.id === pageId) || site.pages[0];
      const text = await provider.complete({
        kind: "edit",
        system: EDIT_SYSTEM,
        prompt: editPrompt({
          site,
          instruction,
          selected: selected && (selected.kind === "section" || selected.kind === "block") ? selected : null,
          page,
          media,
        }),
        model: editModel,
        onProgress,
      });
      const data = parseJson(text);
      const summary = typeof data.summary === "string" ? data.summary : "Done.";
      if (data.noop) return { site, summary, changed: false };

      if (data.node && selected) {
        const next = structuredClone(site);
        const target = findNode(next, selectedId);
        const replacement = target.kind === "section" ? normalizeSection(data.node) : normalizeBlock(data.node);
        if (!replacement) throw new Error("The AI returned an element this builder can't use. Try rephrasing.");
        replacement.id = selectedId;
        target.parent[target.index] = replacement;
        return { site: normalizeSite(next), summary, changed: true };
      }
      if (Array.isArray(data.changes)) {
        const result = applyChanges(site, data.changes);
        if (!result.applied && data.changes.length) throw new Error("The AI's change didn't fit this site. Please try again, or rephrase it.");
        if (result.failed.length) console.warn("Some AI changes were skipped:", result.failed.join("; "));
        return { site: result.site, summary, changed: result.applied > 0 };
      }
      if (data.site) return { site: normalizeSite(data.site), summary, changed: true };
      throw new Error("The AI's answer wasn't in the expected format. Please try again.");
    },
  };
}

// Wraps a job's progress callback so the browser gets a preview of the design
// so far (finished sections only), at most about once a second, never the raw text.
function previewProgress(onProgress, build) {
  let last = 0, lastCount = -1;
  return ({ chars, text }) => {
    const now = Date.now();
    if (!onProgress) return;
    if (text === undefined || now - last < 900) return onProgress({ chars });
    last = now;
    const part = partialDesign(text);
    if (part.sections.length === lastCount) return onProgress({ chars });
    lastCount = part.sections.length;
    try { onProgress({ chars, preview: build(part) }); } catch { onProgress({ chars }); }
  };
}

// Things the owner stated outright always win over the AI's choices.
export function applyBrief(site, brief = {}) {
  if (brief.name) { site.name = brief.name; if (!site.header.logoImage) site.header.logoText = brief.name; }
  if (brief.colors?.primary) site.theme.colors.primary = brief.colors.primary;
  if (brief.colors?.accent) site.theme.colors.accent = brief.colors.accent;
  if (brief.logoUrl) site.header.logoImage = brief.logoUrl;
  // Contact details from the brief, for Google and the phone contact button.
  // (The AI's business type and photo keywords are kept.)
  site.business = { ...site.business };
  for (const k of ["phone", "email", "address", "hours", "socials"]) if (brief[k]) site.business[k] = brief[k];
  return normalizeSite(site);
}

// Pulls the JSON object out of a model response, tolerating stray prose or
// markdown fences around it.
export function parseJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("The AI didn't return a site. Please try again.");
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new Error("The AI returned invalid JSON. Please try again.");
  }
}
