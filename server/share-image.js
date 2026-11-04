// The picture shown when a site is shared (Facebook, WhatsApp, LinkedIn…):
// 1200×630, with the site's photo or colours, its logo, and a headline.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

const W = 1200, H = 630;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

// Splits text into lines of about `max` characters.
function wrap(text, max, lines = 3) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if ((line + " " + word).trim().length > max && line) { out.push(line); line = word; } else line = `${line} ${word}`.trim();
  }
  if (line) out.push(line);
  if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1].replace(/\s*\S*$/, "…"); }
  return out;
}

/**
 * Makes the picture. `photo` and `logo` are files in the site's media folder (or null).
 * style: "photo" (text over the photo), "brand" (the site's colours), "split" (photo on the right).
 * Returns the new file's name.
 */
export async function makeShareImage({ dir, title, subtitle = "", photo = null, logo = null, colors, style = "photo" }) {
  const usePhoto = photo && style !== "brand";
  const split = usePhoto && style === "split";
  const textW = split ? 640 : W;
  const layers = [];
  let base;
  if (usePhoto) {
    const pic = await sharp(path.join(dir, photo)).resize(split ? W - textW : W, H, { fit: "cover" }).toBuffer();
    base = sharp({ create: { width: W, height: H, channels: 3, background: colors.dark } });
    layers.push({ input: pic, left: split ? textW : 0, top: 0 });
    if (!split) layers.push({ input: Buffer.from(`<svg width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".72"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`), left: 0, top: 0 });
  } else {
    base = sharp(Buffer.from(`<svg width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors.dark}"/><stop offset="1" stop-color="${colors.primary}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/><circle cx="1080" cy="80" r="260" fill="${colors.accent}" opacity=".18"/></svg>`));
  }
  if (logo) {
    try {
      const l = await sharp(path.join(dir, logo)).resize({ height: 70, width: 360, fit: "inside" }).png().toBuffer();
      layers.push({ input: l, left: 70, top: 64 });
    } catch { /* logo unreadable: leave it out */ }
  }
  const lines = wrap(title, split ? 18 : 28, 3);
  const size = lines.length > 2 ? 64 : 76;
  const y0 = H - 110 - (lines.length - 1) * size * 1.12 - (subtitle ? 60 : 0);
  const sub = wrap(subtitle, split ? 34 : 56, 2);
  const text = `<svg width="${textW}" height="${H}"><style>.t{font:800 ${size}px 'Inter','Helvetica Neue',Arial,sans-serif;fill:#fff}.s{font:500 30px 'Inter','Helvetica Neue',Arial,sans-serif;fill:#fff;opacity:.88}</style>${lines.map((l, i) => `<text class="t" x="70" y="${y0 + i * size * 1.12}">${esc(l)}</text>`).join("")}${sub.map((l, i) => `<text class="s" x="72" y="${y0 + (lines.length - 1) * size * 1.12 + 62 + i * 40}">${esc(l)}</text>`).join("")}<rect x="70" y="${H - 52}" width="90" height="6" rx="3" fill="${colors.accent}"/></svg>`;
  layers.push({ input: Buffer.from(text), left: 0, top: 0 });
  const out = await base.composite(layers).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  const name = `share-${crypto.createHash("sha1").update(out).digest("hex").slice(0, 10)}.jpg`;
  await fs.writeFile(path.join(dir, name), out);
  return name;
}
