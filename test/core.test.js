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
    pages: [{ title: "Home", sections: [{ props: { layout: "1-1", padding: "huge" }, columns: [{ blocks: [{ type: "heading", props: { text: "Hi", level: 9 } }, { type: "blink-tag" }] }] }] }],
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
  assert.doesNotMatch(html, /<script(?! type="application\/ld\+json")/); // business details for Google are data, not code
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

test("wizard: built-in templates give different designs and use the brief", async () => {
  const { createDemoProvider } = await import("../server/ai/demo.js");
  const ai = createAi({ provider: createDemoProvider() });
  const brief = { name: "Smith Antiques", phone: "01904 123456", email: "hi@smith.test", colors: { primary: "#123456", accent: "#abcdef" }, logoUrl: "/_tmp/logo-o.webp", pages: ["About", "Gallery", "Contact"] };
  const a = await ai.generateConcept({ brief, previous: [] });
  const b2 = await ai.generateConcept({ brief, previous: [a.layout] });
  assert.notEqual(a.layout, b2.layout, "generate another gives a different layout");
  assert.equal(a.site.theme.colors.primary, "#123456");
  assert.equal(a.site.header.logoImage, "/_tmp/logo-o.webp");
  assert.equal(a.site.pages.length, 1, "concept is the home page only");
  assert.match(JSON.stringify(a.site), /tel:01904123456/);
  assert.deepEqual(a.site.header.links.map((l) => l.text), ["Home", "About", "Gallery", "Contact"]);
  const { site } = await ai.buildFromConcept({ brief, concept: a.site });
  assert.deepEqual(site.pages.map((p) => p.slug), ["index", "about", "gallery", "contact"]);
  assert.deepEqual(site.pages[0], a.site.pages[0], "the approved home page is kept exactly");
});

test("wizard: AI concept, refine and build keep the approved home page", async () => {
  const calls = [];
  const provider = {
    name: "claude", model: "claude-opus-5-5",
    complete: async (args) => {
      // Prompts can come in parts; the first, shared part is cached.
      args = { ...args, parts: args.prompt, prompt: typeof args.prompt === "string" ? args.prompt : args.prompt.map((p) => p.text).join("\n") };
      calls.push(args);
      if (args.prompt.startsWith("Design a home page concept")) {
        return JSON.stringify({ name: "x", theme: { colors: { primary: "#000000" } }, pages: [{ title: "Home", slug: "index", sections: [{ type: "section", props: {}, columns: [{ blocks: [{ type: "heading", props: { text: "Hello" } }] }] }] }] });
      }
      if (args.prompt.startsWith("CURRENT SITE JSON")) return JSON.stringify({ summary: "Darker.", noop: true });
      return JSON.stringify({ pages: [{ title: "Gallery", slug: "gallery", sections: [] }, { title: "Home", slug: "index", sections: [] }], headerLinks: [{ text: "Home", href: "/" }, { text: "Gallery", href: "/gallery" }] });
    },
  };
  const ai = createAi({ provider });
  const brief = { name: "Smith", colors: { primary: "#112233", accent: "" } };
  const c = await ai.generateConcept({ brief, previous: ["fonts system/system; sections: dark/1:heading"], images: [{ mediaType: "image/webp", data: "AAAA" }] });
  assert.equal(c.site.theme.colors.primary, "#112233", "owner's colours win");
  assert.equal(c.site.name, "Smith");
  assert.match(calls[0].prompt, /CLEARLY different/);
  assert.equal(calls[0].parts[0].cache, true, "the brief is cached for the next design");
  assert.doesNotMatch(calls[0].parts[0].text, /CLEARLY different/, "the varying part comes after the cached part");
  assert.equal(calls[0].images.length, 1, "logo is shown to the AI");
  const r = await ai.refineConcept({ concept: c.site, instruction: "darker" });
  assert.equal(r.changed, false);
  assert.equal(calls[1].model, "claude-sonnet-5-5", "changes use the cheaper model");
  const { site } = await ai.buildFromConcept({ brief, concept: c.site, requests: ["add a page called Gallery"] });
  assert.deepEqual(site.pages.map((p) => p.slug), ["index", "gallery"], "AI can't replace the home page");
  assert.equal(site.pages[0].sections[0].columns[0].blocks[0].props.text, "Hello");
  assert.match(calls[2].prompt, /add a page called Gallery/);
});

test("placeholder pictures fill empty image spots in the site's colours", async () => {
  const { fillPlaceholders, isPlaceholder } = await import("../server/placeholders.js");
  const os = await import("node:os");
  const fsp = await import("node:fs/promises");
  const dir = await fsp.mkdtemp(`${os.tmpdir()}/eka-ph-`);
  const site = sampleSite();
  site.pages[0].sections.push(createSection({ background: "image" }, [[createBlock("gallery")]]));
  await fillPlaceholders(normalizeSite(site) && site, { dir, urlPrefix: "/_tmp/" });
  const img = site.pages[0].sections[0].columns[1].blocks[0].props.src;
  assert.ok(isPlaceholder(img), img);
  assert.ok(isPlaceholder(site.pages[0].sections[1].props.image));
  assert.equal(site.pages[0].sections[1].columns[0].blocks[0].props.images.length, 6);
  const files = await fsp.readdir(dir);
  assert.ok(files.some((f) => f.endsWith("-o-sm.webp")) || files.some((f) => f.endsWith(".svg")));
  // Editor tags placeholders; the live page doesn't.
  const editorHtml = renderPage(normalizeSite(site), normalizeSite(site).pages[0], { editor: true });
  const liveHtml = renderPage(normalizeSite(site), normalizeSite(site).pages[0], {});
  assert.match(editorHtml, /eka-ph-tag/);
  assert.ok(!liveHtml.includes("eka-ph-tag"));
  await fsp.rm(dir, { recursive: true, force: true });
});
