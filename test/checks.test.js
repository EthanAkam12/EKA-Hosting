import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmptySite, createSection, createBlock, normalizeSite } from "../shared/schema.js";
import { checkSite, contrast } from "../shared/checks.js";

test("contrast follows the WCAG formula", () => {
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
  assert.equal(contrast("#777777", "#777777"), 1);
  assert.ok(contrast("#767676", "#ffffff") >= 4.5);
});

test("the checklist finds what visitors would notice", () => {
  const site = createEmptySite("Shop");
  const hero = createSection({ background: "image", image: "/_m/s/placeholder-wide-0-abc-o.webp", anchor: "top" }, [[
    createBlock("heading"), // template text
    createBlock("buttons", { items: [{ text: "Visit", href: "/gallery", style: "primary" }, { text: "Contact", href: "#contact", style: "primary" }, { text: "Empty", href: "", style: "primary" }] }),
  ]]);
  const pale = createSection({}, [[createBlock("text", { html: "<p>Real words</p>" }), createBlock("image", { src: "/_m/s/shop-o.webp", alt: "" }), createBlock("form")]]);
  pale.style = { color: "#dddddd" }; // pale grey on white
  site.pages[0].sections = [hero, pale];
  site.pages.push({ title: "About", slug: "about", sections: [] });
  const n = normalizeSite(site);
  const issues = checkSite(n, { ownHosting: true });
  const has = (kind, re) => issues.some((i) => i.kind === kind && re.test(i.text));
  assert.ok(has("placeholder", /1 placeholder picture/));
  assert.ok(has("template", /Your heading here/));
  assert.ok(has("link", /"Visit" button links to a page that doesn't exist/));
  assert.ok(has("link", /"Contact" button links to #contact, which isn't on this page/));
  assert.ok(has("link", /"Empty" button doesn't link anywhere/));
  assert.ok(has("contrast", /hard to read/));
  assert.ok(has("alt", /no description/));
  assert.ok(has("form", /no email/));
  assert.ok(issues.some((i) => i.kind === "empty" && i.page === "About"));
  const placeholder = issues.find((i) => i.kind === "placeholder");
  assert.equal(placeholder.nodeId, n.pages[0].sections[0].id, "Show jumps to the section with the placeholder");
  assert.ok(!checkSite(n, { ownHosting: true, formEmail: "a@b.c" }).some((i) => i.kind === "form"));
});

test("a finished site has no fixes", () => {
  const site = createEmptySite("Shop");
  site.pages[0].sections = [createSection({ background: "dark", anchor: "contact" }, [[createBlock("heading", { text: "Fine clocks" }), createBlock("buttons", { items: [{ text: "Call", href: "tel:123", style: "primary" }, { text: "Here", href: "/#contact", style: "primary" }] })]])];
  assert.deepEqual(checkSite(normalizeSite(site)).filter((i) => i.level === "fix"), []);
});
