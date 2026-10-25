// AI layer. Picks a provider from the environment and turns its text output
// into validated site documents.
//
// To add another AI provider, write a module that exports
//   { name, model, complete({ system, prompt, model, effort, onProgress }) → Promise<string> }
// and register it in pickProvider() below. Everything else is shared.

import { normalizeSite, normalizeSection, normalizeBlock, findNode } from "../../shared/schema.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createDemoProvider } from "./demo.js";
import { GENERATE_SYSTEM, EDIT_SYSTEM, CONCEPT_SYSTEM, BUILD_SYSTEM, generatePrompt, editPrompt, conceptPrompt, buildPrompt, describeLayout } from "./prompts.js";

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
  // Concepts are previews the owner may regenerate several times: keep them quicker.
  const conceptEffort = process.env.AI_CONCEPT_EFFORT || "medium";
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
          system: CONCEPT_SYSTEM,
          prompt: conceptPrompt({ brief: { ...brief, logoAttached: images.length > 0 }, previous }),
          images,
          model: generateModel,
          effort: conceptEffort,
          onProgress,
        });
        const data = parseJson(text);
        site = normalizeSite(data.site && data.pages === undefined ? data.site : data);
      }
      site = applyBrief(site, brief);
      return { site, layout: describeLayout(site) };
    },

    // Applies a written change ("make it darker") to a concept.
    async refineConcept({ concept, instruction, onProgress }) {
      const result = await this.editSite({ site: concept, instruction, onProgress });
      return { ...result, layout: describeLayout(result.site) };
    },

    // Builds the remaining pages in the approved concept's style.
    async buildFromConcept({ brief, concept, requests = [], onProgress }) {
      if (provider.buildFromConcept) {
        return { site: applyBrief(normalizeSite((await provider.buildFromConcept({ brief, concept })).site), brief) };
      }
      const text = await provider.complete({
        system: BUILD_SYSTEM,
        prompt: buildPrompt({ brief, concept, requests }),
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
      if (data.site) return { site: normalizeSite(data.site), summary, changed: true };
      throw new Error("The AI's answer wasn't in the expected format. Please try again.");
    },
  };
}

// Things the owner stated outright always win over the AI's choices.
export function applyBrief(site, brief = {}) {
  if (brief.name) { site.name = brief.name; if (!site.header.logoImage) site.header.logoText = brief.name; }
  if (brief.colors?.primary) site.theme.colors.primary = brief.colors.primary;
  if (brief.colors?.accent) site.theme.colors.accent = brief.colors.accent;
  if (brief.logoUrl) site.header.logoImage = brief.logoUrl;
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
