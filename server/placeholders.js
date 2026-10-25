// Placeholder pictures for generated sites, so every image spot shows
// something attractive until the owner swaps in real photos.
//
// They are abstract artwork in the site's own colours (no text, so they look
// fine even if one slips onto the live site), saved as normal WebP files named
// "placeholder-…" so the editor can tag them and the owner can replace them.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

let sharp = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  // Without sharp the SVG itself is used (still works, just larger).
}

const VARIANTS = 6;

function mix(hex, toward, amount) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [p(hex), p(toward)];
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, "0")).join("");
}

// One of six compositions: soft gradient ground, layered arches / circles /
// waves in the brand colours, and a little texture.
function svgFor(colors, variant, wide) {
  const W = wide ? 1920 : 1600;
  const H = wide ? 1080 : 1200;
  const p = colors.primary;
  const a = colors.accent;
  const light = mix(p, "#ffffff", 0.82);
  const mid = mix(p, "#ffffff", 0.45);
  const deep = mix(p, "#000000", 0.45);
  const glow = mix(a, "#ffffff", 0.35);
  const shapes = [
    // 0: sun over rolling hills
    `<circle cx="${W * 0.68}" cy="${H * 0.38}" r="${H * 0.2}" fill="${glow}" opacity=".9"/>
     <path d="M0 ${H * 0.72} Q ${W * 0.25} ${H * 0.52} ${W * 0.5} ${H * 0.7} T ${W} ${H * 0.62} V ${H} H 0 Z" fill="${mid}"/>
     <path d="M0 ${H * 0.84} Q ${W * 0.3} ${H * 0.7} ${W * 0.62} ${H * 0.86} T ${W} ${H * 0.8} V ${H} H 0 Z" fill="${p}" opacity=".85"/>`,
    // 1: stacked arches
    [0.42, 0.3, 0.18].map((r, i) => `<path d="M ${W / 2 - H * r} ${H} V ${H * 0.62} A ${H * r} ${H * r} 0 0 1 ${W / 2 + H * r} ${H * 0.62} V ${H} Z" fill="${[mid, p, glow][i]}" opacity="${[0.8, 0.9, 1][i]}"/>`).join(""),
    // 2: overlapping circles
    `<circle cx="${W * 0.35}" cy="${H * 0.5}" r="${H * 0.3}" fill="${mid}" opacity=".85"/>
     <circle cx="${W * 0.58}" cy="${H * 0.45}" r="${H * 0.24}" fill="${glow}" opacity=".8"/>
     <circle cx="${W * 0.5}" cy="${H * 0.66}" r="${H * 0.16}" fill="${p}" opacity=".85"/>`,
    // 3: diagonal bands
    `<path d="M0 ${H * 0.55} L ${W} ${H * 0.25} V ${H * 0.5} L 0 ${H * 0.8} Z" fill="${mid}" opacity=".75"/>
     <path d="M0 ${H * 0.82} L ${W} ${H * 0.52} V ${H * 0.66} L 0 ${H * 0.96} Z" fill="${p}" opacity=".8"/>
     <circle cx="${W * 0.8}" cy="${H * 0.2}" r="${H * 0.08}" fill="${glow}"/>`,
    // 4: framed window with a vase-like form
    `<rect x="${W * 0.3}" y="${H * 0.14}" width="${W * 0.4}" height="${H * 0.72}" rx="${W * 0.2}" fill="${mid}" opacity=".7"/>
     <ellipse cx="${W / 2}" cy="${H * 0.66}" rx="${W * 0.09}" ry="${H * 0.16}" fill="${p}"/>
     <rect x="${W / 2 - W * 0.03}" y="${H * 0.42}" width="${W * 0.06}" height="${H * 0.12}" rx="8" fill="${p}"/>
     <circle cx="${W / 2}" cy="${H * 0.36}" r="${H * 0.07}" fill="${glow}"/>`,
    // 5: soft waves
    [0, 1, 2, 3].map((i) => `<path d="M0 ${H * (0.4 + i * 0.15)} C ${W * 0.3} ${H * (0.3 + i * 0.15)} ${W * 0.6} ${H * (0.52 + i * 0.15)} ${W} ${H * (0.38 + i * 0.15)} V ${H} H 0 Z" fill="${[light, mid, glow, p][i]}" opacity="${0.55 + i * 0.12}"/>`).join(""),
  ][variant % VARIANTS];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${mix(p, "#ffffff", 0.6)}"/></linearGradient>
    <radialGradient id="v" cx="50%" cy="45%" r="75%"><stop offset=".6" stop-color="${deep}" stop-opacity="0"/><stop offset="1" stop-color="${deep}" stop-opacity=".28"/></radialGradient>
    <filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .06 0"/></filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  ${shapes}
  <rect width="100%" height="100%" fill="url(#v)"/>
  <rect width="100%" height="100%" filter="url(#n)"/>
</svg>`;
}

// Makes (or reuses) one placeholder file and returns its URL.
async function makeOne({ dir, urlPrefix, colors, variant, wide }) {
  const key = crypto.createHash("sha1").update(`${colors.primary}${colors.accent}${variant}${wide}`).digest("hex").slice(0, 10);
  const stem = `placeholder-${wide ? "wide" : "photo"}-${variant}-${key}`;
  const svg = svgFor(colors, variant, wide);
  await fs.mkdir(dir, { recursive: true });
  if (!sharp) {
    const file = `${stem}.svg`;
    await fs.writeFile(path.join(dir, file), svg).catch(() => {});
    return `${urlPrefix}${file}`;
  }
  const big = path.join(dir, `${stem}-o.webp`);
  try {
    await fs.access(big);
  } catch {
    const img = sharp(Buffer.from(svg));
    await img.clone().webp({ quality: 80 }).toFile(big);
    await img.clone().resize({ width: 800 }).webp({ quality: 78 }).toFile(path.join(dir, `${stem}-o-sm.webp`));
  }
  return `${urlPrefix}${stem}-o.webp`;
}

/**
 * Fills every empty picture spot in a site with a placeholder:
 * image blocks, empty galleries and "image" section backgrounds.
 * Returns the same site object (mutated).
 */
export async function fillPlaceholders(site, { dir, urlPrefix }) {
  const colors = { primary: site.theme.colors.primary, accent: site.theme.colors.accent };
  let n = 0;
  const next = (wide = false) => makeOne({ dir, urlPrefix, colors, variant: n++ % VARIANTS, wide });
  for (const page of site.pages) {
    for (const section of page.sections) {
      if (section.props.background === "image" && !section.props.image) section.props.image = await next(true);
      for (const column of section.columns) {
        for (const block of column.blocks) {
          if (block.type === "image" && !block.props.src) block.props.src = await next();
          if (block.type === "gallery" && !block.props.images.some((i) => i.src)) {
            block.props.images = [];
            for (let i = 0; i < 6; i++) block.props.images.push({ src: await next(), alt: "" });
          }
        }
      }
    }
  }
  return site;
}

export function isPlaceholder(url) {
  return /\/placeholder-[\w-]+\.(webp|svg)$/.test(String(url || ""));
}
