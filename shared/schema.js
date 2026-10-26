// Site document model shared by the server, the AI layer and the editor.
//
// A site is plain JSON:
//   site.theme      colours, fonts, corner radius
//   site.header     logo + nav (nav links are built from pages unless overridden)
//   site.footer     footer text + links
//   site.pages[]    each page has sections[]
//   section         { id, type: "section", props, columns: [{ id, blocks: [] }] }
//   block           { id, type, props }
//
// normalizeSite() is the single gatekeeper: everything that comes from the AI,
// the editor or disk passes through it, so unknown block types and bad values
// never reach the renderer.

export const SCHEMA_VERSION = 1;

export function uid(prefix = "b") {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return prefix + "_" + Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

export const FONT_CHOICES = {
  system: { label: "System (fastest)", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  serif: { label: "Classic serif", stack: 'Georgia, Cambria, "Times New Roman", serif' },
  rounded: { label: "Rounded", stack: 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif' },
  mono: { label: "Monospace", stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
  // Web fonts: loaded from Google Fonts with display=swap. One extra request each.
  inter: { label: "Inter", stack: '"Inter", system-ui, sans-serif', google: "Inter:wght@400;600;700" },
  poppins: { label: "Poppins", stack: '"Poppins", system-ui, sans-serif', google: "Poppins:wght@400;600;700" },
  playfair: { label: "Playfair Display", stack: '"Playfair Display", Georgia, serif', google: "Playfair+Display:wght@400;700" },
  lora: { label: "Lora", stack: '"Lora", Georgia, serif', google: "Lora:wght@400;600;700" },
  montserrat: { label: "Montserrat", stack: '"Montserrat", system-ui, sans-serif', google: "Montserrat:wght@400;600;700" },
  dmsans: { label: "DM Sans", stack: '"DM Sans", system-ui, sans-serif', google: "DM+Sans:wght@400;600;700" },
  roboto: { label: "Roboto", stack: '"Roboto", system-ui, sans-serif', google: "Roboto:wght@400;500;700" },
  opensans: { label: "Open Sans", stack: '"Open Sans", system-ui, sans-serif', google: "Open+Sans:wght@400;600;700" },
  lato: { label: "Lato", stack: '"Lato", system-ui, sans-serif', google: "Lato:wght@400;700" },
  nunito: { label: "Nunito", stack: '"Nunito", system-ui, sans-serif', google: "Nunito:wght@400;600;700" },
  worksans: { label: "Work Sans", stack: '"Work Sans", system-ui, sans-serif', google: "Work+Sans:wght@400;600;700" },
  raleway: { label: "Raleway", stack: '"Raleway", system-ui, sans-serif', google: "Raleway:wght@400;600;700" },
  oswald: { label: "Oswald (tall, condensed)", stack: '"Oswald", "Arial Narrow", sans-serif', google: "Oswald:wght@400;500;700" },
  bebas: { label: "Bebas Neue (headline caps)", stack: '"Bebas Neue", "Arial Narrow", sans-serif', google: "Bebas+Neue" },
  merriweather: { label: "Merriweather", stack: '"Merriweather", Georgia, serif', google: "Merriweather:wght@400;700" },
  cormorant: { label: "Cormorant Garamond", stack: '"Cormorant Garamond", Georgia, serif', google: "Cormorant+Garamond:wght@400;600;700" },
  baskerville: { label: "Libre Baskerville", stack: '"Libre Baskerville", Georgia, serif', google: "Libre+Baskerville:wght@400;700" },
  dancing: { label: "Dancing Script (handwritten)", stack: '"Dancing Script", cursive', google: "Dancing+Script:wght@400;700" },
  pacifico: { label: "Pacifico (fun script)", stack: '"Pacifico", cursive', google: "Pacifico" },
};

export const DEFAULT_THEME = {
  colors: {
    primary: "#2563eb",
    accent: "#f59e0b",
    background: "#ffffff",
    surface: "#f4f6fb",
    text: "#111827",
    muted: "#6b7280",
    dark: "#0f172a",
  },
  fonts: { heading: "system", body: "system" },
  radius: 10,
  // Site-wide styling, like Elementor's "Site settings".
  buttons: { size: "md", shape: "theme", weight: 600, uppercase: false, hover: "lift", shadow: false },
  type: { base: 17, headingScale: 100, headingWeight: 700 },
  layout: { width: 1140, spacing: 100, motion: "none" },
};

export const HOVER_EFFECTS = ["none", "lift", "grow", "shrink", "glow", "brighten", "pulse", "wobble", "shine"];
export const HOVER_LABELS = ["None", "Lift up", "Grow", "Shrink", "Glow", "Brighten", "Pulse", "Wobble", "Shine sweep"];
export const ENTRANCE_EFFECTS = ["none", "fade", "fade-up", "fade-down", "fade-left", "fade-right", "zoom", "zoom-out", "flip"];
export const ENTRANCE_LABELS = ["None", "Fade in", "Fade up", "Fade down", "Slide in from left", "Slide in from right", "Zoom in", "Zoom out", "Flip up"];
export const SHADOWS = ["none", "sm", "md", "lg", "xl"];
export const BG_POSITIONS = ["center", "top", "bottom", "left", "right", "top left", "top right", "bottom left", "bottom right"];
export const BG_EFFECTS = ["fade", "zoom", "zoom-out", "pan", "parallax"];
export const BG_EFFECT_LABELS = ["Fade in", "Slow zoom (Ken Burns)", "Zoom out as it appears", "Slow pan", "Parallax (moves as you scroll)"];

// ---------------------------------------------------------------------------
// Block definitions. `fields` drives the editor's property panel; `defaults`
// is what a freshly dropped block looks like.
// ---------------------------------------------------------------------------

const ALIGN = { type: "select", options: ["left", "center", "right"] };

export const BLOCKS = {
  heading: {
    label: "Heading", icon: "H", group: "Basic",
    defaults: () => ({ text: "Your heading here", level: 2, align: "left" }),
    fields: [
      { key: "text", label: "Text", type: "text" },
      { key: "level", label: "Size", type: "select", options: [1, 2, 3, 4], labels: ["H1 – Page title", "H2 – Section", "H3 – Sub-heading", "H4 – Small"] },
      { key: "align", label: "Align", ...ALIGN },
    ],
  },
  text: {
    label: "Text", icon: "¶", group: "Basic",
    defaults: () => ({ html: "<p>Write something great about this business.</p>", align: "left" }),
    fields: [
      { key: "html", label: "Text", type: "richtext" },
      { key: "align", label: "Align", ...ALIGN },
    ],
  },
  buttons: {
    label: "Buttons", icon: "▭", group: "Basic",
    defaults: () => ({ items: [{ text: "Get in touch", href: "#contact", style: "primary" }], align: "left" }),
    fields: [
      { key: "items", label: "Buttons", type: "list", itemLabel: "text", itemDefaults: () => ({ text: "Button", href: "#", style: "primary", icon: "none" }), itemFields: [
        { key: "text", label: "Label", type: "text" },
        { key: "href", label: "Link", type: "url" },
        { key: "style", label: "Style", type: "select", options: ["primary", "secondary", "outline", "light", "dark", "link"], labels: ["Main colour", "Accent colour", "Outline", "White", "Dark", "Text link"] },
        { key: "icon", label: "Icon", type: "select", options: ["none", "arrow", "phone", "email", "download", "play", "cart", "check"], labels: ["None", "→ Arrow", "☎ Phone", "✉ Email", "↓ Download", "▶ Play", "🛒 Basket", "✓ Tick"] },
      ] },
      { key: "align", label: "Align", ...ALIGN },
    ],
  },
  logo: {
    label: "Logo", icon: "◎", group: "Basic",
    defaults: () => ({ image: "", height: 80, align: "center", link: true }),
    fields: [
      { key: "image", label: "Image (leave empty to use the site logo)", type: "image" },
      { key: "height", label: "Size", type: "slider", min: 20, max: 400, placeholder: 80 },
      { key: "align", label: "Align", ...ALIGN },
      { key: "link", label: "Clicking it goes to the home page", type: "checkbox" },
    ],
  },
  image: {
    label: "Image", icon: "▣", group: "Basic",
    defaults: () => ({ src: "", alt: "", ratio: "auto", rounded: true, caption: "" }),
    fields: [
      { key: "src", label: "Image", type: "image" },
      { key: "alt", label: "Alt text (describe the image)", type: "text" },
      { key: "ratio", label: "Shape", type: "select", options: ["auto", "16:9", "4:3", "1:1", "3:4"] },
      { key: "rounded", label: "Rounded corners", type: "checkbox" },
      { key: "caption", label: "Caption", type: "text" },
    ],
  },
  list: {
    label: "List", icon: "☰", group: "Basic",
    defaults: () => ({ items: ["First point", "Second point", "Third point"], icon: "check" }),
    fields: [
      { key: "items", label: "Items", type: "lines" },
      { key: "icon", label: "Bullet", type: "select", options: ["check", "dot", "number", "none"] },
    ],
  },
  card: {
    label: "Card", icon: "▤", group: "Content",
    defaults: () => ({ icon: "★", image: "", title: "Feature title", text: "A short description of this feature or service.", linkText: "", href: "", style: "surface", align: "left" }),
    fields: [
      { key: "icon", label: "Icon (emoji)", type: "text" },
      { key: "image", label: "Image", type: "image" },
      { key: "title", label: "Title", type: "text" },
      { key: "text", label: "Text", type: "textarea" },
      { key: "linkText", label: "Link text", type: "text" },
      { key: "href", label: "Link", type: "url" },
      { key: "style", label: "Style", type: "select", options: ["surface", "outline", "plain", "shadow"] },
      { key: "align", label: "Align", ...ALIGN },
    ],
  },
  pricing: {
    label: "Price box", icon: "£", group: "Content",
    defaults: () => ({ name: "Standard", price: "£49", period: "/month", features: ["Feature one", "Feature two"], buttonText: "Choose plan", href: "#contact", featured: false }),
    fields: [
      { key: "name", label: "Plan name", type: "text" },
      { key: "price", label: "Price", type: "text" },
      { key: "period", label: "Period", type: "text" },
      { key: "features", label: "Features", type: "lines" },
      { key: "buttonText", label: "Button", type: "text" },
      { key: "href", label: "Button link", type: "url" },
      { key: "featured", label: "Highlight this plan", type: "checkbox" },
    ],
  },
  testimonial: {
    label: "Testimonial", icon: "❝", group: "Content",
    defaults: () => ({ quote: "Fantastic service from start to finish. Highly recommended!", name: "Happy customer", role: "", image: "", rating: 5 }),
    fields: [
      { key: "quote", label: "Quote", type: "textarea" },
      { key: "name", label: "Name", type: "text" },
      { key: "role", label: "Role / company", type: "text" },
      { key: "image", label: "Photo", type: "image" },
      { key: "rating", label: "Stars", type: "select", options: [0, 1, 2, 3, 4, 5] },
    ],
  },
  stats: {
    label: "Stats", icon: "#", group: "Content",
    defaults: () => ({ items: [{ value: "10+", label: "Years experience" }, { value: "500", label: "Happy clients" }, { value: "24/7", label: "Support" }] }),
    fields: [
      { key: "items", label: "Stats", type: "list", itemLabel: "label", itemDefaults: () => ({ value: "100", label: "Label" }), itemFields: [
        { key: "value", label: "Number", type: "text" },
        { key: "label", label: "Label", type: "text" },
      ] },
    ],
  },
  faq: {
    label: "FAQ", icon: "?", group: "Content",
    defaults: () => ({ items: [{ q: "What areas do you cover?", a: "We cover the whole city and surrounding areas." }, { q: "How do I book?", a: "Use the contact form or give us a call." }] }),
    fields: [
      { key: "items", label: "Questions", type: "list", itemLabel: "q", itemDefaults: () => ({ q: "Question?", a: "Answer." }), itemFields: [
        { key: "q", label: "Question", type: "text" },
        { key: "a", label: "Answer", type: "textarea" },
      ] },
    ],
  },
  gallery: {
    label: "Gallery", icon: "▦", group: "Media",
    defaults: () => ({ images: [], columns: 3, tabletColumns: null, mobileColumns: 2, rows: 0, gap: 12, ratio: "1:1", layout: "grid", hover: "zoom", lightbox: true, captions: false }),
    fields: [
      { key: "images", label: "Images", type: "list", itemLabel: "alt", itemDefaults: () => ({ src: "", alt: "" }), itemFields: [
        { key: "src", label: "Image", type: "image" },
        { key: "alt", label: "Alt text / caption", type: "text" },
      ] },
      { key: "columns", label: "Columns (desktop)", type: "slider", min: 1, max: 8, placeholder: 3, unit: "" },
      { key: "tabletColumns", label: "Columns on tablets", type: "slider", min: 1, max: 6, placeholder: "auto", unit: "" },
      { key: "mobileColumns", label: "Columns on phones", type: "slider", min: 1, max: 4, placeholder: 2, unit: "" },
      { key: "rows", label: "Rows to show (0 = all)", type: "slider", min: 0, max: 12, placeholder: 0, unit: "" },
      { key: "gap", label: "Space between photos", type: "slider", min: 0, max: 48, placeholder: 12 },
      { key: "ratio", label: "Photo shape", type: "select", options: ["1:1", "4:3", "3:2", "16:9", "3:4", "auto"], labels: ["Square", "4:3", "3:2", "Wide 16:9", "Portrait 3:4", "Original shape"] },
      { key: "layout", label: "Layout", type: "select", options: ["grid", "masonry"], labels: ["Grid (rows line up)", "Masonry (Pinterest-style)"] },
      { key: "hover", label: "Hover effect", type: "select", options: ["zoom", "darken", "colour", "lift", "none"], labels: ["Zoom in", "Darken", "Black & white → colour", "Lift up", "None"] },
      { key: "lightbox", label: "Click a photo to see it full size", type: "checkbox" },
      { key: "captions", label: "Show captions (from the alt text)", type: "checkbox" },
    ],
  },
  video: {
    label: "Video", icon: "▶", group: "Media",
    defaults: () => ({ url: "", title: "Video" }),
    fields: [
      { key: "url", label: "YouTube or Vimeo link", type: "url" },
      { key: "title", label: "Title (for accessibility)", type: "text" },
    ],
  },
  map: {
    label: "Map", icon: "⌖", group: "Media",
    defaults: () => ({ address: "London, UK", height: 320 }),
    fields: [
      { key: "address", label: "Address", type: "text" },
      { key: "height", label: "Height (px)", type: "number" },
    ],
  },
  form: {
    label: "Contact form", icon: "✉", group: "Content",
    defaults: () => ({
      fields: [
        { label: "Name", type: "text", required: true },
        { label: "Email", type: "email", required: true },
        { label: "Message", type: "textarea", required: true },
      ],
      submitText: "Send message",
      successMessage: "Thanks! We'll be in touch soon.",
    }),
    fields: [
      { key: "fields", label: "Fields", type: "list", itemLabel: "label", itemDefaults: () => ({ label: "Phone", type: "tel", required: false }), itemFields: [
        { key: "label", label: "Label", type: "text" },
        { key: "type", label: "Type", type: "select", options: ["text", "email", "tel", "textarea"] },
        { key: "required", label: "Required", type: "checkbox" },
      ] },
      { key: "submitText", label: "Button text", type: "text" },
      { key: "successMessage", label: "Thank-you message", type: "text" },
    ],
  },
  spacer: {
    label: "Spacer", icon: "↕", group: "Layout",
    defaults: () => ({ size: 32 }),
    fields: [{ key: "size", label: "Height (px)", type: "number" }],
  },
  divider: {
    label: "Divider", icon: "—", group: "Layout",
    defaults: () => ({}),
    fields: [],
  },
  html: {
    label: "Custom code", icon: "</>", group: "Layout",
    defaults: () => ({ code: "<div style=\"padding:1rem;border:1px dashed currentColor\">Custom HTML</div>" }),
    fields: [{ key: "code", label: "HTML (rendered as-is)", type: "code" }],
  },
};

export const SECTION_FIELDS = [
  { key: "layout", label: "Columns", type: "select", options: ["1", "1-1", "2-1", "1-2", "1-1-1", "1-1-1-1"], labels: ["1 column", "2 equal", "2 (wide left)", "2 (wide right)", "3 equal", "4 equal"] },
  { key: "background", label: "Background", type: "select", options: ["default", "surface", "primary", "dark", "image"] },
  { key: "image", label: "Background image", type: "image", showIf: { background: "image" } },
  { key: "overlay", label: "Darken image (%)", type: "number", hidden: true }, // default tint; edited in the Style tab
  { key: "padding", label: "Spacing", type: "select", options: ["none", "sm", "md", "lg", "xl"] },
  { key: "width", label: "Content width", type: "select", options: ["narrow", "normal", "wide", "full"] },
  { key: "align", label: "Text align", type: "select", options: ["left", "center"] },
  { key: "valign", label: "Vertical align", type: "select", options: ["top", "center"] },
  { key: "minHeight", label: "Tall section (hero)", type: "checkbox" },
  { key: "anchor", label: "Anchor id (for #links)", type: "text" },
];

export const SECTION_DEFAULTS = () => ({
  layout: "1", background: "default", image: "", overlay: 45, padding: "lg",
  width: "normal", align: "left", valign: "top", minHeight: false, anchor: "",
});

export const LAYOUT_COLUMNS = { "1": 1, "1-1": 2, "2-1": 2, "1-2": 2, "1-1-1": 3, "1-1-1-1": 4 };

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export function createBlock(type, props = {}) {
  const def = BLOCKS[type];
  if (!def) throw new Error(`Unknown block type: ${type}`);
  return { id: uid("b"), type, props: { ...def.defaults(), ...props } };
}

export function createSection(props = {}, columnBlocks = null) {
  const p = { ...SECTION_DEFAULTS(), ...props };
  const count = LAYOUT_COLUMNS[p.layout] || 1;
  const columns = Array.from({ length: count }, (_, i) => ({
    id: uid("c"),
    blocks: (columnBlocks && columnBlocks[i]) || [],
  }));
  return { id: uid("s"), type: "section", props: p, columns };
}

export function createPage(title = "New page", slug = "") {
  return {
    id: uid("p"),
    title,
    slug: slug || slugify(title),
    seo: { title: "", description: "" },
    sections: [],
  };
}

export function createEmptySite(name = "New site") {
  const home = createPage("Home", "index");
  return normalizeSite({
    name,
    theme: structuredClone(DEFAULT_THEME),
    header: { logoText: name, logoImage: "", ctaText: "", ctaHref: "", sticky: true },
    footer: { text: `© ${new Date().getFullYear()} ${name}. All rights reserved.`, links: [] },
    pages: [home],
    customCss: "",
  });
}

export function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "page";
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const str = (v, fallback = "") => (typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeColor(v, fallback) {
  return typeof v === "string" && HEX.test(v.trim()) ? v.trim() : fallback;
}

function normalizeTheme(theme) {
  const t = isObj(theme) ? theme : {};
  const colors = isObj(t.colors) ? t.colors : {};
  const fonts = isObj(t.fonts) ? t.fonts : {};
  const out = { colors: {}, fonts: {}, radius: DEFAULT_THEME.radius };
  for (const [k, def] of Object.entries(DEFAULT_THEME.colors)) out.colors[k] = normalizeColor(colors[k], def);
  for (const k of ["heading", "body"]) out.fonts[k] = FONT_CHOICES[fonts[k]] ? fonts[k] : DEFAULT_THEME.fonts[k];
  const r = Number(t.radius);
  out.radius = Number.isFinite(r) ? Math.max(0, Math.min(32, Math.round(r))) : DEFAULT_THEME.radius;
  const pick = (v, options, fallback) => (options.includes(v) ? v : fallback);
  const b = isObj(t.buttons) ? t.buttons : {}, bd = DEFAULT_THEME.buttons;
  out.buttons = {
    size: pick(b.size, ["sm", "md", "lg", "xl"], bd.size),
    shape: pick(b.shape, ["theme", "square", "rounded", "pill"], bd.shape),
    weight: pick(Number(b.weight), [400, 500, 600, 700, 800], bd.weight),
    uppercase: typeof b.uppercase === "boolean" ? b.uppercase : bd.uppercase,
    hover: pick(b.hover, HOVER_EFFECTS, bd.hover),
    shadow: typeof b.shadow === "boolean" ? b.shadow : bd.shadow,
  };
  const ty = isObj(t.type) ? t.type : {}, td = DEFAULT_THEME.type;
  out.type = {
    base: clampNum(ty.base, 14, 22, td.base),
    headingScale: clampNum(ty.headingScale, 60, 160, td.headingScale),
    headingWeight: pick(Number(ty.headingWeight), [300, 400, 500, 600, 700, 800, 900], td.headingWeight),
  };
  const ly = isObj(t.layout) ? t.layout : {}, ld = DEFAULT_THEME.layout;
  out.layout = {
    width: clampNum(ly.width, 720, 1600, ld.width),
    spacing: clampNum(ly.spacing, 25, 200, ld.spacing),
    motion: pick(ly.motion, ENTRANCE_EFFECTS, ld.motion),
  };
  return out;
}

function normalizeField(field, value, fallback) {
  switch (field.type) {
    case "select": {
      const match = field.options.find((o) => String(o) === String(value));
      return match !== undefined ? match : fallback;
    }
    case "checkbox":
      return typeof value === "boolean" ? value : fallback;
    case "number":
    case "slider": {
      const n = Number(value);
      return value !== null && value !== "" && Number.isFinite(n) ? n : fallback;
    }
    case "lines":
      return Array.isArray(value) ? value.map((v) => str(v)).filter((v) => v !== "") : fallback;
    case "list": {
      if (!Array.isArray(value)) return fallback;
      return value.filter(isObj).map((item) => {
        const defaults = field.itemDefaults();
        const out = {};
        for (const f of field.itemFields) out[f.key] = normalizeField(f, item[f.key], defaults[f.key]);
        return out;
      });
    }
    default:
      return value === undefined || value === null ? fallback : str(value, fallback);
  }
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  return v !== "" && v !== null && v !== undefined && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

// Per-element styling (Elementor's Style + Advanced tabs). Only values that
// were actually set are kept, so untouched elements stay `style: {}`-free.
//   margin / padding: { d|t|m: { t, r, b, l } } in px, per device
//   radius, borderWidth, fontSize, maxWidth, gap: px
//   bg, bg2 (gradient end), color, borderColor: hex
//   borderStyle, shadow, fontWeight, animation, speed, delay (ms), hover, btnSize
//   fontFamily (FONT_CHOICES key), lineHeight (%), letterSpacing (px), textTransform, italic
//   hide: { d, t, m }
export const DEVICES = ["d", "t", "m"];
const SIDES = ["t", "r", "b", "l"];
export function normalizeStyle(style) {
  if (!isObj(style)) return undefined;
  const out = {};
  for (const box of ["margin", "padding"]) {
    const src = isObj(style[box]) ? style[box] : {};
    const dev = {};
    for (const d of DEVICES) {
      const v = isObj(src[d]) ? src[d] : {};
      const sides = {};
      for (const k of SIDES) {
        const n = clampNum(v[k], box === "margin" ? -400 : 0, 600, null);
        if (n !== null) sides[k] = n;
      }
      if (Object.keys(sides).length) dev[d] = sides;
    }
    if (Object.keys(dev).length) out[box] = dev;
  }
  const num = (k, min, max) => { const n = clampNum(style[k], min, max, null); if (n !== null) out[k] = n; };
  num("radius", 0, 999); num("borderWidth", 0, 30); num("fontSize", 8, 160); num("maxWidth", 40, 2400); num("gap", 0, 200); num("delay", 0, 3000);
  for (const k of ["bg", "bg2", "color", "borderColor"]) if (typeof style[k] === "string" && HEX.test(style[k].trim())) out[k] = style[k].trim();
  const one = (k, options) => { if (options.includes(style[k])) out[k] = style[k]; };
  one("borderStyle", ["solid", "dashed", "dotted", "double"]);
  one("shadow", SHADOWS.slice(1));
  one("animation", ENTRANCE_EFFECTS); // "none" is kept: it switches off the site-wide animation
  one("speed", ["fast", "slow"]);
  one("hover", HOVER_EFFECTS);
  one("btnSize", ["sm", "md", "lg", "xl"]);
  one("align", ["left", "center", "right"]);
  // Background image (blocks; sections use props.image) and its settings.
  for (const k of ["bgImage", "bgImageMobile", "bgVideo"]) {
    const v = str(style[k]).trim();
    if (/^(\/|https?:\/\/)/.test(v)) out[k] = v;
  }
  one("bgPos", BG_POSITIONS);
  one("bgSize", ["contain"]);
  if (style.bgFixed === true) out.bgFixed = true;
  if (style.bgRepeat === true) out.bgRepeat = true;
  if (style.bgVideoPhones === true) out.bgVideoPhones = true;
  for (const k of ["tint", "tint2"]) if (typeof style[k] === "string" && HEX.test(style[k].trim())) out[k] = style[k].trim();
  one("tintDir", ["up", "right", "left", "diagonal", "radial"]);
  one("bgEffect", BG_EFFECTS);
  num("tintOpacity", 0, 100); num("bgBlur", 0, 30); num("bgGray", 0, 100); num("bgBright", 20, 200); num("minHeight", 0, 1400);
  if (FONT_CHOICES[style.fontFamily]) out.fontFamily = style.fontFamily;
  num("lineHeight", 80, 300); // % of the font size
  num("letterSpacing", -5, 30);
  one("textTransform", ["uppercase", "lowercase", "capitalize", "none"]);
  if (style.italic === true) out.italic = true;
  const fw = Number(style.fontWeight);
  if ([300, 400, 500, 600, 700, 800, 900].includes(fw)) out.fontWeight = fw;
  if (isObj(style.hide)) {
    const hide = {};
    for (const d of DEVICES) if (style.hide[d] === true) hide[d] = true;
    if (Object.keys(hide).length) out.hide = hide;
  }
  return Object.keys(out).length ? out : undefined;
}

// Header menu link styling (like Elementor's Nav Menu widget).
export const MENU_HOVERS = ["color", "underline", "overline", "pill", "none"];
export function normalizeMenu(menu) {
  if (!isObj(menu)) return undefined;
  const out = {};
  if (FONT_CHOICES[menu.font]) out.font = menu.font;
  for (const [k, min, max] of [["size", 10, 40], ["letterSpacing", -3, 20], ["gap", 0, 80]]) {
    const n = clampNum(menu[k], min, max, null);
    if (n !== null) out[k] = n;
  }
  const w = Number(menu.weight);
  if ([300, 400, 500, 600, 700, 800, 900].includes(w)) out.weight = w;
  if (["uppercase", "lowercase", "capitalize", "none"].includes(menu.transform)) out.transform = menu.transform;
  for (const k of ["color", "hoverColor", "activeColor"]) if (typeof menu[k] === "string" && HEX.test(menu[k].trim())) out[k] = menu[k].trim();
  if (MENU_HOVERS.includes(menu.hover)) out.hover = menu.hover;
  if (["left", "center"].includes(menu.align)) out.align = menu.align;
  return Object.keys(out).length ? out : undefined;
}

function withStyle(node, style) {
  const st = normalizeStyle(style);
  if (st) node.style = st;
  return node;
}

export function normalizeBlock(block) {
  if (!isObj(block) || !BLOCKS[block.type]) return null;
  const def = BLOCKS[block.type];
  const defaults = def.defaults();
  const props = isObj(block.props) ? block.props : {};
  const out = {};
  for (const f of def.fields) out[f.key] = normalizeField(f, props[f.key], defaults[f.key]);
  // Keep defaults for keys without editor fields (none today, but future-proof).
  for (const k of Object.keys(defaults)) if (!(k in out)) out[k] = defaults[k];
  return withStyle({ id: str(block.id) || uid("b"), type: block.type, props: out }, block.style);
}

export function normalizeSection(section) {
  if (!isObj(section)) return null;
  const defaults = SECTION_DEFAULTS();
  const props = isObj(section.props) ? section.props : {};
  const p = {};
  for (const f of SECTION_FIELDS) p[f.key] = normalizeField(f, props[f.key], defaults[f.key]);
  p.overlay = Math.max(0, Math.min(90, p.overlay));
  p.anchor = p.anchor ? slugify(p.anchor) : "";

  const want = LAYOUT_COLUMNS[p.layout] || 1;
  let cols = Array.isArray(section.columns) ? section.columns.filter(isObj) : [];
  cols = cols.map((c) => ({
    id: str(c.id) || uid("c"),
    blocks: (Array.isArray(c.blocks) ? c.blocks : []).map(normalizeBlock).filter(Boolean),
  }));
  // Keep the column count in sync with the layout without losing content:
  // extra columns are merged into the last kept column.
  while (cols.length < want) cols.push({ id: uid("c"), blocks: [] });
  if (cols.length > want) {
    const extra = cols.splice(want);
    for (const c of extra) cols[want - 1].blocks.push(...c.blocks);
  }
  return withStyle({ id: str(section.id) || uid("s"), type: "section", props: p, columns: cols }, section.style);
}

export function normalizePage(page, index = 0) {
  if (!isObj(page)) return null;
  const title = str(page.title, index === 0 ? "Home" : "Page");
  let slug = index === 0 ? "index" : slugify(page.slug || title);
  if (index > 0 && slug === "index") slug = slugify(title) === "index" ? "home-2" : slugify(title);
  const seo = isObj(page.seo) ? page.seo : {};
  return {
    id: str(page.id) || uid("p"),
    title,
    slug,
    seo: { title: str(seo.title), description: str(seo.description) },
    sections: (Array.isArray(page.sections) ? page.sections : []).map(normalizeSection).filter(Boolean),
  };
}

export function normalizeSite(site) {
  const s = isObj(site) ? site : {};
  const name = str(s.name, "Untitled site").slice(0, 120) || "Untitled site";
  const header = isObj(s.header) ? s.header : {};
  const footer = isObj(s.footer) ? s.footer : {};
  let pages = (Array.isArray(s.pages) ? s.pages : []).map(normalizePage).filter(Boolean);
  if (!pages.length) pages = [normalizePage(createPage("Home", "index"), 0)];
  // Unique slugs
  const seen = new Set();
  for (const p of pages) {
    let slug = p.slug, n = 2;
    while (seen.has(slug)) slug = `${p.slug}-${n++}`;
    p.slug = slug;
    seen.add(slug);
  }
  const navLinks = Array.isArray(header.links) ? header.links.filter(isObj).map((l) => ({ text: str(l.text), href: str(l.href) })).filter((l) => l.text) : null;
  return {
    schemaVersion: SCHEMA_VERSION,
    name,
    theme: normalizeTheme(s.theme),
    header: {
      logoText: str(header.logoText, name),
      logoImage: str(header.logoImage),
      ctaText: str(header.ctaText),
      ctaHref: str(header.ctaHref),
      sticky: typeof header.sticky === "boolean" ? header.sticky : true,
      // null = build navigation from pages automatically
      links: navLinks && navLinks.length ? navLinks : null,
      logoHeight: clampNum(header.logoHeight, 20, 160, 40),
      logoHeightMobile: clampNum(header.logoHeightMobile, 16, 120, null), // null = same as desktop, capped
      logoTextSize: clampNum(header.logoTextSize, 12, 72, 20),
      ...(normalizeStyle(header.style) ? { style: normalizeStyle(header.style) } : {}),
      ...(normalizeMenu(header.menu) ? { menu: normalizeMenu(header.menu) } : {}),
      ctaStyle: ["primary", "secondary", "outline", "light", "dark"].includes(header.ctaStyle) ? header.ctaStyle : "primary",
    },
    footer: {
      text: str(footer.text, `© ${new Date().getFullYear()} ${name}`),
      links: Array.isArray(footer.links) ? footer.links.filter(isObj).map((l) => ({ text: str(l.text), href: str(l.href) })).filter((l) => l.text) : [],
      ...(normalizeStyle(footer.style) ? { style: normalizeStyle(footer.style) } : {}),
    },
    pages,
    customCss: str(s.customCss),
  };
}

// ---------------------------------------------------------------------------
// Tree helpers (used by the editor and the AI "edit selected element" flow)
// ---------------------------------------------------------------------------

export function findNode(site, id) {
  for (const page of site.pages) {
    for (let si = 0; si < page.sections.length; si++) {
      const section = page.sections[si];
      if (section.id === id) return { kind: "section", node: section, page, index: si, parent: page.sections };
      for (let ci = 0; ci < section.columns.length; ci++) {
        const column = section.columns[ci];
        if (column.id === id) return { kind: "column", node: column, page, section, index: ci, parent: section.columns };
        for (let bi = 0; bi < column.blocks.length; bi++) {
          const block = column.blocks[bi];
          if (block.id === id) return { kind: "block", node: block, page, section, column, index: bi, parent: column.blocks };
        }
      }
    }
  }
  return null;
}

// Gives every section/column/block in a subtree fresh ids (used for duplicate).
export function reId(node) {
  const copy = structuredClone(node);
  const walk = (n) => {
    if (n.type === "section") {
      n.id = uid("s");
      n.columns.forEach((c) => { c.id = uid("c"); c.blocks.forEach(walk); });
    } else {
      n.id = uid("b");
    }
  };
  walk(copy);
  return copy;
}
