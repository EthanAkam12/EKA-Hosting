import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createEmptySite, normalizeSite } from "../shared/schema.js";
import { buildCubecartSkin, themeCss } from "../server/cubecart-skin.js";

function site(extra = {}) {
  const s = createEmptySite("Old & Gold $1");
  s.theme.colors.primary = "#7a2e2e";
  return normalizeSite({ ...s, ...extra });
}

test("theme CSS carries the design's colours and fonts", () => {
  const css = themeCss(site());
  assert.match(css, /--cc-brand-600: #7a2e2e;/);
  assert.match(css, /--cc-radius: \d+px;/);
  assert.match(css, /--cc-font-serif: /);
});

test("skin is renamed, single-style, and links the theme CSS", async () => {
  const { folder, files } = await buildCubecartSkin({ site: site(), slug: "old-gold" });
  assert.equal(folder, "eka-old-gold");
  const get = (p) => files.find((f) => f.path === `${folder}/${p}`)?.content.toString();
  const xml = get("config.xml");
  assert.match(xml, /<name><!\[CDATA\[eka-old-gold\]\]><\/name>/);
  assert.match(xml, /<display><!\[CDATA\[Old & Gold \$1 \(EKA\)\]\]><\/display>/);
  assert.doesNotMatch(xml, /oxblood/);
  assert.ok(get("css/eka-theme.css"));
  assert.ok(!get("css/cubecart.navy.css"));
  assert.match(get("templates/element.css.php"), /css\/eka-theme\.css/);
  assert.match(get("docs/HOMEPAGE.html"), /hl-welcome/);
  assert.ok(files.every((f) => f.path.startsWith(`${folder}/`)));
});

test("the design's logo becomes the skin's default logo", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eka-skin-"));
  await sharp({ create: { width: 400, height: 200, channels: 3, background: "#123456" } }).webp().toFile(path.join(dir, "logo-o.webp"));
  const s = site();
  s.header.logoImage = "/_m/abc/logo-o.webp";
  const { folder, files } = await buildCubecartSkin({ site: s, slug: "x", mediaDir: dir });
  const png = files.find((f) => f.path === `${folder}/images/default/logo/default.png`).content;
  assert.equal((await sharp(png).metadata()).format, "png");
  assert.equal((await sharp(png).metadata()).height, 160);
  const main = files.find((f) => f.path === `${folder}/templates/main.php`).content.toString();
  assert.match(main, /\{if empty\(\$STORE_LOGO\)\}/);
  await fs.rm(dir, { recursive: true });
});
