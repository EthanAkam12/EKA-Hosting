import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSite, createEmptySite, createPage, createSection, createBlock } from "../shared/schema.js";
import { renderPage } from "../shared/render.js";

function site(extra = {}) {
  const s = createEmptySite("Bob's Plumbing");
  const pages = ["Services", "Boilers", "Bathrooms", "Contact"].map((t) => createPage(t));
  pages[1].menuParent = "services";
  pages[2].menuParent = "services";
  s.pages.push(...pages);
  s.pages[0].sections = [createSection({ background: "dark", padding: "xl" }, [[createBlock("heading", { text: "Hi", level: 1 })]])];
  Object.assign(s.header, extra.header || {});
  if (extra.announce) s.announce = extra.announce;
  if (extra.links) s.header.links = extra.links;
  return normalizeSite(s);
}
const nav = (html) => html.match(/<nav class="eka-nav"[^]*?<\/nav>/)[0];

test("drop-down menus from pages, and from a hand-made menu", () => {
  const s = site();
  const html = renderPage(s, s.pages[2]);
  assert.match(nav(html), /<div class="eka-dd on"><a href="\/services\/">Services<svg class="eka-caret"[^]*<\/a><div class="eka-dd-menu"><a href="\/boilers\/" aria-current="page">Boilers<\/a><a href="\/bathrooms\/">Bathrooms<\/a><\/div><\/div><a href="\/contact\/">Contact<\/a>/);
  const manual = site({ links: [{ text: "Home", href: "/" }, { text: "Services", href: "/services" }, { text: "Boilers", href: "/boilers", sub: true }, { text: "Contact", href: "/contact" }] });
  assert.match(nav(renderPage(manual, manual.pages[0])), /Services<svg[^]*<div class="eka-dd-menu"><a href="\/boilers\/">Boilers<\/a><\/div><\/div><a href="\/contact\/">/);
  assert.equal(normalizeSite({ header: { links: [{ text: "A", href: "/", sub: true }] } }).header.links[0].sub, undefined, "the first item can't be a sub-item");
});

test("header layouts, the see-through header, and the announcement bar", () => {
  const split = site({ header: { layout: "split" } });
  assert.match(renderPage(split, split.pages[0]), /<header class="eka-header sticky hl-split"/);
  assert.match(nav(renderPage(split, split.pages[0])), /<div class="eka-nav-half l">[^]*<\/div><a class="eka-logo eka-logo-mid"[^]*<div class="eka-nav-half r">/);
  const over = site({ header: { overlay: true } });
  const html = renderPage(over, over.pages[0]);
  assert.match(html, /<header class="eka-header sticky over"/);
  assert.match(html, /@supports \(animation-timeline:scroll\(\)\)/);
  const ann = site({ announce: { show: true, text: "Free call-outs this week", linkText: "Book", href: "/contact", style: "accent" } });
  assert.match(renderPage(ann, ann.pages[0]), /<header class="eka-header sticky has-ann"><div class="eka-ann an-accent"><input type="checkbox" id="eka-ann-x"[^]*Free call-outs this week <a href="\/contact\/">Book →<\/a><\/p><\/div><div class="eka-wrap eka-header-in">/);
  assert.doesNotMatch(renderPage(site(), site().pages[0]), /class="eka-ann /, "off by default");
});
