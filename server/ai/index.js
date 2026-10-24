// AI layer. Picks a provider from the environment and turns its text output
// into validated site documents.
//
// To add another AI provider, write a module that exports
//   { name, model, complete({ system, prompt, model, effort, onProgress }) → Promise<string> }
// and register it in pickProvider() below. Everything else is shared.

import { normalizeSite, normalizeSection, normalizeBlock, findNode } from "../../shared/schema.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createDemoProvider } from "./demo.js";
import { GENERATE_SYSTEM, EDIT_SYSTEM, generatePrompt, editPrompt } from "./prompts.js";

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
