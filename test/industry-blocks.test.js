import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSite, createEmptySite, createSection, createBlock, FORM_PRESETS } from "../shared/schema.js";
import { renderPage } from "../shared/render.js";
import { visitorEmail } from "../server/form-mail.js";

const page = (blocks, extra = {}) => {
  const s = createEmptySite("Harbour Café");
  Object.assign(s, extra);
  s.pages[0].sections = [createSection({}, [blocks])];
  const site = normalizeSite(s);
  return { site, html: renderPage(site, site.pages[0]) };
};

test("menu groups items under headings, with prices and labels", () => {
  const { html } = page([createBlock("menu")]);
  assert.match(html, /<h3>Starters<\/h3><ul><li><div class="eka-menu-row"><span class="eka-menu-name">Soup of the day<span class="eka-menu-tags"><abbr>V<\/abbr>/);
  assert.match(html, /<span class="eka-menu-price">£15\.50<\/span>/);
  assert.equal((html.match(/<h3>Mains<\/h3>/g) || []).length, 1);
});

test("opening hours come from the business details, split into days and times", () => {
  const { html } = page([createBlock("hours")], { business: { hours: "Mon–Fri 9am–5pm\nSaturday: 10am – 4pm\nSunday closed" } });
  assert.match(html, /<th scope="row">Mon–Fri<\/th><td>9am–5pm<\/td>/);
  assert.match(html, /<th scope="row">Saturday<\/th><td>10am – 4pm<\/td>/);
  assert.match(html, /<th scope="row">Sunday<\/th><td>closed<\/td>/);
});

test("team, timeline, before/after", () => {
  const { html } = page([
    createBlock("team", { items: [{ name: "Ana", role: "Chef", bio: "Loves bread", image: "/_m/x/a-o.webp" }] }),
    createBlock("timeline"),
    createBlock("beforeafter", { before: "/_m/x/b-o.webp", after: "/_m/x/c-o.webp", alt: "kitchen" }),
  ]);
  assert.match(html, /<h3>Ana<\/h3><p class="eka-person-role">Chef<\/p>/);
  assert.match(html, /<ol class="eka-timeline"><li><span class="eka-tl-date">2012<\/span>/);
  assert.match(html, /<input type="range" min="0" max="100" value="50"[^>]*oninput=/);
  assert.match(html, /alt="Before: kitchen"/);
});

test("offers disappear after their end date and count down before it", () => {
  const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const { html } = page([createBlock("offer", { ends: soon })]);
  assert.match(html, /<h2>20% off all bookings this month<\/h2>/);
  assert.match(html, /data-end="[\d-]+T23:59:59"/);
  const past = page([createBlock("offer", { ends: "2020-01-01" })]).html;
  assert.doesNotMatch(past, /20% off/);
  const editor = renderPage(normalizeSite(page([createBlock("offer", { ends: "2020-01-01" })]).site), page([createBlock("offer", { ends: "2020-01-01" })]).site.pages[0], { editor: true });
  assert.match(editor, /20% off/, "still editable in the editor");
});

test("newsletter sign-ups post to the builder, or straight to Mailchimp", () => {
  const own = page([createBlock("newsletter")]).html;
  assert.match(own, /<input type="email" name="field_0" required/);
  assert.match(own, /name="_block"/);
  const mc = page([createBlock("newsletter", { mailchimp: "https://acme.us1.list-manage.com/subscribe/post?u=1&amp;id=2" })]).html;
  assert.match(mc, /action="https:\/\/acme\.us1\.list-manage\.com\/subscribe\/post\?/);
  assert.match(mc, /name="EMAIL"/);
  const bad = page([createBlock("newsletter", { mailchimp: "https://evil.example/collect" })]).html;
  assert.doesNotMatch(bad, /evil\.example/);
});

test("booking deposits: a pay button after sending, and the link in the visitor's email", () => {
  const { html } = page([createBlock("form", { ...FORM_PRESETS.booking(), depositLink: "https://buy.stripe.com/dep", depositText: "Pay £20 deposit" })]);
  assert.match(html, /class="eka-form-ok" role="status">[^<]*<a class="eka-btn btn-primary eka-deposit" href="https:\/\/buy\.stripe\.com\/dep"[^>]*>Pay £20 deposit<\/a>/);
  assert.match(visitorEmail({ kind: "booking", siteName: "S", lines: [], deposit: { link: "https://buy.stripe.com/dep", text: "Pay £20 deposit" } }).body, /Pay £20 deposit: https:\/\/buy\.stripe\.com\/dep/);
});
