// "Before you publish" checks: things that are easy to miss on a site built
// from a template or by the AI. Shared by the editor (shown before Publish)
// and the server. Each issue:
//   { level: "fix" | "tip", kind, text, pageId?, nodeId? }
// "fix" means visitors would notice; "tip" is worth doing but harmless.

import { BLOCKS } from "./schema.js";

// ---- readability -------------------------------------------------------------

function rgb(hex) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio, 1 (none) to 21 (black on white). Body text needs 4.5; big headings 3. */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
const autoText = (bg) => (luminance(bg) > 0.4 ? "#111111" : "#ffffff");

// The background a section's text sits on (null for photos: the tint decides).
function sectionBackground(section, colors) {
  if (section.style?.bg) return section.style.bg;
  return { default: colors.background, surface: colors.surface, primary: colors.primary, dark: colors.dark, image: null }[section.props.background] ?? colors.background;
}
function sectionText(section, colors) {
  if (section.style?.color) return section.style.color;
  const bg = section.props.background;
  if (bg === "primary") return autoText(colors.primary);
  if (bg === "dark") return autoText(colors.dark);
  return colors.text;
}

/** Readability problems for one section or block, for the inspector and the checklist. */
export function readabilityIssues(site, section, block = null) {
  const c = site.theme.colors;
  const out = [];
  const bg = block?.style?.bg || sectionBackground(section, c);
  if (!bg) return out;
  const fg = block?.style?.color || sectionText(section, c);
  const big = block?.type === "heading" && Number(block.props.level) <= 2;
  const ratio = contrast(fg, bg);
  if (ratio < (big ? 3 : 4.5)) out.push(`Text is hard to read on this background (contrast ${ratio.toFixed(1)}:1; aim for ${big ? 3 : 4.5}:1 or more).`);
  return out;
}

// ---- the checklist -------------------------------------------------------------

const TEMPLATE_TEXT = [
  "Your heading here", "Write something great about this business", "Feature title", "A short description of this feature or service",
  "Add your content here", "Fantastic service from start to finish", "Happy customer", "Sample review",
];
const isPlaceholder = (url) => /\/placeholder-[\w-]+\.(webp|svg)$/.test(String(url || ""));

/**
 * @param site  normalized site
 * @param opts  { formEmail, ownHosting }  ownHosting: published by FTP/ZIP, so form messages need an email
 */
export function checkSite(site, { formEmail = "", ownHosting = false } = {}) {
  const issues = [];
  const add = (level, kind, text, page, nodeId) => issues.push({ level, kind, text, pageId: page?.id, page: page?.title, nodeId });
  const slugs = new Set(site.pages.map((p) => p.slug));
  const anchors = (page) => new Set(page.sections.map((s) => s.props.anchor).filter(Boolean));
  let hasForm = false;

  const checkLink = (href, page, nodeId, what) => {
    const url = String(href || "").trim();
    if (!url || url === "#") return add("fix", "link", `${what} doesn't link anywhere yet.`, page, nodeId);
    const m = url.match(/^\/([\w-]*)\/?(?:#([\w-]+))?$/);
    if (m) {
      const slug = m[1] || "index";
      const target = site.pages.find((p) => p.slug === slug);
      if (!slugs.has(slug)) return add("fix", "link", `${what} links to a page that doesn't exist (${url}).`, page, nodeId);
      if (m[2] && !anchors(target).has(m[2])) add("fix", "link", `${what} links to a section that doesn't exist (${url}).`, page, nodeId);
    } else if (url.startsWith("#") && !anchors(page).has(url.slice(1))) {
      // A same-page anchor that's on another page is a common slip after pages are split.
      const elsewhere = site.pages.find((p) => anchors(p).has(url.slice(1)));
      add("fix", "link", `${what} links to #${url.slice(1)}, which isn't on this page${elsewhere ? ` (it's on ${elsewhere.title})` : ""}.`, page, nodeId);
    }
  };

  for (const page of site.pages) {
    if (!page.sections.length) add("fix", "empty", "This page is empty.", page);
    if (!page.seo.description.trim()) add("tip", "seo", "No Google description: add one so search results show a helpful summary.", page);
    let placeholders = 0, firstPlaceholder = null;
    const noteImage = (src, id) => { if (isPlaceholder(src)) { placeholders++; firstPlaceholder ||= id; } };
    for (const section of page.sections) {
      if (section.props.background === "image") noteImage(section.props.image, section.id);
      for (const r of readabilityIssues(site, section)) add("fix", "contrast", r, page, section.id);
      for (const col of section.columns) for (const block of col.blocks) {
        const p = block.props;
        const label = BLOCKS[block.type]?.label || block.type;
        noteImage(block.style?.bgImage, block.id);
        if (block.style?.bg || block.style?.color) for (const r of readabilityIssues(site, section, block)) add("fix", "contrast", r, page, block.id);
        if (block.type === "image") {
          noteImage(p.src, block.id);
          if (p.src && !p.alt.trim()) add("tip", "alt", "An image has no description (alt text). It helps blind visitors and Google.", page, block.id);
        }
        if (block.type === "gallery") {
          p.images.forEach((i) => noteImage(i.src, block.id));
          if (p.images.some((i) => i.src && !i.alt.trim())) add("tip", "alt", "Some gallery photos have no description (alt text).", page, block.id);
        }
        if (block.type === "buttons") p.items.forEach((b) => b.text && checkLink(b.href, page, block.id, `The "${b.text}" button`));
        if (block.type === "card" && p.linkText) checkLink(p.href, page, block.id, `The "${p.linkText}" link`);
        if (block.type === "pricing" && p.buttonText) checkLink(p.href, page, block.id, `The "${p.buttonText}" button`);
        if (block.type === "form") hasForm = true;
        const text = [p.text, p.title, p.html, p.quote, p.name].filter((x) => typeof x === "string").join(" ").replace(/<[^>]+>/g, " ");
        const leftover = TEMPLATE_TEXT.find((t) => text.includes(t));
        if (leftover) add("fix", "template", `${label} still has template text ("${leftover}…").`, page, block.id);
      }
    }
    if (placeholders) add("fix", "placeholder", `${placeholders} placeholder picture${placeholders > 1 ? "s" : ""} still to replace.`, page, firstPlaceholder);
  }

  if (site.header.ctaText) checkLink(site.header.ctaHref, site.pages[0], "header", `The header's "${site.header.ctaText}" button`);
  if (hasForm && ownHosting && !formEmail) add("fix", "form", "There's a contact form but no email to send messages to (Site tab → Contact forms).", null);
  if (!site.header.logoImage) add("tip", "logo", "No logo image: the business name is shown as text instead.", null);
  if (!site.business?.phone && !site.business?.email && !site.business?.address) add("tip", "business", "No business details for Google (Site tab → Business details).", null);
  return issues;
}
