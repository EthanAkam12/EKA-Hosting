// Offline provider used when no AI key is configured. It builds a solid
// starter site from a template so the builder is usable straight away;
// AI edits need a real provider.

import { createBlock, createSection, createPage, createEmptySite } from "../../shared/schema.js";

const PALETTES = [
  { primary: "#2563eb", accent: "#f59e0b", dark: "#0f172a", surface: "#f1f5fb" },
  { primary: "#0f766e", accent: "#f97316", dark: "#102a27", surface: "#f0f7f5" },
  { primary: "#7c3aed", accent: "#ec4899", dark: "#1e1530", surface: "#f6f3fd" },
  { primary: "#b45309", accent: "#0ea5e9", dark: "#1f1a14", surface: "#faf6f0" },
];

export function createDemoProvider() {
  return {
    name: "demo",
    model: "template",
    async generateSite({ name, prompt }) {
      const biz = name || "Your Business";
      const about = String(prompt || "").trim().split(/(?<=[.!?])\s+/).slice(0, 2).join(" ") || `${biz} provides friendly, reliable service you can count on.`;
      const site = createEmptySite(biz);
      const palette = PALETTES[[...biz].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTES.length];
      Object.assign(site.theme.colors, palette);
      site.header.ctaText = "Get in touch";
      site.header.ctaHref = "#contact";
      site.header.links = [
        { text: "Services", href: "#services" },
        { text: "About", href: "#about" },
        { text: "FAQ", href: "#faq" },
        { text: "Contact", href: "#contact" },
      ];
      const home = createPage("Home", "index");
      home.seo.description = about.slice(0, 155);
      home.sections = [
        createSection({ background: "dark", padding: "xl", minHeight: true, width: "narrow", align: "center" }, [[
          createBlock("heading", { text: biz, level: 1, align: "center" }),
          createBlock("text", { html: `<p>${escape(about)}</p>`, align: "center" }),
          createBlock("buttons", { align: "center", items: [{ text: "Get a free quote", href: "#contact", style: "primary" }, { text: "Our services", href: "#services", style: "outline" }] }),
        ]]),
        createSection({ layout: "1", anchor: "services", width: "narrow", align: "center", padding: "lg" }, [[
          createBlock("heading", { text: "What we do", level: 2, align: "center" }),
          createBlock("text", { html: "<p>Everything you need, handled by people who care about getting it right.</p>", align: "center" }),
        ]]),
        createSection({ layout: "1-1-1", padding: "sm" }, [
          [createBlock("card", { icon: "⚡", title: "Fast & reliable", text: "We turn up when we say we will and get the job done properly." })],
          [createBlock("card", { icon: "★", title: "Quality first", text: "Experienced people, great materials and attention to detail." })],
          [createBlock("card", { icon: "✓", title: "Fair pricing", text: "Clear quotes up front with no hidden extras." })],
        ]),
        createSection({ layout: "1-1", background: "surface", anchor: "about", valign: "center", padding: "lg" }, [
          [createBlock("image", { ratio: "4:3" })],
          [
            createBlock("heading", { text: `Why choose ${biz}?`, level: 2 }),
            createBlock("text", { html: `<p>${escape(about)}</p>` }),
            createBlock("list", { items: ["Friendly, local team", "Fully insured", "Free, no-obligation quotes"] }),
          ],
        ]),
        createSection({ layout: "1", anchor: "faq", width: "narrow", padding: "lg" }, [[
          createBlock("heading", { text: "Frequently asked questions", level: 2, align: "center" }),
          createBlock("faq"),
        ]]),
        createSection({ layout: "1-1", background: "dark", anchor: "contact", padding: "lg" }, [
          [
            createBlock("heading", { text: "Get in touch", level: 2 }),
            createBlock("text", { html: "<p>Tell us what you need and we'll get back to you within one working day.</p>" }),
          ],
          [createBlock("form")],
        ]),
      ];
      site.pages = [home];
      return { site, summary: "Created a starter site from a template (AI not configured)." };
    },
    async editSite() {
      throw new Error("AI editing needs an AI provider. Set ANTHROPIC_API_KEY on the server and restart it. You can still edit everything by hand.");
    },
  };
}

function escape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
