import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeSite, createEmptySite, createBlock, createSection, createPost, listPosts, FORM_PRESETS } from "../shared/schema.js";
import { renderPage, pageAtPath, pageUrl, sitemapXml } from "../shared/render.js";
import { buildStaticSite } from "../server/export.js";
import { ownerEmail, visitorEmail } from "../server/form-mail.js";
import { createAi } from "../server/ai/index.js";
import { createDemoProvider } from "../server/ai/demo.js";
import { formatBrief } from "../server/ai/prompts.js";

function blogSite() {
  const site = createEmptySite("Garden Notes");
  site.pages[0].sections = [createSection({}, [[createBlock("posts", { count: 2 })]])];
  const a = createPost("Planting bulbs", { date: "2026-10-01", excerpt: "When and how." });
  a.post.draft = false;
  const b = createPost("Pruning roses", { date: "2026-10-20", excerpt: "Keep them tidy." });
  b.post.draft = false;
  const draft = createPost("Not ready yet", { date: "2026-10-25" });
  site.pages.push(a, b, draft);
  return normalizeSite(site);
}

test("blog posts live at /blog/<slug>/, newest first, drafts hidden", () => {
  const site = blogSite();
  assert.deepEqual(listPosts(site).map((p) => p.title), ["Pruning roses", "Planting bulbs"]);
  assert.equal(listPosts(site, { drafts: true }).length, 3);
  const post = site.pages.find((p) => p.title === "Pruning roses");
  assert.equal(pageUrl(post, "/"), "/blog/pruning-roses/");
  assert.equal(pageAtPath(site, "blog/pruning-roses/"), post);
  assert.equal(pageAtPath(site, "pruning-roses"), null, "posts aren't at the top level");

  const home = renderPage(site, site.pages[0]);
  assert.match(home, /href="\/blog\/pruning-roses\/"/);
  assert.ok(home.indexOf("Pruning roses") < home.indexOf("Planting bulbs"), "newest first");
  assert.doesNotMatch(home, /Not ready yet/);
  assert.doesNotMatch(home, /<nav class="eka-nav"[^]*Pruning roses[^]*<\/nav>/, "posts stay out of the menu");

  const html = renderPage(site, post);
  assert.match(html, /<h1>Pruning roses<\/h1>/);
  assert.match(html, /20 October 2026/);
  assert.match(html, /og:type" content="article"/);
  assert.match(html, /← Back to Home/);
  assert.doesNotMatch(sitemapXml(site, "https://x.test"), /not-ready-yet/);
  assert.match(sitemapXml(site, "https://x.test"), /x\.test\/blog\/pruning-roses\/<\/loc><lastmod>2026-10-20/);
});

test("exported sites get post folders, and no drafts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eka-blog-"));
  const files = await buildStaticSite({ site: blogSite(), siteId: "abc", mediaDir: dir });
  const paths = files.map((f) => f.path);
  assert.ok(paths.includes("blog/pruning-roses/index.html"));
  assert.ok(!paths.some((p) => p.includes("not-ready-yet")));
  await fs.rm(dir, { recursive: true });
});

test("products show prices, buy links, and sold-out items can't be bought", () => {
  const site = createEmptySite("Shop");
  site.pages[0].sections = [createSection({}, [[createBlock("products", { items: [
    { name: "Brass clock", price: "£120", text: "Lovely.", buttonText: "Buy now", href: "https://buy.stripe.com/test_123", image: "" },
    { name: "Silver spoon", price: "£30", buttonText: "Buy now", soldOut: true },
    { name: "Oak chair", price: "£90", buttonText: "Ask about it", href: "" },
  ] })]])];
  const html = renderPage(normalizeSite(site), normalizeSite(site).pages[0]);
  assert.match(html, /<h3>Brass clock<\/h3><p class="eka-product-price">£120<\/p>/);
  assert.match(html, /href="https:\/\/buy\.stripe\.com\/test_123" target="_blank"/);
  assert.match(html, /eka-product sold/);
  assert.match(html, /aria-disabled="true">Sold out/);
  assert.match(html, /href="#contact">Ask about it/, "no buy link: goes to the contact section");
});

test("booking and enquiry forms render every field type", () => {
  const site = createEmptySite("Salon");
  site.pages[0].sections = [createSection({ layout: "1-1" }, [[createBlock("form", FORM_PRESETS.booking())], [createBlock("form", FORM_PRESETS.enquiry())]])];
  const s = normalizeSite(site);
  const html = renderPage(s, s.pages[0]);
  assert.match(html, /type="date" required/);
  assert.match(html, /type="time"/);
  assert.match(html, /type="number" min="0"/);
  assert.match(html, /<select [^>]*required><option value="">Choose…<\/option><option>Appointment<\/option>/);
  assert.match(html, /<label class="eka-check"[^>]*><input [^>]*type="checkbox" value="Yes" required>/);
  assert.equal(s.pages[0].sections[0].columns[0].blocks[0].props.kind, "booking");
  // Old forms without the new settings keep working.
  const old = normalizeSite({ pages: [{ sections: [{ columns: [{ blocks: [{ type: "form", props: { fields: [{ label: "Name", type: "text" }] } }] }] }] }] });
  const f = old.pages[0].sections[0].columns[0].blocks[0].props;
  assert.equal(f.kind, "contact");
  assert.equal(f.confirmEmail, false);
});

test("form emails say what kind of form it was, and the exported mailer sends copies", async () => {
  const lines = [["Your name", "Sam"], ["Preferred date", "2026-11-20"]];
  assert.equal(ownerEmail({ kind: "booking", siteName: "Salon", lines }).subject, "New booking request from your website: Salon");
  assert.match(ownerEmail({ kind: "enquiry", siteName: "Salon", lines }).body, /new enquiry[^]*Preferred date:\n2026-11-20/);
  assert.match(visitorEmail({ kind: "booking", siteName: "Salon", lines }).body, /isn't confirmed until we get back to you/);

  const site = createEmptySite("Salon");
  site.pages[0].sections = [createSection({}, [[createBlock("form", FORM_PRESETS.booking())]])];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eka-forms-"));
  const files = await buildStaticSite({ site: normalizeSite(site), siteId: "abc", mediaDir: dir, formEmail: "owner@salon.test" });
  const php = files.find((f) => f.path === "contact.php").content.toString();
  const forms = JSON.parse(Buffer.from(php.match(/\$forms\s+= json_decode\(base64_decode\('([^']+)'/)[1], "base64").toString());
  const form = Object.values(forms)[0];
  assert.equal(form.noun, "booking request");
  assert.equal(form.confirm, true);
  assert.match(php, /@mail\(\$replyTo, \$vSubject/);
  await fs.rm(dir, { recursive: true });
});

test("shops, blogs and booking pages from the templates", async () => {
  const ai = createAi({ provider: createDemoProvider() });
  const brief = { name: "Harbour Gifts", description: "Gift shop by the sea", siteType: "shop", extras: { booking: true, enquiry: true }, pages: ["Shop", "About", "Book", "Contact"], pageInfo: {} };
  const { site: concept } = await ai.generateConcept({ brief });
  const blocks = (page) => page.sections.flatMap((x) => x.columns.flatMap((c) => c.blocks));
  assert.ok(blocks(concept.pages[0]).some((x) => x.type === "products"), "shop home features products");
  assert.equal(concept.header.ctaHref, "/book");
  const { site } = await ai.buildFromConcept({ brief, concept });
  const page = (slug) => site.pages.find((p) => p.slug === slug);
  assert.ok(blocks(page("shop")).some((x) => x.type === "products"));
  assert.equal(blocks(page("book")).find((x) => x.type === "form").props.kind, "booking");
  assert.equal(blocks(page("contact")).find((x) => x.type === "form").props.kind, "enquiry");
  const posts = await ai.starterPosts({ site, brief: { ...brief, siteType: "blog" } });
  assert.equal(posts.length, 3);
  assert.ok(posts.every((p) => p.post.draft), "template posts are drafts until the owner writes them");
  assert.match(formatBrief({ siteType: "blog", extras: { booking: true } }), /Type of website: Blog[^]*"posts" block[^]*kind "booking"/);
});
