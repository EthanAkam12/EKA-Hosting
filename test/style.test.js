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

test("header menu links can be styled", () => {
  const site = createEmptySite("x");
  site.header.menu = { font: "oswald", size: 15, transform: "uppercase", hover: "underline", hoverColor: "#f5c542", align: "center", junk: 1 };
  site.header.ctaText = "Call";
  site.header.ctaStyle = "secondary";
  const n = normalizeSite(site);
  assert.deepEqual(Object.keys(n.header.menu).sort(), ["align", "font", "hover", "hoverColor", "size", "transform"]);
  const html = renderPage(n, n.pages[0]);
  assert.match(html, /\.eka-nav a:not\(\.eka-btn\)\{font-family:"Oswald"[^}]*font-size:15px;text-transform:uppercase\}/);
  assert.match(html, /:hover\{color:#f5c542\}/);
  assert.match(html, /::after\{content:""/);
  assert.match(html, /justify-content:center/);
  assert.match(html, /class="eka-btn btn-secondary"/);
  assert.match(html, /family=Oswald/);
});

test("background images: real <img> layer, tint, effects, phone image", () => {
  const site = createEmptySite("x");
  const hero = createSection({ background: "image", image: "/_m/s1/photo-o.webp", overlay: 30 });
  hero.style = { bgPos: "bottom", bgEffect: "zoom", tint: "#112233", tint2: "#c9a227", tintDir: "diagonal", tintOpacity: 70, bgGray: 40, bgImageMobile: "/_m/s1/tall-o.webp" };
  const card = createBlock("card");
  card.style = { bgImage: "/_m/s1/card-o.webp", bgFixed: true };
  const plain = createSection({ background: "image", image: "/_m/s1/photo-o.webp" }, [[card]]);
  site.pages[0].sections = [hero, plain];
  const n = normalizeSite(site);
  const html = renderPage(n, n.pages[0]);
  assert.match(html, /<div class="eka-bgi fx-zoom" aria-hidden="true" style="filter:grayscale\(40%\)"><picture class="eka-bgi-in"><source media="\(max-width:760px\)" srcset="\/_m\/s1\/tall-o-sm\.webp"><img style="object-fit:cover;object-position:bottom"/);
  assert.match(html, /fetchpriority="high"/); // first section's background loads first
  assert.match(html, /background:linear-gradient\(135deg,#112233,#c9a227\);opacity:0\.70/);
  // second section: default black tint from the old "darken" value, lazy image
  assert.match(html, /<div class="eka-tint" aria-hidden="true" style="background:#000000;opacity:0\.45"><\/div>/);
  assert.match(html, /background-image:url\(&quot;\/_m\/s1\/card-o\.webp&quot;\)[^"]*background-attachment:fixed/);
  assert.doesNotMatch(html, /<script/);
});
