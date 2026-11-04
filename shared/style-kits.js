// Style kits: whole-site looks in one click (fonts, colours, buttons,
// corners, spacing and motion), and colours taken from a logo.

const kit = (id, name, colors, fonts, radius, buttons, type, layout) => ({ id, name, colors, fonts, radius, buttons, type, layout });

export const STYLE_KITS = [
  kit("modern", "Modern", { primary: "#2563eb", accent: "#f59e0b", background: "#ffffff", surface: "#f3f6fb", text: "#0f172a", muted: "#64748b", dark: "#0b1220" }, ["inter", "inter"], 12, { size: "md", shape: "theme", weight: 600, uppercase: false, hover: "lift", shadow: false }, { base: 17, headingScale: 100, headingWeight: 700 }, { spacing: 100, motion: "fade-up" }),
  kit("elegant", "Elegant", { primary: "#7a5c3e", accent: "#b89b5e", background: "#fdfbf7", surface: "#f4efe6", text: "#2a2420", muted: "#7c736a", dark: "#221c17" }, ["cormorant", "lora"], 2, { size: "md", shape: "square", weight: 500, uppercase: true, hover: "brighten", shadow: false }, { base: 18, headingScale: 115, headingWeight: 600 }, { spacing: 120, motion: "fade" }),
  kit("bold", "Bold", { primary: "#e11d48", accent: "#facc15", background: "#ffffff", surface: "#f5f5f4", text: "#0c0a09", muted: "#57534e", dark: "#0c0a09" }, ["bebas", "inter"], 0, { size: "lg", shape: "square", weight: 700, uppercase: true, hover: "grow", shadow: false }, { base: 17, headingScale: 130, headingWeight: 400 }, { spacing: 110, motion: "fade-up" }),
  kit("minimal", "Minimal", { primary: "#111111", accent: "#6b7280", background: "#ffffff", surface: "#f6f6f6", text: "#111111", muted: "#6b6b6b", dark: "#111111" }, ["dmsans", "dmsans"], 4, { size: "md", shape: "rounded", weight: 500, uppercase: false, hover: "none", shadow: false }, { base: 17, headingScale: 95, headingWeight: 500 }, { spacing: 130, motion: "none" }),
  kit("playful", "Playful", { primary: "#7c3aed", accent: "#f472b6", background: "#fffdf8", surface: "#f5f0ff", text: "#1e1533", muted: "#6b6384", dark: "#1e1533" }, ["poppins", "nunito"], 22, { size: "lg", shape: "pill", weight: 700, uppercase: false, hover: "wobble", shadow: true }, { base: 17, headingScale: 110, headingWeight: 800 }, { spacing: 100, motion: "zoom" }),
  kit("luxury", "Luxury", { primary: "#c9a227", accent: "#e8d9a8", background: "#0e0e10", surface: "#17171a", text: "#f2efe6", muted: "#a39e90", dark: "#000000" }, ["playfair", "worksans"], 0, { size: "md", shape: "square", weight: 500, uppercase: true, hover: "shine", shadow: false }, { base: 17, headingScale: 110, headingWeight: 500 }, { spacing: 125, motion: "fade" }),
  kit("natural", "Natural", { primary: "#3f6b3a", accent: "#c27c3a", background: "#fbfaf5", surface: "#eef2e6", text: "#1f2a1c", muted: "#6a7464", dark: "#1c2a1a" }, ["lora", "nunito"], 14, { size: "md", shape: "rounded", weight: 600, uppercase: false, hover: "lift", shadow: false }, { base: 17, headingScale: 105, headingWeight: 600 }, { spacing: 105, motion: "fade-up" }),
  kit("friendly", "Warm & friendly", { primary: "#ea580c", accent: "#0d9488", background: "#fffaf5", surface: "#fdf0e4", text: "#2b1a0e", muted: "#7a6556", dark: "#2b1a0e" }, ["nunito", "nunito"], 18, { size: "md", shape: "pill", weight: 700, uppercase: false, hover: "lift", shadow: true }, { base: 18, headingScale: 100, headingWeight: 800 }, { spacing: 100, motion: "fade-up" }),
  kit("corporate", "Corporate", { primary: "#0f3d5c", accent: "#0ea5e9", background: "#ffffff", surface: "#f1f5f9", text: "#0f1d2a", muted: "#5b6b78", dark: "#0b2233" }, ["montserrat", "opensans"], 6, { size: "md", shape: "rounded", weight: 600, uppercase: false, hover: "brighten", shadow: false }, { base: 16, headingScale: 95, headingWeight: 700 }, { spacing: 95, motion: "fade" }),
  kit("fresh", "Fresh", { primary: "#0d9488", accent: "#facc15", background: "#ffffff", surface: "#ecfdf8", text: "#0b2b26", muted: "#557570", dark: "#06302a" }, ["worksans", "worksans"], 16, { size: "md", shape: "theme", weight: 600, uppercase: false, hover: "glow", shadow: false }, { base: 17, headingScale: 105, headingWeight: 700 }, { spacing: 100, motion: "fade-up" }),
];

/** Applies a kit to a site (mutates it). keepColours: keep the site's own colours. */
export function applyStyleKit(site, id, { keepColours = false } = {}) {
  const k = STYLE_KITS.find((x) => x.id === id);
  if (!k) return site;
  if (!keepColours) site.theme.colors = { ...k.colors };
  site.theme.fonts = { heading: k.fonts[0], body: k.fonts[1] };
  site.theme.radius = k.radius;
  site.theme.buttons = { ...k.buttons };
  site.theme.type = { ...k.type };
  site.theme.layout = { ...site.theme.layout, ...k.layout };
  return site;
}

// ---- colours from a logo ------------------------------------------------------

const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function mix(a, b, t) { const x = parse(a), y = parse(b); return hex(...x.map((v, i) => v + (y[i] - v) * t)); }
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

/**
 * A palette from an image's pixels (RGBA bytes): the most common strong
 * colour becomes the main colour, the most different strong colour the
 * accent; dark sections and light panels are shades of the main colour.
 * Returns null when the image has no real colour (e.g. black and white).
 */
export function paletteFromPixels(data) {
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue; // transparent
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const [, s, l] = hsl(rgb);
    if (s < 0.25 || l < 0.12 || l > 0.9) continue; // greys, near-black, near-white
    const key = rgb.map((v) => v >> 5).join(",");
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += rgb[0]; b.g += rgb[1]; b.b += rgb[2];
    buckets.set(key, b);
  }
  const colours = [...buckets.values()].filter((b) => b.n > 3).sort((a, b) => b.n - a.n).map((b) => [b.r / b.n, b.g / b.n, b.b / b.n]);
  if (!colours.length) return null;
  let primary = colours[0];
  // Very light main colours make poor buttons: darken them.
  if (hsl(primary)[2] > 0.62) primary = parse(mix(hex(...primary), "#000000", 0.35));
  const ph = hsl(primary)[0];
  const accent = colours.slice(1).find((c) => { const d = Math.abs(hsl(c)[0] - ph); return Math.min(d, 360 - d) > 40; });
  const p = hex(...primary);
  return {
    primary: p,
    accent: accent ? hex(...accent) : mix(p, "#f59e0b", 0.6),
    dark: mix(p, "#000000", 0.75),
    surface: mix(p, "#ffffff", 0.94),
  };
}
