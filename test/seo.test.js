import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmptySite, createSection, createBlock, normalizeSite } from "../shared/schema.js";
import { renderPage, sitemapXml } from "../shared/render.js";
import { applyBrief } from "../server/ai/index.js";
import { buildStaticSite } from "../server/export.js";

function shop() {
  const s = createEmptySite("Harbour Antiques");
  s.pages[0].sections = [createSection({ background: "image", image: "/_m/s1/shop-o.webp" }, [[createBlock("heading")]])];
  s.pages.push({ title: "About", slug: "about", sections: [] });
  return applyBrief(normalizeSite(s), { phone: "01234 567890", email: "hi@harbour.test", address: "1 Quay St, Whitby", socials: "facebook.com/harbour\ninstagram.com/harbour" });
}

test("pages get an icon, a share picture and (on the home page) business details for Google", () => {
  const site = shop();
  const home = renderPage(site, site.pages[0], { canonical: "https://harbour.test/" });
  assert.match(home, /<link rel="icon" href="data:image\/svg\+xml,/, "a letter icon when there's no logo");
  assert.match(home, /<meta property="og:image" content="https:\/\/harbour\.test\/_m\/s1\/shop-o\.webp">/);
  const ld = JSON.parse(home.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
  assert.equal(ld["@type"], "LocalBusiness");
  assert.equal(ld.telephone, "01234 567890");
  assert.equal(ld.address.streetAddress, "1 Quay St, Whitby");
  assert.deepEqual(ld.sameAs, ["https://facebook.com/harbour", "https://instagram.com/harbour"]);
  assert.doesNotMatch(renderPage(site, site.pages[1]), /ld\+json/, "business details only on the home page");
  site.header.logoImage = "/_m/s1/logo-o.webp";
  assert.match(renderPage(site, site.pages[1]), /<link rel="icon" href="\/_m\/s1\/logo-o\.webp">/);
});

test("sitemap lists every page; exports include it when the domain is known", async () => {
  const site = shop();
  assert.match(sitemapXml(site, "https://harbour.test/"), /<loc>https:\/\/harbour\.test\/<\/loc><\/url><url><loc>https:\/\/harbour\.test\/about\/<\/loc>/);
  const files = await buildStaticSite({ site, siteId: "s1", mediaDir: "/nonexistent", domain: "harbour.test" });
  const get = (p) => files.find((f) => f.path === p)?.content.toString();
  assert.match(get("sitemap.xml"), /harbour\.test\/about\//);
  assert.match(get("robots.txt"), /Sitemap: https:\/\/harbour\.test\/sitemap\.xml/);
  assert.match(get("index.html"), /og:image" content="https:\/\/harbour\.test\/media\/shop-o\.webp"/, "media links point at the exported folder");
});
