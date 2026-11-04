// Ready-made website designs: complete multi-page sites for common kinds of
// business, each with its own colours, fonts and look. Start from one in the
// "New website" wizard; the text is filled in by hand or by the AI.

import { createEmptySite, createPage, createBlock as b, createSection as s, FORM_PRESETS, normalizeSite, reId } from "./schema.js";
import { SECTION_LIBRARY } from "./library.js";

const lib = (id) => [].concat(SECTION_LIBRARY.find((e) => e.id === id).make());
const pageHead = (title, intro, props = {}) => s({ background: "surface", width: "narrow", align: "center", ...props }, [[b("heading", { text: title, level: 1, align: "center" }), b("text", { html: `<p>${intro}</p>`, align: "center" })]]);
const heroPhoto = (title, text, buttons, photo, extra = {}) => ({
  ...s({ background: "image", padding: "xl", minHeight: true, width: "narrow", align: "center", valign: "center" }, [[b("heading", { text: title, level: 1, align: "center" }), b("text", { html: `<p>${text}</p>`, align: "center" }), b("buttons", { align: "center", items: buttons.map(([t, href, style = "primary"]) => ({ text: t, href, style, icon: "none" })) })]]),
  style: { bgPhoto: photo, tint: "#000000", tintOpacity: 52, bgEffect: "zoom", ...extra },
});
const contact = (form = b("form")) => s({ layout: "1-1", anchor: "contact" }, [[b("heading", { text: "Get in touch", level: 2 }), b("text", { html: "<p>📞 <a href=\"tel:\">Your phone</a><br>✉️ <a href=\"mailto:\">your@email.com</a><br>📍 Your address</p>" }), b("hours", { title: "" })], [form]]);

export const SITE_DESIGNS = [
  {
    id: "restaurant", name: "Restaurant & café", desc: "Menu, opening hours, bookings and a gallery",
    colors: { primary: "#b45309", accent: "#15803d", background: "#fffdf8", surface: "#f7f1e6", text: "#2a1d12", muted: "#7a6a58", dark: "#24160c" }, fonts: ["playfair", "lora"], radius: 6,
    keywords: "restaurant interior food",
    pages: [
      ["Home", [heroPhoto("Fresh, local, made with love", "Seasonal food and a warm welcome, seven days a week.", [["Book a table", "/book"], ["See the menu", "/menu", "light"]], "cosy restaurant dining room"), ...lib("hours-map"), ...lib("rev-3"), ...lib("gal-wide"), ...lib("news")]],
      ["Menu", [pageHead("Our menu", "Made fresh every day with local ingredients."), ...lib("menu-2"), ...lib("cta-dark")]],
      ["Book", [pageHead("Book a table", "Tell us when you'd like to come; we'll confirm by email."), s({ width: "narrow" }, [[b("form", { ...FORM_PRESETS.booking(), fields: FORM_PRESETS.booking().fields.map((f) => (f.type === "select" ? { ...f, label: "Which sitting?", options: "Lunch, Dinner" } : f)) })]])]],
      ["Contact", [pageHead("Find us", "We'd love to see you."), ...lib("contact-map")]],
    ],
  },
  {
    id: "trades", name: "Trades & home services", desc: "Plumbers, builders, electricians, cleaners",
    colors: { primary: "#1d4ed8", accent: "#f59e0b", background: "#ffffff", surface: "#f1f5fb", text: "#0f172a", muted: "#64748b", dark: "#0b1a33" }, fonts: ["montserrat", "inter"], radius: 8,
    keywords: "tradesman at work tools",
    pages: [
      ["Home", [...lib("hero-photo-left"), ...lib("trust"), ...lib("svc-3"), ...lib("steps-3"), ...lib("rev-3"), ...lib("cta-phone")]],
      ["Services", [pageHead("Our services", "Everything we do, done properly."), ...lib("svc-tabs"), ...lib("svc-zigzag"), ...lib("price-list")]],
      ["Our work", [pageHead("Our work", "A few recent jobs we're proud of."), ...lib("beforeafter"), ...lib("gal-grid")]],
      ["Contact", [pageHead("Get a free quote", "Tell us about the job and we'll get back to you the same day."), ...lib("quote-photo")]],
    ],
  },
  {
    id: "salon", name: "Salon, beauty & wellbeing", desc: "Treatments, prices, team and online booking",
    colors: { primary: "#be185d", accent: "#a16207", background: "#fffafb", surface: "#fbf0f4", text: "#2b1420", muted: "#8a6b78", dark: "#2b1420" }, fonts: ["cormorant", "dmsans"], radius: 16,
    keywords: "beauty salon interior",
    pages: [
      ["Home", [heroPhoto("Look good, feel amazing", "Relaxing treatments by a friendly, experienced team.", [["Book now", "/book"]], "calm beauty salon", { tint: "#2b1420", tintOpacity: 45, shapeBottom: "curve", shapeH: 60 }), ...lib("svc-photos"), ...lib("offer"), ...lib("team-3"), ...lib("rev-slider")]],
      ["Treatments", [pageHead("Treatments & prices", "Something for everyone; ask us for advice."), ...lib("svc-pricecards"), ...lib("faq-narrow")]],
      ["Book", [pageHead("Book an appointment", "Choose a treatment and a time; we'll confirm by email."), ...lib("book-steps")]],
      ["Contact", [pageHead("Visit us", "We look forward to seeing you."), ...lib("contact-map")]],
    ],
  },
  {
    id: "fitness", name: "Fitness & personal training", desc: "Classes, coaching plans, results and sign-ups",
    colors: { primary: "#16a34a", accent: "#f97316", background: "#ffffff", surface: "#f2f7f3", text: "#0b130e", muted: "#5d6b62", dark: "#0b130e" }, fonts: ["bebas", "inter"], radius: 4,
    keywords: "personal trainer gym",
    pages: [
      ["Home", [heroPhoto("Get stronger. Feel better.", "Personal training and small group classes that fit your life.", [["Book a free session", "/book"]], "personal trainer coaching in gym", { tint: "#0b130e", tintOpacity: 58 }), ...lib("stats"), ...lib("svc-dark"), ...lib("rev-strip"), ...lib("price-3")]],
      ["Classes", [pageHead("Classes & timetable", "Small groups, big results."), ...lib("menu"), ...lib("hours-dark")]],
      ["About", [pageHead("About me", "Why I do this, and how I'll help you."), ...lib("about-quote"), ...lib("about-timeline")]],
      ["Book", [pageHead("Book your free session", "No pressure, just a chat and a workout."), ...lib("book")]],
    ],
  },
  {
    id: "boutique", name: "Shop & boutique", desc: "Products with Buy buttons, offers and delivery info",
    colors: { primary: "#111111", accent: "#c08457", background: "#ffffff", surface: "#f6f3ef", text: "#111111", muted: "#6b6460", dark: "#111111" }, fonts: ["playfair", "worksans"], radius: 2,
    keywords: "boutique shop products",
    pages: [
      ["Home", [...lib("hero-split-r"), ...lib("shop-4"), ...lib("offer-count"), ...lib("shop-delivery"), ...lib("news-side")]],
      ["Shop", [pageHead("Shop", "Order online; we'll wrap it beautifully."), ...lib("shop-3"), ...lib("shop-feature")]],
      ["About", [pageHead("Our story", "How it all started."), ...lib("about-img"), ...lib("rev-3")]],
      ["Contact", [pageHead("Contact", "Questions about an order? We're happy to help."), ...lib("contact-narrow")]],
    ],
  },
  {
    id: "professional", name: "Professional services", desc: "Accountants, solicitors, consultants, agencies",
    colors: { primary: "#0f3d5c", accent: "#c9a227", background: "#ffffff", surface: "#f2f5f8", text: "#13212c", muted: "#5b6b78", dark: "#0b2233" }, fonts: ["baskerville", "system"], radius: 4,
    keywords: "modern office meeting",
    pages: [
      ["Home", [...lib("hero-split"), ...lib("svc-4"), ...lib("about-split-dark"), ...lib("rev-side"), ...lib("cta-split")]],
      ["Services", [pageHead("How we can help", "Clear advice, fixed fees, no jargon."), ...lib("svc-list"), ...lib("price-3")]],
      ["About", [pageHead("About the firm", "Experienced, approachable and on your side."), ...lib("team-4"), ...lib("history")]],
      ["Contact", [pageHead("Book a consultation", "Your first call is free."), ...lib("enquiry")]],
    ],
  },
  {
    id: "portfolio", name: "Photographer & creative", desc: "Big images, galleries and an enquiry form",
    colors: { primary: "#e11d48", accent: "#facc15", background: "#0d0d0f", surface: "#18181b", text: "#f4f4f5", muted: "#a1a1aa", dark: "#000000" }, fonts: ["dmsans", "dmsans"], radius: 0,
    keywords: "photographer portfolio",
    pages: [
      ["Home", [heroPhoto("Moments, beautifully told", "Weddings, portraits and brands.", [["See my work", "/portfolio"]], "dramatic portrait photography", { tintOpacity: 35 }), ...lib("gal-masonry"), ...lib("rev-one"), ...lib("cta-dark")]],
      ["Portfolio", [pageHead("Portfolio", "A selection of recent work.", { background: "default" }), ...lib("gal-dark"), ...lib("video")]],
      ["About", [pageHead("Hello!", "A little about me and how I work.", { background: "default" }), ...lib("about-img"), ...lib("steps-timeline")]],
      ["Contact", [pageHead("Let's work together", "Tell me about your plans.", { background: "default" }), ...lib("enquiry")]],
    ],
  },
  {
    id: "bnb", name: "B&B & holiday let", desc: "Rooms, photos, availability enquiries and the area",
    colors: { primary: "#0e7490", accent: "#ea580c", background: "#fdfcfa", surface: "#eef6f7", text: "#0f2a30", muted: "#5b7277", dark: "#0b2a30" }, fonts: ["lora", "nunito"], radius: 12,
    keywords: "cosy holiday cottage",
    pages: [
      ["Home", [heroPhoto("Your peaceful escape", "A warm welcome, comfy beds and the best breakfast for miles.", [["Check availability", "/book"]], "cosy holiday cottage exterior", { bgEffect: "pan", shapeBottom: "cloud", shapeH: 70 }), ...lib("svc-photos"), ...lib("gal-slider"), ...lib("rev-slider"), ...lib("hours-map")]],
      ["Rooms", [pageHead("Rooms & prices", "All rooms are en suite, with breakfast included."), ...lib("price-2"), ...lib("faq-side")]],
      ["The area", [pageHead("Things to do nearby", "Our favourite walks, beaches and places to eat."), ...lib("svc-zigzag")]],
      ["Book", [pageHead("Check availability", "Send us your dates and we'll reply within a few hours."), ...lib("book-dark")]],
    ],
  },
  {
    id: "community", name: "Charity & community group", desc: "Mission, events, news, volunteers and donations",
    colors: { primary: "#7c3aed", accent: "#f59e0b", background: "#ffffff", surface: "#f6f3fd", text: "#1b1530", muted: "#6c6684", dark: "#1e1530" }, fonts: ["poppins", "poppins"], radius: 14,
    keywords: "community volunteers",
    pages: [
      ["Home", [...lib("hero-gradient"), ...lib("stats-light"), ...lib("stats-waves"), ...lib("blog-3"), ...lib("cta-accent")]],
      ["About", [pageHead("Who we are", "Our mission and the people who make it happen."), ...lib("about-values"), ...lib("team-3")]],
      ["News", [pageHead("News & events", "What's coming up and what we've been doing."), ...lib("blog-list")]],
      ["Get involved", [pageHead("Get involved", "Volunteer, donate or just come along."), ...lib("steps-3"), ...lib("contact-narrow")]],
    ],
  },
  {
    id: "onepage", name: "Simple one-page site", desc: "Everything on one page: quick and easy",
    colors: { primary: "#2563eb", accent: "#f59e0b", background: "#ffffff", surface: "#f4f6fb", text: "#111827", muted: "#6b7280", dark: "#0f172a" }, fonts: ["inter", "inter"], radius: 10,
    keywords: "small business",
    pages: [
      ["Home", [...lib("hero-dark"), ...lib("svc-3"), ...lib("about-img"), ...lib("rev-3"), ...lib("faq-narrow"), contact()]],
    ],
  },
];

/** A full site from a design, with the business's name and details. */
export function siteFromDesign(id, { name = "Your Business", phone = "", email = "", address = "", hours = "" } = {}) {
  const d = SITE_DESIGNS.find((x) => x.id === id);
  if (!d) throw new Error("Unknown design.");
  const site = createEmptySite(name);
  Object.assign(site.theme.colors, d.colors);
  site.theme.fonts = { heading: d.fonts[0], body: d.fonts[1] };
  site.theme.radius = d.radius;
  site.pages = d.pages.map(([title, sections], i) => {
    const page = i === 0 ? createPage("Home", "index") : createPage(title);
    page.sections = sections.map(reId);
    return page;
  });
  const book = site.pages.find((p) => p.slug === "book"), contactPage = site.pages.find((p) => p.slug === "contact");
  site.header.ctaText = book ? "Book now" : "Get in touch";
  const withAnchor = site.pages.find((p) => p.sections.some((x) => x.props.anchor === "contact"));
  site.header.ctaHref = book ? "/book" : contactPage ? "/contact" : withAnchor && withAnchor.slug !== "index" ? `/${withAnchor.slug}#contact` : "#contact";
  site.business = { ...site.business, type: d.name, keywords: d.keywords, phone, email, address, hours };
  // Maps show the business's address.
  if (address) for (const p of site.pages) for (const sec of p.sections) for (const c of sec.columns) for (const bl of c.blocks) if (bl.type === "map") bl.props.address = address;
  site.footer.text = `© ${new Date().getFullYear()} ${name}`;
  return normalizeSite(site);
}
