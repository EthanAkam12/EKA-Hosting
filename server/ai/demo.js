// Offline provider used when no AI key is configured. It builds solid starter
// sites from built-in templates, using everything in the brief (contact
// details, colours, logo, pages) so the builder is useful straight away.
// AI-written copy and written change requests need a real provider.

import { createBlock as b, createSection as s, createPage, createEmptySite, slugify } from "../../shared/schema.js";

const PALETTES = [
  { primary: "#2563eb", accent: "#f59e0b", dark: "#0f172a", surface: "#f1f5fb" },
  { primary: "#0f766e", accent: "#f97316", dark: "#102a27", surface: "#f0f7f5" },
  { primary: "#7c3aed", accent: "#ec4899", dark: "#1e1530", surface: "#f6f3fd" },
  { primary: "#b45309", accent: "#0ea5e9", dark: "#1f1a14", surface: "#faf6f0" },
  { primary: "#be123c", accent: "#facc15", dark: "#1c1014", surface: "#fbf3f4" },
];

const STYLE_FONTS = {
  Modern: ["inter", "inter"],
  Classic: ["playfair", "lora"],
  Bold: ["montserrat", "inter"],
  Minimal: ["system", "system"],
  "Warm & friendly": ["poppins", "dmsans"],
  Luxury: ["playfair", "system"],
  Playful: ["poppins", "poppins"],
};
const VARIANT_FONTS = [["system", "system"], ["dmsans", "dmsans"], ["playfair", "system"]];

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hash = (str) => [...String(str)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

function about(brief) {
  const text = String(brief.description || "").trim().split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  return text || `${brief.name || "We"} provide friendly, reliable service you can count on.`;
}

function contactHtml(brief) {
  const rows = [];
  if (brief.phone) rows.push(`📞 <a href="tel:${esc(String(brief.phone).replace(/[^\d+]/g, ""))}">${esc(brief.phone)}</a>`);
  if (brief.email) rows.push(`✉️ <a href="mailto:${esc(brief.email)}">${esc(brief.email)}</a>`);
  if (brief.address) rows.push(`📍 ${esc(brief.address)}`);
  if (brief.hours) rows.push(`🕒 ${esc(brief.hours).replace(/\n/g, "<br>")}`);
  return rows.length ? `<p>${rows.join("<br>")}</p>` : "<p>Tell us what you need and we'll get back to you soon.</p>";
}

function plannedPages(brief) {
  const wanted = (brief.pages || []).filter((p) => p && p.toLowerCase() !== "home");
  // Contact always goes last in the menu.
  wanted.sort((a, b) => (a.toLowerCase() === "contact") - (b.toLowerCase() === "contact"));
  return wanted.map((title) => ({ title, slug: slugify(title) }));
}

// Mixes a hex colour towards another (amount 0-1).
function mix(hex, toward, amount) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b2] = [p(hex), p(toward)];
  return "#" + a.map((v, i) => Math.round(v + (b2[i] - v) * amount).toString(16).padStart(2, "0")).join("");
}

function headerLinks(brief) {
  const pages = plannedPages(brief);
  if (pages.length) return [{ text: "Home", href: "/" }, ...pages.map((p) => ({ text: p.title, href: `/${p.slug}` }))];
  return [{ text: "Services", href: "#services" }, { text: "About", href: "#about" }, { text: "Contact", href: "#contact" }];
}

function contactHref(brief) {
  return plannedPages(brief).some((p) => p.slug === "contact") ? "/contact" : "#contact";
}

const cards = () => [
  [b("card", { icon: "⚡", title: "Fast & reliable", text: "We turn up when we say we will and get the job done properly." })],
  [b("card", { icon: "★", title: "Quality first", text: "Experienced people, great materials and real attention to detail." })],
  [b("card", { icon: "✓", title: "Fair pricing", text: "Clear prices up front with no hidden extras." })],
];

function contactSection(brief, props = {}) {
  return s({ layout: "1-1", anchor: "contact", padding: "lg", valign: "top", ...props }, [
    [b("heading", { text: "Get in touch", level: 2 }), b("text", { html: contactHtml(brief) })],
    [b("form")],
  ]);
}

// Three clearly different home page layouts.
const LAYOUTS = [
  // 0: dark, centred hero
  (brief, name) => [
    s({ background: "image", overlay: 55, padding: "xl", minHeight: true, width: "narrow", align: "center" }, [[
      b("heading", { text: name, level: 1, align: "center" }),
      b("text", { html: `<p>${esc(about(brief))}</p>`, align: "center" }),
      b("buttons", { align: "center", items: [{ text: "Get in touch", href: contactHref(brief), style: "primary" }, { text: "Our services", href: "#services", style: "outline" }] }),
    ]]),
    s({ anchor: "services", width: "narrow", align: "center", padding: "lg" }, [[
      b("heading", { text: "What we do", level: 2, align: "center" }),
      b("text", { html: "<p>Everything you need, handled by people who care about getting it right.</p>", align: "center" }),
    ]]),
    s({ layout: "1-1-1", padding: "sm" }, cards()),
    s({ layout: "1-1", background: "surface", anchor: "about", valign: "center" }, [
      [b("image", { ratio: "4:3" })],
      [b("heading", { text: `Why choose ${name}?`, level: 2 }), b("text", { html: `<p>${esc(about(brief))}</p>` }), b("list", { items: ["Friendly, local team", "Fully insured", "Free, no-obligation quotes"] })],
    ]),
    s({ width: "narrow", anchor: "faq" }, [[b("heading", { text: "Frequently asked questions", level: 2, align: "center" }), b("faq")]]),
    contactSection(brief, { background: "dark" }),
  ],
  // 1: split hero with picture, stats band, shadow cards
  (brief, name) => [
    s({ layout: "1-1", padding: "xl", valign: "center" }, [
      [
        b("heading", { text: `Welcome to ${name}`, level: 1 }),
        b("text", { html: `<p>${esc(about(brief))}</p>` }),
        b("buttons", { items: [{ text: "Contact us", href: contactHref(brief), style: "primary" }] }),
      ],
      [b("image", { ratio: "4:3", rounded: true })],
    ]),
    s({ background: "primary", padding: "md" }, [[b("stats", { items: [{ value: "100%", label: "Satisfaction focused" }, { value: "Local", label: "Friendly team" }, { value: "Fast", label: "Response times" }] })]]),
    s({ anchor: "services", align: "center", width: "narrow" }, [[b("heading", { text: "Our services", level: 2, align: "center" })]]),
    s({ layout: "1-1-1", padding: "sm" }, cards().map(([c]) => [{ ...c, props: { ...c.props, style: "shadow" } }])),
    s({ background: "surface", anchor: "about", width: "narrow", align: "center" }, [[
      b("heading", { text: `About ${name}`, level: 2, align: "center" }),
      b("text", { html: `<p>${esc(about(brief))}</p>`, align: "center" }),
    ]]),
    s({ background: "dark", align: "center", width: "narrow", padding: "lg" }, [[
      b("heading", { text: "Ready when you are", level: 2, align: "center" }),
      b("buttons", { align: "center", items: [{ text: "Get a quote", href: contactHref(brief), style: "light" }] }),
    ]]),
    contactSection(brief),
  ],
  // 2: light and minimal, editorial feel
  (brief, name) => [
    s({ background: "surface", padding: "xl", width: "narrow" }, [[
      b("text", { html: `<p><strong>${esc(name)}</strong></p>` }),
      b("heading", { text: "Simple, honest and beautifully done.", level: 1 }),
      b("text", { html: `<p>${esc(about(brief))}</p>` }),
      b("buttons", { items: [{ text: "Say hello", href: contactHref(brief), style: "outline" }] }),
    ]]),
    s({ layout: "2-1", anchor: "services", valign: "top" }, [
      [b("heading", { text: "What we offer", level: 2 }), b("list", { icon: "dot", items: ["A personal, friendly service", "Experience you can rely on", "Clear prices, no surprises", "Happy to answer any questions"] })],
      [b("card", { icon: "☎", title: "Talk to us", text: "Not sure what you need? Get in touch and we'll help.", linkText: "Contact", href: contactHref(brief), style: "outline" })],
    ]),
    s({ anchor: "about" }, [[b("heading", { text: "A look at our work", level: 2 }), b("gallery", { columns: 3 })]]),
    s({ width: "narrow", background: "surface" }, [[b("heading", { text: "Questions", level: 2 }), b("faq")]]),
    contactSection(brief),
  ],
];

function baseSite(brief, variant) {
  const name = brief.name || "Your Business";
  const site = createEmptySite(name);
  const palette = PALETTES[(hash(name) + variant) % PALETTES.length];
  Object.assign(site.theme.colors, palette);
  // With brand colours, dark sections and light panels are shades of them.
  if (brief.colors?.primary) {
    site.theme.colors.primary = brief.colors.primary;
    if (brief.colors.accent) site.theme.colors.accent = brief.colors.accent;
    site.theme.colors.dark = mix(brief.colors.primary, "#000000", 0.72);
    site.theme.colors.surface = mix(brief.colors.primary, "#ffffff", 0.94);
  }
  const fonts = STYLE_FONTS[brief.style] || VARIANT_FONTS[variant % VARIANT_FONTS.length];
  site.theme.fonts = { heading: fonts[0], body: fonts[1] };
  site.theme.radius = [10, 16, 2][variant % 3];
  site.header.ctaText = "Get in touch";
  site.header.ctaHref = contactHref(brief);
  site.header.links = headerLinks(brief);
  const bits = [brief.phone, brief.email].filter(Boolean).join(" · ");
  site.footer.text = `© ${new Date().getFullYear()} ${name}${bits ? ` · ${bits}` : ""}`;
  return { site, name };
}

const EXTRA_PAGES = {
  about: (brief, name) => [
    s({ background: "surface", width: "narrow", align: "center" }, [[b("heading", { text: `About ${name}`, level: 1, align: "center" })]]),
    s({ layout: "1-1", valign: "center" }, [[b("text", { html: `<p>${esc(about(brief))}</p>` }), b("list")], [b("image", { ratio: "4:3" })]]),
  ],
  services: () => [
    s({ background: "surface", width: "narrow", align: "center" }, [[b("heading", { text: "Our services", level: 1, align: "center" })]]),
    s({ layout: "1-1-1" }, cards()),
  ],
  gallery: () => [
    s({ background: "surface", width: "narrow", align: "center" }, [[b("heading", { text: "Gallery", level: 1, align: "center" })]]),
    s({}, [[b("gallery", { columns: 3 })]]),
  ],
  contact: (brief) => [
    s({ background: "surface", width: "narrow", align: "center" }, [[b("heading", { text: "Contact us", level: 1, align: "center" })]]),
    contactSection(brief),
    ...(brief.address ? [s({ padding: "sm" }, [[b("map", { address: brief.address })]])] : []),
  ],
};

// ---- single pages, three looks each (for "design each page" in the wizard) --

const PAGE_INTROS = {
  about: "The people and the story behind the business.",
  services: "What we do, and how we can help.",
  gallery: "A look at our work.",
  contact: "We'd love to hear from you.",
  faq: "Answers to the questions we're asked most.",
  pricing: "Clear prices, no surprises.",
};

function pageIntro(brief, title) {
  const info = String(brief.pageInfo?.[title] || "").trim();
  return info || PAGE_INTROS[slugify(title)] || `Find out more about ${brief.name || "us"}.`;
}

const PAGE_HEADERS = [
  (title, intro) => s({ background: "surface", width: "narrow", align: "center", padding: "lg" }, [[b("heading", { text: title, level: 1, align: "center" }), b("text", { html: `<p>${esc(intro)}</p>`, align: "center" })]]),
  (title, intro) => s({ background: "dark", padding: "xl" }, [[b("heading", { text: title, level: 1 }), b("text", { html: `<p>${esc(intro)}</p>` })]]),
  (title, intro) => s({ background: "image", overlay: 50, padding: "xl", align: "center", width: "narrow" }, [[b("heading", { text: title, level: 1, align: "center" }), b("text", { html: `<p>${esc(intro)}</p>`, align: "center" })]]),
];

const PAGE_BODIES = {
  about: [
    (brief) => [s({ layout: "1-1", valign: "center" }, [[b("heading", { text: "Our story", level: 2 }), b("text", { html: `<p>${esc(about(brief))}</p>` }), b("list")], [b("image", { ratio: "4:3" })]])],
    (brief, name) => [s({ background: "surface" }, [[b("stats")]]), s({ width: "narrow", align: "center" }, [[b("heading", { text: `Why people choose ${name}`, level: 2, align: "center" }), b("text", { html: `<p>${esc(about(brief))}</p>`, align: "center" })]])],
    (brief) => [s({ layout: "1-2", valign: "center" }, [[b("image", { ratio: "3:4" })], [b("heading", { text: "Who we are", level: 2 }), b("text", { html: `<p>${esc(about(brief))}</p>` })]]), s({ layout: "1-1-1", background: "surface" }, cards())],
  ],
  services: [
    () => [s({ layout: "1-1-1" }, cards())],
    () => cards().map(([card], i) => s({ layout: "1-1", valign: "center", background: i % 2 ? "surface" : "default" }, i % 2 ? [[b("image", { ratio: "4:3" })], [b("heading", { text: card.props.title, level: 2 }), b("text", { html: `<p>${esc(card.props.text)}</p>` })]] : [[b("heading", { text: card.props.title, level: 2 }), b("text", { html: `<p>${esc(card.props.text)}</p>` })], [b("image", { ratio: "4:3" })]])),
    () => [s({ layout: "1-1-1", valign: "top" }, [[b("pricing", { name: "Basic" })], [b("pricing", { name: "Standard", featured: true })], [b("pricing", { name: "Premium" })]])],
  ],
  gallery: [
    () => [s({}, [[b("gallery", { columns: 3 })]])],
    () => [s({ width: "wide" }, [[b("gallery", { columns: 3, layout: "masonry", ratio: "auto", gap: 8, hover: "colour" })]])],
    () => [s({ width: "wide" }, [[b("gallery", { columns: 2, ratio: "3:2", captions: true, hover: "darken" })]])],
  ],
  contact: [
    (brief) => [contactSection(brief), ...(brief.address ? [s({ padding: "sm" }, [[b("map", { address: brief.address })]])] : [])],
    (brief) => [s({ layout: "1-1-1", padding: "md" }, [
      [b("card", { icon: "📞", title: "Call", text: brief.phone || "Phone number coming soon", style: "outline", align: "center" })],
      [b("card", { icon: "✉️", title: "Email", text: brief.email || "Email address coming soon", style: "outline", align: "center" })],
      [b("card", { icon: "📍", title: "Visit", text: brief.address || "Visits by appointment", style: "outline", align: "center" })],
    ]), s({ width: "narrow" }, [[b("form")]])],
    (brief) => [contactSection(brief, { background: "dark" })],
  ],
  faq: [
    () => [s({ width: "narrow" }, [[b("faq")]])],
    () => [s({ layout: "1-2" }, [[b("heading", { text: "Common questions", level: 2 }), b("text", { html: "<p>Can't find your answer? Just ask.</p>" })], [b("faq")]])],
    (brief) => [s({ width: "narrow" }, [[b("faq")]]), contactSection(brief, { background: "surface" })],
  ],
  pricing: [
    () => [s({ layout: "1-1-1" }, [[b("pricing", { name: "Basic" })], [b("pricing", { name: "Standard", featured: true })], [b("pricing", { name: "Premium" })]])],
    () => [s({ layout: "1-1", width: "normal" }, [[b("pricing", { name: "Standard" })], [b("pricing", { name: "Premium", featured: true })]])],
    () => [s({ layout: "1-1-1" }, [[b("pricing", { name: "Basic" })], [b("pricing", { name: "Standard", featured: true })], [b("pricing", { name: "Premium" })]]), s({ width: "narrow", background: "surface" }, [[b("faq")]])],
  ],
  other: [
    (brief, name, title) => [s({ width: "narrow" }, [[b("text", { html: `<p>${esc(pageIntro(brief, title))}</p>` })]])],
    (brief, name, title) => [s({ layout: "1-1", valign: "center" }, [[b("text", { html: `<p>${esc(pageIntro(brief, title))}</p>` }), b("buttons")], [b("image", { ratio: "4:3" })]])],
    () => [s({ layout: "1-1-1" }, cards())],
  ],
};

// Photo backgrounds get the finishing touches a designer would add: a tint in
// the brand's dark colour (a gradient on the hero) and a slow zoom on the hero.
function finishPhotoBackgrounds(sections, colors, { hero = false } = {}) {
  sections.forEach((section, i) => {
    if (section.props.background !== "image" || section.style) return;
    const isHero = hero && i === 0;
    section.style = isHero
      ? { tint: colors.dark, tint2: colors.primary, tintDir: "diagonal", tintOpacity: 62, bgEffect: "zoom" }
      : { tint: colors.dark, tintOpacity: 55 };
  });
  return sections;
}

export function demoPage(brief, name, title, variant) {
  const slug = slugify(title);
  const bodies = PAGE_BODIES[slug] || PAGE_BODIES.other;
  const v = variant % 3;
  const page = createPage(title, slug);
  page.sections = [PAGE_HEADERS[(v + (slug.length % 3)) % 3](title, pageIntro(brief, title)), ...bodies[v](brief, name, title)];
  return page;
}

export function createDemoProvider() {
  return {
    name: "demo",
    model: "template",

    async generateConcept({ brief, variant = 0 }) {
      const v = variant % LAYOUTS.length;
      const { site, name } = baseSite(brief, v);
      const home = createPage("Home", "index");
      home.seo.description = about(brief).slice(0, 155);
      home.sections = LAYOUTS[v](brief, name);
      // Templates can't write copy: use the owner's homepage description as the hero text.
      const homeInfo = String(brief.pageInfo?.Home || "").trim();
      const heroText = homeInfo && home.sections[0]?.columns.flatMap((c) => c.blocks).find((x) => x.type === "text");
      if (heroText) heroText.props.html = `<p>${esc(homeInfo)}</p>`;
      finishPhotoBackgrounds(home.sections, site.theme.colors, { hero: true });
      site.pages = [home];
      return { site };
    },

    async buildFromConcept({ brief, concept }) {
      const site = structuredClone(concept);
      const name = site.name;
      for (const { title, slug } of plannedPages(brief)) {
        if (site.pages.some((p) => p.slug === slug)) continue;
        const page = createPage(title, slug);
        const make = EXTRA_PAGES[slug];
        const info = String(brief.pageInfo?.[title] || "").trim();
        page.sections = make ? make(brief, name) : [s({ width: "narrow" }, [[b("heading", { text: title, level: 1 }), b("text", { html: `<p>${esc(info || "Add your content here.")}</p>` })]])];
        // The owner's description of the page goes under its title.
        if (make && info) page.sections[0].columns[0].blocks.push(b("text", { html: `<p>${esc(info)}</p>`, align: "center" }));
        site.pages.push(page);
      }
      // Pages may have been added after the design was picked: refresh the menu.
      if (plannedPages(brief).length) site.header.links = headerLinks(brief);
      return { site };
    },

    async generatePage({ brief, concept, title, variant = 0 }) {
      const page = demoPage(brief, concept.name, title, variant);
      finishPhotoBackgrounds(page.sections, concept.theme.colors);
      return { page };
    },

    // Old "describe it" flow: same as the first concept, built in one go.
    async generateSite({ name, prompt }) {
      return this.generateConcept({ brief: { name, description: prompt }, variant: 0 });
    },

    async editSite() {
      throw new Error("Written changes need AI. Set ANTHROPIC_API_KEY in settings.txt and restart. You can still change everything by hand in the editor.");
    },
  };
}
