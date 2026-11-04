import { test } from "node:test";
import assert from "node:assert/strict";
import { STYLE_KITS, applyStyleKit, paletteFromPixels } from "../shared/style-kits.js";
import { normalizeSite, createEmptySite } from "../shared/schema.js";
import { contrast } from "../shared/checks.js";

test("style kits change the whole look, optionally keeping the colours, and stay readable", () => {
  for (const k of STYLE_KITS) {
    const site = normalizeSite(applyStyleKit(createEmptySite("X"), k.id));
    assert.equal(site.theme.fonts.heading, k.fonts[0], k.id);
    assert.equal(site.theme.buttons.shape, k.buttons.shape, `${k.id} survives normalising`);
    assert.ok(contrast(k.colors.text, k.colors.background) >= 4.5, `${k.id}: text is readable`);
  }
  const mine = createEmptySite("X");
  mine.theme.colors.primary = "#123456";
  applyStyleKit(mine, "luxury", { keepColours: true });
  assert.equal(mine.theme.colors.primary, "#123456");
  assert.equal(mine.theme.fonts.heading, "playfair");
});

test("colours from a logo: main and accent colours, shades, and none for black-and-white logos", () => {
  const px = (rgb, n) => Array.from({ length: n }, () => [...rgb, 255]).flat();
  const logo = Uint8ClampedArray.from([...px([200, 30, 40], 400), ...px([20, 90, 200], 150), ...px([255, 255, 255], 600), ...px([0, 0, 0], 300)]);
  const pal = paletteFromPixels(logo);
  assert.match(pal.primary, /^#c[0-9a-f]1e2[0-9a-f]$/, pal.primary);
  assert.match(pal.accent, /^#1[0-9a-f]5[0-9a-f]c[0-9a-f]$/, pal.accent);
  assert.ok(contrast(pal.dark, "#ffffff") > 7, "a dark shade for dark sections");
  assert.equal(paletteFromPixels(Uint8ClampedArray.from([...px([0, 0, 0], 300), ...px([255, 255, 255], 300)])), null);
});
