import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createEmptySite, createSection, createBlock, normalizeSite, normalizeStyle } from "../shared/schema.js";
import { createStock, fillStockPhotos, fillOwnerPhotos, keywordsFromBrief } from "../server/stock.js";
import { formatBrief } from "../server/ai/prompts.js";
import { createDemoProvider } from "../server/ai/demo.js";
import { fillPlaceholders, isPlaceholder } from "../server/placeholders.js";

// A stand-in for the Pexels API: 8 photos per search, images are small JPEGs.
async function fakePexels() {
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#8a6d3b" } }).jpeg().toBuffer();
  const searches = [];
  let next = 1;
  const fetchImpl = async (url, opts) => {
    if (url.includes("/search?")) {
      assert.equal(opts.headers.Authorization, "key");
      const q = new URL(url).searchParams.get("query");
      searches.push(q);
      const photos = Array.from({ length: 8 }, () => { const id = next++; return { id, alt: `${q} ${id}`, width: 64, height: 48, url: `https://www.pexels.com/photo/${id}`, photographer: "Sam", photographer_url: "https://www.pexels.com/@sam", src: { medium: `https://images.pexels.com/m/${id}.jpg`, large2x: `https://images.pexels.com/l/${id}.jpg` } }; });
      return { ok: true, status: 200, json: async () => ({ photos }) };
    }
    assert.match(url, /^https:\/\/images\.pexels\.com\//);
    return { ok: true, status: 200, arrayBuffer: async () => jpeg };
  };
  return { fetchImpl, searches };
}

test("new designs get stock photos that match each picture spot", async () => {
  const { fetchImpl, searches } = await fakePexels();
  const stock = createStock({ apiKey: "key", fetchImpl });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eka-stock-"));
  const site = createEmptySite("Harbour Antiques");
  site.business = { keywords: "antique shop interior" };
  site.pages[0].sections = [
    createSection({ background: "image" }),
    createSection({ layout: "1-1" }, [[createBlock("image", { alt: "brass carriage clock on an oak sideboard" })], [createBlock("gallery")]]),
  ];
  const added = await fillStockPhotos(site, { stock, dir, urlPrefix: "/_tmp/" });
  assert.equal(added, 8, "background + image + 6 gallery photos");
  assert.ok(searches.includes("brass carriage clock on an oak sideboard"), "the image's own description is searched");
  assert.ok(searches.includes("antique shop interior"), "the business keywords cover backgrounds and galleries");
  const urls = [site.pages[0].sections[0].props.image, site.pages[0].sections[1].columns[0].blocks[0].props.src, ...site.pages[0].sections[1].columns[1].blocks[0].props.images.map((i) => i.src)];
  assert.equal(new Set(urls).size, 8, "no photo is used twice");
  assert.ok(urls.every((u) => /^\/_tmp\/pexels-\d+-[a-f0-9]+-o\.webp$/.test(u) && !isPlaceholder(u)), urls.join(" "));
  assert.ok((await fs.readdir(dir)).some((f) => f.endsWith("-o-sm.webp")), "phone-sized copies are made like uploads");
  await fs.rm(dir, { recursive: true });
});

test("without a key (or if a download fails) the placeholder artwork is used", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eka-stock-"));
  const site = normalizeSite(createEmptySite("x"));
  site.pages[0].sections = [createSection({ background: "image" })];
  assert.equal(await fillStockPhotos(site, { stock: createStock({ apiKey: "" }), dir, urlPrefix: "/_tmp/" }), 0);
  const failing = createStock({ apiKey: "key", fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.equal(await fillStockPhotos(site, { stock: failing, dir, urlPrefix: "/_tmp/" }), 0);
  await fillPlaceholders(site, { dir, urlPrefix: "/_tmp/" });
  assert.ok(isPlaceholder(site.pages[0].sections[0].props.image));
  await assert.rejects(createStock({ apiKey: "key" }).download("https://evil.example/x.jpg", { dir, urlPrefix: "/" }), /isn't a Pexels photo/);
  assert.equal(keywordsFromBrief({ description: "Antique shop by the sea selling clocks, silver and furniture." }), "Antique shop by the sea selling clocks");
  await fs.rm(dir, { recursive: true });
});

test("Pixabay works the same way (its tags become the photo descriptions)", async () => {
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#335577" } }).jpeg().toBuffer();
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.startsWith("https://pixabay.com/api/")) {
      const hits = [1, 2, 3].map((id) => ({ id, tags: "clock, antique, time", webformatURL: `https://pixabay.com/get/w${id}.jpg`, largeImageURL: `https://pixabay.com/get/l${id}.jpg`, user: "Ann", user_id: 7, pageURL: `https://pixabay.com/photos/${id}` }));
      return { ok: true, status: 200, json: async () => ({ hits }) };
    }
    return { ok: true, status: 200, arrayBuffer: async () => jpeg };
  };
  const stock = createStock({ provider: "pixabay", apiKey: "pk", fetchImpl });
  const photos = await stock.search("antique clock", { orientation: "landscape" });
  assert.match(urls[0], /^https:\/\/pixabay\.com\/api\/\?key=pk&q=antique\+clock&image_type=photo&safesearch=true.*orientation=horizontal/);
  assert.equal(photos[0].alt, "clock, antique, time");
  assert.equal(photos[0].large, "https://pixabay.com/get/l1.jpg");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eka-stock-"));
  const site = createEmptySite("x");
  site.pages[0].sections = [createSection({ background: "image" })];
  assert.equal(await fillStockPhotos(site, { stock, dir, urlPrefix: "/_tmp/", keywords: "antique clock" }), 1);
  assert.match(site.pages[0].sections[0].props.image, /^\/_tmp\/pixabay-\d+-[a-f0-9]+-o\.webp$/);
  await assert.rejects(stock.download("https://images.pexels.com/x.jpg", { dir, urlPrefix: "/" }), /isn't a Pixabay photo/);
  const { stockFromEnv } = await import("../server/stock.js");
  assert.deepEqual(stockFromEnv({ PIXABAY_API_KEY: "a" }), { provider: "pixabay", apiKey: "a" });
  assert.equal(stockFromEnv({ PIXABAY_API_KEY: "a", PEXELS_API_KEY: "b" }).provider, "pexels");
  await fs.rm(dir, { recursive: true });
});

test("the owner's photos fill picture spots first, then stock covers the rest", async () => {
  const { fetchImpl, searches } = await fakePexels();
  const stock = createStock({ apiKey: "key", fetchImpl });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eka-stock-"));
  const site = createEmptySite("Harbour Antiques");
  site.business = { keywords: "antique shop interior" };
  const card = createBlock("text", { html: "<p>Hi</p>" });
  card.style = { bgPhoto: "sunlit harbour with fishing boats", tint: "#000000", tintOpacity: 50 };
  site.pages[0].sections = [
    createSection({ background: "image" }),
    createSection({ layout: "1-1" }, [[createBlock("image", { alt: "shop front" })], [card]]),
  ];
  const photos = [{ url: "/_tmp/front.webp", note: "The shop front at dusk" }, { url: "/_tmp/used.webp", note: "" }];
  site.pages[0].sections[1].columns[0].blocks.push(createBlock("image", { src: "/_tmp/used.webp" }));
  assert.equal(fillOwnerPhotos(site, photos), 1, "a photo the design already uses isn't placed again");
  assert.equal(site.pages[0].sections[0].props.image, "/_tmp/front.webp", "the first spot (the hero background) gets the owner's photo");
  assert.equal(await fillStockPhotos(site, { stock, dir, urlPrefix: "/_tmp/" }), 2);
  assert.ok(searches.includes("sunlit harbour with fishing boats"), "a block's bgPhoto description is the search");
  assert.match(card.style.bgImage, /^\/_tmp\/pexels-/);
  assert.equal(card.style.tint, "#000000", "the tint the design asked for is kept");
  await fs.rm(dir, { recursive: true });
});

test("background photo descriptions, owner photos in the brief, and template tints", async () => {
  assert.equal(normalizeStyle({ bgPhoto: "  bakery counter  " }).bgPhoto, "bakery counter");
  assert.equal(normalizeStyle({ bgPhoto: "" }), undefined);
  const text = formatBrief({ name: "X", logoUrl: "/_tmp/logo.webp", photos: [{ url: "/_tmp/a.webp", note: "the team" }], imagesAttached: true });
  assert.match(text, /1\. \/_tmp\/a\.webp \(the team\)/);
  assert.match(text, /attached after the logo/);
  const { site } = await createDemoProvider().generateConcept({ brief: { name: "Bakery", description: "Bakery in York" } });
  const hero = site.pages[0].sections.find((x) => x.props.background === "image");
  assert.ok(hero.style.tint && hero.style.tintOpacity > 0, "template photo backgrounds get a tint");
  assert.equal(hero.style.bgEffect, "zoom");
});
