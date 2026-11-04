import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { normalizeSite, createEmptySite, createSection, createBlock, createPage } from "../shared/schema.js";
import { renderSpecialPage, renderPage } from "../shared/render.js";
import { readableColor, contrast, fixThemeContrast } from "../shared/checks.js";
import { buildStaticSite } from "../server/export.js";
import { makeShareImage } from "../server/share-image.js";

function site(extra = {}) {
  const s = createEmptySite("Rose Bakery");
  s.pages.push(createPage("About"), createPage("Contact"));
  s.pages[0].sections = [createSection({}, [[createBlock("newsletter")]])];
  return normalizeSite({ ...s, ...extra });
}

test("'page not found' and 'coming soon' pages in the site's own style", async () => {
  const s = site();
  const nf = renderSpecialPage(s, "404");
  assert.match(nf, /<meta name="robots" content="noindex">/);
  assert.match(nf, /Sorry, we can(&#39;|')t find that page/);
  assert.match(nf, /<a class="eka-btn btn-primary" href="\/"><span>Home<\/span><\/a><a class="eka-btn btn-outline" href="\/about\/"><span>About<\/span><\/a>/);
  assert.match(nf, /class="eka-header/, "with the site's header");
  const soon = renderSpecialPage(site({ special: { comingSoon: true, comingSoonTitle: "Opening soon!", launch: "2026-12-01" } }), "soon");
  assert.match(soon, /Opening soon!/);
  assert.match(soon, /Opening 1 December 2026/);
  assert.match(soon, /class="eka-news/, "the newsletter signup comes along");
  assert.doesNotMatch(soon, /<header/, "no menu to pages visitors can't see");
  // Coming-soon mode when exporting: only the coming-soon page goes up.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eka-soon-"));
  const files = (await buildStaticSite({ site: site({ special: { comingSoon: true } }), siteId: "abc", mediaDir: dir })).map((f) => f.path);
  assert.ok(files.includes("index.html") && !files.includes("about/index.html"));
  await fs.rm(dir, { recursive: true });
});

test("one-click readability fixes keep the colour where they can", () => {
  const fixed = readableColor("#9ca3af", "#ffffff");
  assert.ok(contrast(fixed, "#ffffff") >= 4.5);
  assert.notEqual(fixed, "#111111", "darkened, not swapped for black");
  assert.ok(contrast(readableColor("#334155", "#0f172a"), "#0f172a") >= 4.5, "lightened on dark backgrounds");
  assert.equal(readableColor("#111111", "#ffffff"), "#111111", "fine colours are left alone");
  const t = fixThemeContrast({ primary: "#fbbf24", accent: "#000", background: "#ffffff", surface: "#f4f4f4", text: "#999999", muted: "#cccccc", dark: "#111" });
  for (const k of ["text", "muted", "primary"]) assert.ok(contrast(t[k], "#ffffff") >= 4.5, k);
});

test("share pictures: 1200×630, from a photo or the site's colours, used for sharing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eka-share-"));
  await sharp({ create: { width: 800, height: 600, channels: 3, background: "#884422" } }).jpeg().toFile(path.join(dir, "photo.jpg"));
  const colors = { primary: "#2563eb", accent: "#f59e0b", dark: "#0f172a" };
  for (const style of ["photo", "split", "brand"]) {
    const name = await makeShareImage({ dir, title: "Fresh bread & cakes, baked every morning in York", subtitle: "Rose Bakery", photo: "photo.jpg", colors, style });
    const meta = await sharp(path.join(dir, name)).metadata();
    assert.deepEqual([meta.width, meta.height, meta.format], [1200, 630, "jpeg"], style);
  }
  const s = site({ shareImage: "/_m/abc/share-1.jpg" });
  assert.match(renderPage(s, s.pages[1], { origin: "https://rose.test" }), /og:image" content="https:\/\/rose\.test\/_m\/abc\/share-1\.jpg"/);
  await fs.rm(dir, { recursive: true });
});
