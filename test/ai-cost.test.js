import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEmptySite, createSection, createBlock, normalizeSite } from "../shared/schema.js";
import { applyChanges } from "../server/ai/changes.js";
import { createAi } from "../server/ai/index.js";
import { estimateCost, initUsageLog, recordUsage, usageContext, usageSummary } from "../server/ai/usage.js";

function site() {
  const s = createEmptySite("Shop");
  const h = createBlock("heading", { text: "Hello" });
  const sec = createSection({}, [[h]]);
  s.pages[0].sections = [sec, createSection({ background: "surface" })];
  s.pages.push({ title: "About", slug: "about", sections: [] });
  return normalizeSite(s);
}

test("edits come back as small changes and are applied to the site", () => {
  const s = site();
  const [first, second] = s.pages[0].sections;
  const heading = first.columns[0].blocks[0];
  const { site: out, applied, failed } = applyChanges(s, [
    { op: "theme", theme: { colors: { primary: "#123456" } } },
    { op: "header", header: { ctaText: "Call us" } },
    { op: "replace", id: heading.id, node: { type: "heading", props: { text: "Welcome", level: 1 } } },
    { op: "insert", page: "index", after: first.id, section: { type: "section", props: { background: "dark" }, columns: [{ blocks: [] }] } },
    { op: "move", id: second.id, after: null },
    { op: "page", page: { title: "Gallery", slug: "gallery", sections: [] } },
    { op: "removePage", slug: "about" },
    { op: "remove", id: "nope" },
  ]);
  assert.equal(applied, 7);
  assert.deepEqual(failed, ["nope not found"]);
  assert.equal(out.theme.colors.primary, "#123456");
  assert.equal(out.theme.colors.accent, s.theme.colors.accent, "other colours untouched");
  assert.equal(out.header.ctaText, "Call us");
  assert.deepEqual(out.pages[0].sections.map((x) => x.props.background), ["surface", "default", "dark"]);
  const h = out.pages[0].sections[1].columns[0].blocks[0];
  assert.equal(h.id, heading.id, "replaced block keeps its id");
  assert.equal(h.props.text, "Welcome");
  assert.deepEqual(out.pages.map((p) => p.slug), ["index", "gallery"]);
  assert.equal(s.theme.colors.primary !== "#123456", true, "the original isn't changed");
});

test("editSite uses the change list and reports a change that doesn't fit", async () => {
  let answer;
  const ai = createAi({ provider: { name: "claude", model: "claude-opus-5-5", complete: async (args) => { assert.equal(args.kind, "edit"); return JSON.stringify(answer); } } });
  answer = { summary: "Darker header.", changes: [{ op: "header", header: { sticky: false } }] };
  const r = await ai.editSite({ site: site(), instruction: "x" });
  assert.equal(r.changed, true);
  assert.equal(r.site.header.sticky, false);
  answer = { summary: "?", changes: [{ op: "remove", id: "missing" }] };
  await assert.rejects(ai.editSite({ site: site(), instruction: "x" }), /didn't fit/);
});

test("AI usage is logged with the website and an estimated cost", async () => {
  // Opus 5.5: $4 in, $20 out, $0.20 cache reads, writes 1.25x input.
  assert.equal(estimateCost("claude-opus-5-5", { input_tokens: 1e6 }), 4);
  assert.equal(estimateCost("claude-opus-5-5", { cache_read_input_tokens: 1e6, output_tokens: 1e6 }), 20.2);
  assert.equal(estimateCost("claude-sonnet-5-5", { cache_creation_input_tokens: 1e6 }), 2.5);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eka-usage-"));
  initUsageLog(dir);
  await usageContext.run({ siteId: "s1", user: { role: "admin" } }, () => recordUsage({ kind: "edit", model: "claude-sonnet-5-5", usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 3000 } }));
  await recordUsage({ kind: "concept", model: "claude-opus-5-5", usage: { input_tokens: 2000, output_tokens: 8000 } });
  const { total, byKind, bySite } = await usageSummary();
  assert.equal(total.calls, 2);
  assert.equal(byKind.edit.calls, 1);
  assert.ok(bySite.s1.cost > 0);
  assert.equal(Math.round(total.cost * 1e4) / 1e4, Math.round((estimateCost("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 3000 }) + estimateCost("claude-opus-5-5", { input_tokens: 2000, output_tokens: 8000 })) * 1e4) / 1e4);
  await fs.rm(dir, { recursive: true });
});
