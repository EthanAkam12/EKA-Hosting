import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSite, createEmptySite, createSection, createBlock } from "../shared/schema.js";
import { renderPage } from "../shared/render.js";

const page = (sections, extra = {}) => {
  const s = createEmptySite("Studio");
  Object.assign(s, extra);
  s.pages[0].sections = sections;
  const site = normalizeSite(s);
  return renderPage(site, site.pages[0]);
};

test("image crop, zoom, focus point, shapes, filters and frames", () => {
  const html = page([createSection({}, [[createBlock("image", { src: "/_m/x/a-o.webp", alt: "a", ratio: "3:2", focusX: 30, focusY: 70, zoom: 150, mask: "arch", filter: "bw", frame: "polaroid" })]])]);
  assert.match(html, /<figure class="eka-img r-3-2 rounded m-arch f-bw fr-polaroid"><div class="eka-img-in"><img style="object-position:30% 70%;transform-origin:30% 70%;transform:scale\(1\.5\)" src="\/_m\/x\/a-o\.webp"/);
  // A shape on an uncropped picture crops it square.
  assert.match(page([createSection({}, [[createBlock("image", { src: "/_m/x/a-o.webp", mask: "circle" })]])]), /class="eka-img r-1-1 rounded m-circle"/);
  // Untouched pictures stay as they were.
  assert.match(page([createSection({}, [[createBlock("image", { src: "/_m/x/a-o.webp" })]])]), /<div class="eka-img-in"><img src=/);
});

test("column widths, reversed order on phones, and text size per device", () => {
  const sec = createSection({ layout: "1-1" }, [[createBlock("image")], [createBlock("heading", { text: "Hi" })]]);
  sec.style = { col1: 40, mobileReverse: true };
  const h = sec.columns[1].blocks[0];
  h.style = { fontSize: 64, fontSizeT: 48, fontSizeM: 32 };
  const html = page([sec]);
  assert.match(html, /@media \(min-width:761px\)\{\.x-[\w-]+\.x-[\w-]+>\.eka-wrap>\.eka-cols\{grid-template-columns:40fr 60fr\}\}/);
  assert.match(html, /@media \(max-width:760px\)\{\.x-[\w-]+\.x-[\w-]+>\.eka-wrap>\.eka-cols\{display:flex;flex-direction:column-reverse\}\}/);
  assert.match(html, /@media \(max-width:1000px\)\{[^}]*\{font-size:48px\}\}/);
  assert.match(html, /@media \(max-width:760px\)\{[^}]*\{font-size:32px\}\}/);
});

test("pop-ups: on live pages only, with a newsletter signup if asked", () => {
  const sections = [createSection({}, [[createBlock("newsletter")]])];
  const popup = { show: true, title: "10% off", text: "Join the list", newsletter: true, trigger: "exit", days: 14 };
  const html = page(sections, { popup });
  assert.match(html, /<dialog class="eka-pop" id="eka-pop" aria-label="10% off">[^]*<h2>10% off<\/h2><p>Join the list<\/p><form method="post"[^>]*class="pop-form"><input type="hidden" name="_block"/);
  assert.match(html, /document\.addEventListener\("mouseout",ex\)/);
  assert.match(html, /days=14/);
  const s = createEmptySite("x");
  s.popup = popup;
  const site = normalizeSite(s);
  assert.doesNotMatch(renderPage(site, site.pages[0], { editor: true }), /eka-pop"/, "not in the editor");
  assert.doesNotMatch(page(sections, { popup: { ...popup, show: false } }), /<dialog/);
});
