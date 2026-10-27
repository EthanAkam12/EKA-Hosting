import { test } from "node:test";
import assert from "node:assert/strict";
import { partialDesign } from "../server/ai/partial.js";

test("finished sections are read from a half-written design", () => {
  const full = JSON.stringify({
    name: "x",
    theme: { colors: { primary: "#123456" } },
    header: { logoText: "Shop {not a brace}" },
    pages: [{ title: "Home", slug: "index", sections: [
      { type: "section", props: { background: "dark" }, columns: [{ blocks: [{ type: "heading", props: { text: "Say \"hi\" } ] {" } }] }] },
      { type: "section", props: { background: "surface" }, columns: [{ blocks: [] }] },
      { type: "section", props: { background: "default" }, columns: [{ blocks: [] }] },
    ] }],
  });
  assert.deepEqual(partialDesign(full.slice(0, 20)), { theme: undefined, header: undefined, footer: undefined, sections: [] });
  const cut = full.indexOf('{"type":"section","props":{"background":"default"');
  const part = partialDesign(full.slice(0, cut + 30));
  assert.equal(part.theme.colors.primary, "#123456");
  assert.equal(part.header.logoText, "Shop {not a brace}", "braces inside text don't confuse it");
  assert.deepEqual(part.sections.map((s) => s.props.background), ["dark", "surface"], "only finished sections");
  assert.equal(part.sections[0].columns[0].blocks[0].props.text, 'Say "hi" } ] {');
  assert.equal(partialDesign(full).sections.length, 3);
  // Answers wrapped in a code fence or with prose first still work.
  assert.equal(partialDesign("Here you go:\n```json\n" + full).sections.length, 3);
});
