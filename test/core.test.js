import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSite, createEmptySite, createBlock, createSection, findNode } from "../shared/schema.js";
import { renderPage } from "../shared/render.js";
import { sanitizeRichText, safeUrl } from "../shared/sanitize.js";
import { createAi, parseJson } from "../server/ai/index.js";

function sampleSite() {
  const site = createEmptySite("Test Co");
  site.pages[0].sections.push(
    createSection({ layout: "1-1" }, [[createBlock("heading", { text: "Hello", level: 1 })], [createBlock("image")]]),
  );
  site.pages.push({ title: "About", slug: "about", sections: [] });
  return normalizeSite(site);
}

test("normalizeSite drops unknown blocks and fixes bad values", () => {
  const site = normalizeSite({
    name: "X",
    theme: { colors: { primary: "red" }, fonts: { heading: "comic-sans" }, radius: 999 },
    pages: [{ title: "Home", sections: [{ props: { layout: "1-1", padding: "huge" }, columns: [{ blocks: [{ type: "heading", props: { text: "Hi", level: 9 } }, { type: "marquee" }] }] }] }],
  });
  const sec = site.pages[0].sections[0];
  assert.equal(site.theme.colors.primary, "#2563eb");
  assert.equal(site.theme.fonts.heading, "system");
  assert.equal(site.theme.radius, 32);
  assert.equal(sec.columns.length, 2, "column count follows layout");
  assert.equal(sec.props.padding, "lg");
  assert.equal(sec.columns[0].blocks.length, 1);
  assert.equal(sec.columns[0].blocks[0].props.level, 2);
  assert.equal(site.pages[0].slug, "index");
});

test("shrinking a layout keeps blocks from removed columns", () => {
  const site = sampleSite();
  site.pages[0].sections[0].props.layout = "1";
  const out = normalizeSite(site);
  assert.equal(out.pages[0].sections[0].columns[0].blocks.length, 2);
});

test("sanitizer strips scripts, handlers and javascript: links", () => {
  const out = sanitizeRichText('<p onclick="x">a<script>bad()</script><a href="javascript:alert(1)">b</a><a href="/about">c</a><img src=x onerror=1></p>');
  assert.ok(!/script|onclick|onerror|javascript|<img/i.test(out), out);
  assert.match(out, /href="\/about"/);
  assert.equal(safeUrl("JaVa\tScript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,x"), "");
  assert.equal(safeUrl("https://ok.com"), "https://ok.com");
});

test("published pages have no JavaScript and link pages under the base path", () => {
  const site = sampleSite();
  const html = renderPage(site, site.pages[0], { base: "/s/test/" });
  assert.ok(!html.includes("<script"));
  assert.match(html, /href="\/s\/test\/about\/"/);
  assert.ok(!html.includes("data-eka-id"), "no editor attributes on live pages");
  // The image column is empty, so the live page collapses to one column.
  assert.match(html, /eka-cols l-1"/);
});

test("editor rendering keeps empty columns and adds selection hooks", () => {
  const site = sampleSite();
  const html = renderPage(site, site.pages[0], { editor: true });
  assert.match(html, /data-eka-kind="block"/);
  assert.match(html, /eka-cols l-1-1"/);
});

test("parseJson tolerates fences and prose", () => {
  assert.deepEqual(parseJson('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseJson("no json here"));
});

function fakeProvider(reply) {
  const calls = [];
  return { calls, provider: { name: "fake", model: "fake", complete: async (args) => { calls.push(args); return typeof reply === "function" ? reply(args) : reply; } } };
}

test("AI generate returns a normalized site", async () => {
  const { provider } = fakeProvider(JSON.stringify({ name: "Ignored", pages: [{ title: "Home", sections: [{ type: "section", props: { layout: "1" }, columns: [{ blocks: [{ type: "heading", props: { text: "Welcome" } }] }] }] }] }));
  const ai = createAi({ provider });
  const { site } = await ai.generateSite({ name: "Acme Plumbing", prompt: "plumbers" });
  assert.equal(site.name, "Acme Plumbing");
  assert.equal(site.pages[0].sections[0].columns[0].blocks[0].props.text, "Welcome");
});

test("AI edit can replace just the selected block", async () => {
  const site = sampleSite();
  const heading = site.pages[0].sections[0].columns[0].blocks[0];
  const { provider, calls } = fakeProvider(JSON.stringify({ summary: "Made it punchier.", node: { type: "heading", props: { text: "Hello, world!", level: 1 } } }));
  const ai = createAi({ provider });
  const res = await ai.editSite({ site, instruction: "punchier", selectedId: heading.id });
  assert.equal(res.changed, true);
  assert.equal(findNode(res.site, heading.id).node.props.text, "Hello, world!");
  assert.match(calls[0].prompt, /SELECTED ELEMENT/);
});

test("AI edit with a full site and a no-op", async () => {
  const site = sampleSite();
  const next = structuredClone(site);
  next.theme.colors.primary = "#16a34a";
  let ai = createAi({ provider: fakeProvider(JSON.stringify({ summary: "Green now.", site: next })).provider });
  let res = await ai.editSite({ site, instruction: "make it green" });
  assert.equal(res.site.theme.colors.primary, "#16a34a");
  ai = createAi({ provider: fakeProvider('{"summary":"Can\'t do that.","noop":true}').provider });
  res = await ai.editSite({ site, instruction: "add a shop" });
  assert.equal(res.changed, false);
});

test("new sites and changes can use different models", async () => {
  const site = sampleSite();
  const { provider, calls } = fakeProvider((args) => args.prompt.startsWith("CURRENT SITE JSON")
    ? JSON.stringify({ summary: "ok", noop: true })
    : JSON.stringify({ pages: [{ title: "Home", sections: [] }] }));
  provider.name = "claude";
  provider.model = "claude-opus-5-5";
  const ai = createAi({ provider });
  await ai.generateSite({ name: "A", prompt: "b" });
  await ai.editSite({ site, instruction: "c" });
  assert.equal(calls[0].model, "claude-opus-5-5");
  assert.equal(calls[1].model, "claude-sonnet-5-5");
});

test("static export rewrites images and adds a contact form handler", async () => {
  const { buildStaticSite } = await import("../server/export.js");
  const site = sampleSite();
  site.pages[0].sections[0].columns[1].blocks[0].props.src = "/_m/abc123def456/photo-o.webp";
  site.pages[0].sections.push(createSection({}, [[createBlock("form")]]));
  const files = await buildStaticSite({ site: normalizeSite(site), siteId: "abc123def456", mediaDir: "/nonexistent", formEmail: "owner@example.com", domain: "example.com" });
  const byPath = Object.fromEntries(files.map((f) => [f.path, f.content.toString()]));
  assert.ok(byPath["index.html"] && byPath["about/index.html"]);
  assert.match(byPath["index.html"], /src="\/media\/photo-o\.webp"/);
  assert.ok(!byPath["index.html"].includes("/_m/"), "no builder URLs left");
  assert.match(byPath["index.html"], /action="\/contact\.php"/);
  assert.match(byPath["index.html"], /rel="canonical" href="https:\/\/example\.com\/"/);
  assert.ok(byPath["contact.php"].startsWith("<?php"));
  // The recipient is baked in (base64 JSON), never read from the form.
  assert.ok(byPath["contact.php"].includes(Buffer.from(JSON.stringify("owner@example.com")).toString("base64")));
  assert.ok(byPath[".htaccess"] && byPath["404.html"]);
});
