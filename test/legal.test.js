import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSite, createEmptySite, createSection, createBlock, FORM_PRESETS } from "../shared/schema.js";
import { renderPage } from "../shared/render.js";
import { ensurePrivacyPage, siteFacts } from "../shared/legal.js";
import { checkSite } from "../shared/checks.js";
import { formatBrief, editPrompt } from "../server/ai/prompts.js";

function site(blocks, extra = {}) {
  const s = createEmptySite("Rose Bakery");
  s.business = { email: "hello@rose.test", address: "1 High St, York" };
  s.pages[0].sections = [createSection({}, [blocks])];
  return normalizeSite({ ...s, ...extra });
}
const noScript = (html) => !/<script(?! type="application\/ld\+json")/.test(html);

test("maps and Vimeo videos load only when clicked, so plain sites stay script- and cookie-free", () => {
  const s = site([createBlock("map", { address: "York" }), createBlock("video", { url: "https://vimeo.com/76979871" })]);
  const html = renderPage(s, s.pages[0]);
  assert.match(html, /<iframe title="Map of York" loading="lazy" srcdoc="[^"]*Show map/);
  assert.doesNotMatch(html, /<iframe[^>]* src="https:\/\/maps\.google/);
  assert.doesNotMatch(html, /<iframe[^>]* src="https:\/\/player\.vimeo/);
  assert.ok(noScript(html));
  assert.doesNotMatch(html, /id="eka-cookie"/, "no cookie notice needed");
  const instant = site([createBlock("map", { address: "York", onClick: false })]);
  assert.match(renderPage(instant, instant.pages[0]), /<iframe[^>]* src="https:\/\/maps\.google\.com\/maps\?q=York/);
});

test("tracking code waits for Accept on the cookie notice", () => {
  const s = site([createBlock("text")], { legal: { trackingCode: "<script>window.ga=1</script>" } });
  const html = renderPage(s, s.pages[0]);
  assert.match(html, /<template data-eka-consent><script>window\.ga=1<\/script><\/template>/);
  assert.match(html, /<div class="eka-cookie" id="eka-cookie"[^>]*hidden>/);
  assert.match(html, /data-eka-c="yes">Accept<\/button>/);
  assert.doesNotMatch(renderPage(s, s.pages[0], { editor: true }), /id="eka-cookie"|window\.ga/, "not in the editor");
  const off = site([createBlock("text")], { legal: { trackingCode: "<script>x</script>", cookieNotice: "off" } });
  assert.doesNotMatch(renderPage(off, off.pages[0]), /id="eka-cookie"/);
  assert.ok(checkSite(off).some((i) => i.kind === "cookies"), "the site check warns that it'll never run");
  // Custom code blocks can ask for consent too.
  const block = site([createBlock("html", { code: "<script>chat()</script>", consent: true })]);
  assert.match(renderPage(block, block.pages[0]), /<template data-eka-consent><script>chat\(\)<\/script><\/template>[^]*id="eka-cookie"/);
});

test("the privacy policy is written from what the site does, linked in the footer, kept out of the menu", () => {
  const s = site([createBlock("form", FORM_PRESETS.booking()), createBlock("map", { address: "York" }), createBlock("products", { items: [{ name: "Cake", price: "£5", href: "https://buy.stripe.com/x", buttonText: "Buy" }] })], { legal: { trackingCode: "<script>ga()</script>" } });
  assert.ok(checkSite(s).some((i) => i.kind === "privacy"));
  const facts = siteFacts(s);
  assert.deepEqual([facts.forms, facts.booking, facts.maps, facts.stripe, facts.tracking, facts.paypal], [true, true, true, true, true, false]);
  const withPolicy = normalizeSite(ensurePrivacyPage(structuredClone(s)));
  const page = withPolicy.pages.find((p) => p.slug === "privacy");
  assert.equal(page.hidden, true);
  const html = renderPage(withPolicy, page);
  assert.match(html, /<h1[^>]*>Privacy policy<\/h1>/);
  assert.match(html, /booking request/);
  assert.match(html, /preferred date/);
  assert.match(html, /Google Maps/);
  assert.match(html, /Stripe/);
  assert.match(html, /href="#cookies"/);
  assert.match(html, /ico\.org\.uk/);
  assert.match(html, /hello@rose\.test/);
  const home = renderPage(withPolicy, withPolicy.pages[0]);
  assert.doesNotMatch(home.match(/<nav class="eka-nav"[^]*?<\/nav>/)[0], /Privacy/, "not in the menu");
  assert.match(home, /<nav class="eka-footer-links"><a href="\/privacy\/">Privacy policy<\/a><a href="#cookies">Cookie settings<\/a>/);
  assert.match(home, /Privacy policy<\/a><\/p><div><button/, "the cookie notice links to it");
  assert.ok(!checkSite(withPolicy).some((i) => i.kind === "privacy"));
  // Running it again doesn't duplicate anything.
  const again = normalizeSite(ensurePrivacyPage(structuredClone(withPolicy)));
  assert.equal(again.pages.filter((p) => p.slug === "privacy").length, 1);
  assert.equal(again.footer.links.length, 2);
});

test("the website's language: html lang, builder words, dates, and the AI is told", () => {
  const s = site([createBlock("products", { items: [{ name: "Gâteau", price: "5 €", soldOut: true, buttonText: "Acheter" }] })], { lang: "fr" });
  const html = renderPage(s, s.pages[0]);
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /Épuisé/);
  assert.match(html, /aria-label="Ouvrir le menu"/);
  assert.match(formatBrief({ name: "X", lang: "fr" }), /LANGUAGE: write every word of the website[^]*in French/);
  assert.match(editPrompt({ site: s, instruction: "add a section", page: s.pages[0] }), /^LANGUAGE:[^]*French/);
  assert.doesNotMatch(formatBrief({ name: "X", lang: "en-GB" }), /LANGUAGE/);
  assert.equal(normalizeSite({ lang: "xx" }).lang, "en-GB");
});
