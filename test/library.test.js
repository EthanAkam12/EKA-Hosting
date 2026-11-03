import { test } from "node:test";
import assert from "node:assert/strict";
import { SECTION_LIBRARY, LIBRARY_CATEGORIES } from "../shared/library.js";
import { normalizeSite, normalizeSection, createEmptySite, createSection, createBlock } from "../shared/schema.js";
import { renderPage } from "../shared/render.js";
import { createAi } from "../server/ai/index.js";
import { sectionPrompt } from "../server/ai/prompts.js";

test("the section library: 100 designs, every category filled, all valid and renderable", () => {
  assert.equal(SECTION_LIBRARY.length, 100);
  assert.equal(new Set(SECTION_LIBRARY.map((e) => e.id)).size, 100, "unique ids");
  for (const [cat] of LIBRARY_CATEGORIES) assert.ok(SECTION_LIBRARY.some((e) => e.cat === cat), cat);
  const site = createEmptySite("Test");
  for (const entry of SECTION_LIBRARY) {
    const sections = [].concat(entry.make());
    for (const sec of sections) assert.ok(normalizeSection(sec), entry.id);
    site.pages[0].sections = sections;
    const s = normalizeSite(site);
    assert.match(renderPage(s, s.pages[0], { editor: true }), /<\/html>$/, entry.id);
  }
  // Fresh ids each time, so the same design can be added twice.
  const a = [].concat(SECTION_LIBRARY[0].make())[0].id, b = [].concat(SECTION_LIBRARY[0].make())[0].id;
  assert.notEqual(a, b);
});

test("Fill with AI / Restyle: one section, same ids, the business described", async () => {
  const site = normalizeSite(createEmptySite("Harbour Café"));
  site.business.phone = "01234 567890";
  const sec = createSection({}, [[createBlock("heading", { text: "Old" })]]);
  site.pages[0].sections = [sec];
  let seen;
  const ai = createAi({ provider: { name: "claude", model: "m", complete: async ({ prompt, kind }) => {
    seen = { prompt, kind };
    return JSON.stringify({ sections: [{ id: "something-else", type: "section", props: { layout: "1", background: "dark" }, columns: [{ blocks: [{ type: "heading", props: { text: "Fresh coffee by the harbour" } }] }] }] });
  } } });
  const { sections } = await ai.reworkSections({ site, sections: [sec], mode: "fill", about: "Café by the sea" });
  assert.equal(sections[0].id, sec.id, "keeps the section's id");
  assert.equal(sections[0].columns[0].blocks[0].props.text, "Fresh coffee by the harbour");
  assert.equal(seen.kind, "fill");
  const text = seen.prompt.map((p) => p.text).join("\n");
  assert.match(text, /THE BUSINESS: Harbour Café/);
  assert.match(text, /Café by the sea/);
  assert.match(text, /phone: 01234 567890/);
  assert.match(text, /FILL these section\(s\)/);
  assert.match(sectionPrompt({ site, sections: [sec], mode: "restyle", wishes: "darker" }).map((p) => p.text).join(""), /RESTYLE these section\(s\)\. The owner says: darker/);
  // A reply with the wrong number of sections is refused.
  const bad = createAi({ provider: { name: "claude", model: "m", complete: async () => JSON.stringify({ sections: [] }) } });
  await assert.rejects(bad.reworkSections({ site, sections: [sec], mode: "fill" }), /didn't fit/);
});

test("shared sections: editing one copy changes every copy, on any page", async () => {
  const { syncSharedSections, createPage, reId } = await import("../shared/schema.js");
  const site = normalizeSite(createEmptySite("S"));
  const cta = createSection({ background: "primary" }, [[createBlock("heading", { text: "Call us today" })]]);
  cta.shared = { id: "sh_abc123", name: "Call to action" };
  const about = createPage("About");
  about.sections = [reId(cta)];
  site.pages[0].sections = [cta];
  site.pages.push(about);
  const before = normalizeSite(site);
  const after = structuredClone(before);
  after.pages[1].sections[0].columns[0].blocks[0].props.text = "Call us now!";
  after.pages[1].sections[0].props.background = "dark";
  const synced = normalizeSite(syncSharedSections(before, after));
  assert.equal(synced.pages[0].sections[0].columns[0].blocks[0].props.text, "Call us now!");
  assert.equal(synced.pages[0].sections[0].props.background, "dark");
  assert.equal(synced.pages[0].sections[0].id, cta.id, "each copy keeps its own id");
  assert.notEqual(synced.pages[0].sections[0].columns[0].blocks[0].id, synced.pages[1].sections[0].columns[0].blocks[0].id, "and its own block ids");
  // A copy that stopped sharing is left alone.
  delete after.pages[0].sections[0].shared;
  after.pages[1].sections[0].columns[0].blocks[0].props.text = "Changed again";
  const apart = normalizeSite(syncSharedSections(normalizeSite(synced), after));
  assert.notEqual(apart.pages[0].sections[0].columns[0].blocks[0].props.text, "Changed again");
});
