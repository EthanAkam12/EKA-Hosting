import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmptySite, createSection, createBlock, normalizeSite, normalizeStyle } from "../shared/schema.js";
import { renderPage } from "../shared/render.js";
import { buildPrompt, formatBrief } from "../server/ai/prompts.js";
import { createDemoProvider } from "../server/ai/demo.js";

test("normalizeStyle keeps only valid, set values", () => {
  assert.equal(normalizeStyle({}), undefined);
  assert.equal(normalizeStyle({ radius: "", bg: "red", hide: { m: false } }), undefined);
  const st = normalizeStyle({ margin: { d: { t: "12", x: 4 }, m: { b: 9999 } }, radius: 6, bg: "#abcdef", hover: "grow", animation: "nope", hide: { t: true } });
  assert.deepEqual(st, { margin: { d: { t: 12 }, m: { b: 600 } }, radius: 6, bg: "#abcdef", hover: "grow", hide: { t: true } });
});

test("theme gets button, text and layout defaults", () => {
  const t = createEmptySite("x").theme;
  assert.equal(t.buttons.hover, "lift");
  assert.equal(t.type.base, 17);
  assert.equal(t.layout.width, 1140);
  assert.equal(normalizeSite({ theme: { buttons: { shape: "blob" }, layout: { width: 99999 } } }).theme.layout.width, 1600);
});

test("element styles render as per-page CSS, desktop before mobile, with no scripts", () => {
  const site = createEmptySite("x");
  const block = createBlock("buttons", { items: [{ text: "Call", href: "tel:1", style: "primary", icon: "phone" }] });
  block.style = { margin: { d: { t: 30 }, m: { t: 5 } }, hover: "pulse", hide: { m: true } };
  const hero = createSection({}, [[block]]);
  const second = createSection({}, [[createBlock("text")]]);
  site.pages[0].sections = [hero, second];
  site.theme.layout.motion = "fade-up";
  const n = normalizeSite(site);
  const html = renderPage(n, n.pages[0]);
  const css = html.match(/<style id="eka-node-css">([\s\S]*?)<\/style>/)[1];
  const sel = `.x-${block.id}.x-${block.id}`;
  assert.ok(css.indexOf(`${sel}{`) < css.indexOf(`@media (max-width:760px){${sel}{margin-top:5px}`));
  assert.match(css, /eka-pulse/);
  assert.match(css, /display:none!important/);
  assert.match(html, /<svg class="bi-phone"/);
  assert.match(html, /class="eka-s[^"]*an an-load/); // first section plays on load
  assert.match(html, /class="eka-s[^"]*an an-scroll/); // later ones as they scroll in
  assert.doesNotMatch(html, /<script/);
});

test("page descriptions and per-page changes reach the AI and the templates", async () => {
  const brief = { name: "Harbour", pages: ["About", "Gallery"], pageInfo: { Home: "Free local delivery.", About: "Run by Margaret since 1987." } };
  assert.match(formatBrief(brief), /- About: Run by Margaret since 1987\./);
  assert.match(buildPrompt({ brief, concept: {}, pageNotes: { Gallery: "Nine photos", Home: "x" } }), /- Gallery page: Nine photos/);
  const demo = createDemoProvider();
  const { site: concept } = await demo.generateConcept({ brief });
  assert.match(JSON.stringify(concept.pages[0].sections[0]), /Free local delivery/);
  const { site } = await demo.buildFromConcept({ brief, concept: normalizeSite(concept) });
  assert.match(JSON.stringify(site.pages.find((p) => p.slug === "about")), /Margaret/);
});

test("a font picked for one element only loads on the page that uses it", async () => {
  const { fontsHref } = await import("../shared/render.js");
  const site = createEmptySite("x");
  const heading = createBlock("heading");
  heading.style = { fontFamily: "pacifico", textTransform: "uppercase" };
  site.pages[0].sections = [createSection({}, [[heading]])];
  site.pages.push({ title: "About", slug: "about", sections: [] });
  site.header.style = { bg: "#112233", color: "#ffffff" };
  const n = normalizeSite(site);
  assert.match(fontsHref(n, n.pages[0]), /Pacifico/);
  assert.equal(fontsHref(n, n.pages[1]), "");
  const html = renderPage(n, n.pages[0]);
  assert.match(html, /font-family:"Pacifico", cursive/);
  assert.match(html, /class="eka-header sticky x-header"/);
  assert.match(html, /\.x-header\.x-header\{background-color:#112233;color:#ffffff\}/);
});
