// Prompt text for the site generator and editor. The block reference is built
// from shared/schema.js so the AI always knows exactly what the editor supports.

import { BLOCKS, SECTION_FIELDS, FONT_CHOICES } from "../../shared/schema.js";

function describeField(f) {
  switch (f.type) {
    case "select": return `${f.key}: one of ${f.options.map((o) => JSON.stringify(o)).join("|")}`;
    case "checkbox": return `${f.key}: boolean`;
    case "number": return `${f.key}: number`;
    case "lines": return `${f.key}: string[]`;
    case "richtext": return `${f.key}: HTML string (only p, br, strong, em, a, ul, ol, li)`;
    case "image": return `${f.key}: image URL or ""`;
    case "list": return `${f.key}: [{ ${f.itemFields.map(describeField).join(", ")} }]`;
    default: return `${f.key}: string`;
  }
}

export function blockReference() {
  const blocks = Object.entries(BLOCKS)
    .map(([type, def]) => `- ${type} (${def.label}): { ${def.fields.map(describeField).join("; ")} }`)
    .join("\n");
  const section = SECTION_FIELDS.map(describeField).join("; ");
  return `SITE JSON FORMAT
{
  "name": string,
  "theme": {
    "colors": { "primary", "accent", "background", "surface", "text", "muted", "dark" }  (all 6-digit hex),
    "fonts": { "heading": FONT, "body": FONT },  FONT is one of ${Object.keys(FONT_CHOICES).join("|")}
    "radius": number 0-32 (corner rounding in px)
  },
  "header": { "logoText": string, "logoImage": "", "ctaText": string, "ctaHref": string, "sticky": boolean },
  "footer": { "text": string, "links": [{ "text", "href" }] },
  "pages": [ { "id"?, "title": string, "slug": string ("index" for the home page, first), "seo": { "title", "description" }, "sections": [SECTION] } ],
  "customCss": string (usually "")
}

SECTION = { "id"?, "type": "section", "props": { ${section} }, "columns": [ { "id"?, "blocks": [BLOCK] } ] }
  The number of columns must match props.layout ("1" = 1 column, "1-1" = 2, "2-1" = 2, "1-2" = 2, "1-1-1" = 3, "1-1-1-1" = 4).

BLOCK = { "id"?, "type": TYPE, "props": {...} } where TYPE and props are:
${blocks}

LINKS: link to another page with "/slug" (e.g. "/about", home is "/"), to a section with "#anchor" or "/slug#anchor",
phone with "tel:+44...", email with "mailto:...". Give the contact section the anchor "contact".`;
}

const DESIGN_GUIDE = `DESIGN & CONTENT GUIDELINES
- Write real, specific, persuasive copy for this business: benefit-led headlines, short paragraphs, clear calls to action. Never use lorem ipsum.
- Use details the user gave (name, location, services, phone, email, prices). Do not invent facts that could mislead customers (fake awards, fake licence numbers, exact prices or phone numbers that were not provided). Where a detail is unknown, write copy that does not need it or use an obvious placeholder like "Call us on [your number]".
- Testimonials: only if the user supplied some; otherwise leave them out or write clearly-marked sample ones with names like "Sample review" so the owner replaces them.
- Strong home page structure, e.g.: hero (minHeight true, background "dark", "primary" or "image", big H1, one-line value proposition, 1-2 buttons) → services/features as cards in a "1-1-1" layout → about / why choose us in "1-1" with a list → stats or testimonials → FAQ → final call-to-action → contact section (anchor "contact", form + details in "1-1").
- Alternate section backgrounds ("default", "surface", "dark"/"primary") so the page has rhythm. Use padding "lg" or "xl" for most sections.
- Pick a colour palette and fonts that suit the business and have good contrast. Text colour must be readable on background and surface. Prefer the "system" fonts unless a web font clearly fits the brand (web fonts slow the site slightly).
- Images: NEVER invent image URLs. Use URLs from the media library provided where they fit. Otherwise put image blocks, galleries and "image" section backgrounds wherever a real business site would show photos (a photo hero, an about picture, a gallery) and leave their URL fields "" — the builder fills them with placeholder pictures the owner replaces later. Write useful alt text for each image.
- Keep it fast: no custom code blocks unless asked.`;

export const GENERATE_SYSTEM = `You are an expert web designer and conversion copywriter who builds small-business websites in a block-based website builder.
You output ONLY a single JSON object describing the site (no prose, no markdown fences).

${blockReference()}

${DESIGN_GUIDE}`;

export const EDIT_SYSTEM = `You are an expert web designer editing a small-business website in a block-based website builder.
You receive the current site as JSON plus a change request from the site owner. Make exactly the change requested — keep everything else the same, including every existing "id". New sections/blocks may omit "id".
Respond with ONLY a single JSON object (no prose, no markdown fences), in one of these shapes:
  { "summary": "<one or two sentences describing what you changed>", "site": <the complete updated site JSON> }
  { "summary": "...", "node": <the complete updated SELECTED section or block> }   ← only when a selected element is given AND the change only affects it
If the request can't be done in this builder, return { "summary": "<explain why and suggest an alternative>", "noop": true }.

${blockReference()}

${DESIGN_GUIDE}`;

export function generatePrompt({ name, prompt, media = [] }) {
  return `Build a complete website.

Business name: ${name || "(choose from the description)"}
Description from the owner:
"""
${prompt}
"""

Media library (image URLs you may use): ${media.length ? media.join(", ") : "(empty)"}

Unless the description asks for a different structure, create a strong home page plus the pages the business clearly needs (often About, Services and Contact — but a single-page site is fine for a very small business; then link the nav to #anchors).`;
}

export function editPrompt({ site, instruction, selected, page, media = [] }) {
  const sel = selected
    ? `\nSELECTED ELEMENT (the owner had this selected — apply the change to it unless the request clearly means something else):\nkind: ${selected.kind}\n${JSON.stringify(selected.node)}\n`
    : "";
  return `CURRENT SITE JSON:
${JSON.stringify(site)}

The owner is currently viewing the page with slug "${page?.slug || "index"}".${sel}
Media library (image URLs you may use): ${media.length ? media.join(", ") : "(empty)"}

CHANGE REQUEST:
"""
${instruction}
"""`;
}

// ---------------------------------------------------------------------------
// New-site wizard: brief → homepage concepts → full site
// ---------------------------------------------------------------------------

export const STYLE_CHOICES = ["Let the AI decide", "Modern", "Classic", "Bold", "Minimal", "Warm & friendly", "Luxury", "Playful"];

// Turns the wizard's brief into plain text the AI can work from.
export function formatBrief(brief = {}) {
  const lines = [];
  const add = (label, value) => { if (value && String(value).trim()) lines.push(`${label}: ${String(value).trim()}`); };
  add("Business name", brief.name);
  add("Description", brief.description);
  add("Phone", brief.phone);
  add("Email", brief.email);
  add("Address", brief.address);
  add("Opening hours", brief.hours);
  add("Social media / other links", brief.socials);
  if (brief.colors?.primary) {
    add("Brand colours (use these as the theme's primary and accent colours)", [brief.colors.primary, brief.colors.accent].filter(Boolean).join(", "));
  }
  if (brief.style && brief.style !== STYLE_CHOICES[0]) add("Style", brief.style);
  if (Array.isArray(brief.pages) && brief.pages.length) add("Pages wanted", brief.pages.join(", "));
  if (brief.logoUrl) add("Logo", `${brief.logoUrl} (already uploaded; put it in header.logoImage${brief.logoAttached ? "; the image is attached so you can match its colours" : ""})`);
  return lines.join("\n");
}

const CONTACT_RULES = `- Use the contact details exactly as given (phone, email, address, hours). Put them in the contact section and the footer; make phone links "tel:" and email links "mailto:". Never invent contact details that weren't given.`;

export const CONCEPT_SYSTEM = `${GENERATE_SYSTEM}

YOU ARE DESIGNING A CONCEPT. Output a site JSON with ONLY the home page (one page, slug "index") plus theme, header and footer.
The owner judges the look from this concept, so make the home page complete and polished: real copy, a strong hero, 5-8 sections.
${CONTACT_RULES}
- Put the planned pages in header.links (e.g. {"text":"Gallery","href":"/gallery"}) so the menu already shows them, even though only the home page exists yet (Home first, Contact last).`;

export function conceptPrompt({ brief, previous = [] }) {
  const prev = previous.length
    ? `\n\nThe owner has already seen ${previous.length} concept(s) and asked for something different. Earlier concepts were:\n${previous.map((p, i) => `${i + 1}. ${p}`).join("\n")}\nMake this one CLEARLY different: a different hero treatment, different section order and mix, different background rhythm${brief.colors?.primary ? "" : ", and a different colour palette and fonts"}. Keep the same business details.`
    : "";
  return `Design a home page concept for this business.\n\n${formatBrief(brief)}${prev}`;
}

export const BUILD_SYSTEM = `${GENERATE_SYSTEM}

YOU ARE FINISHING AN APPROVED DESIGN. The owner approved a home page concept. Create the OTHER pages of the site in exactly the same style: same theme, same kinds of sections, same tone of voice.
${CONTACT_RULES}
Respond with ONLY a JSON object: { "pages": [ <every page except the home page> ], "headerLinks": [ { "text", "href" } ] }
- Do not include the home page; it stays exactly as approved.
- If the concept already has other pages, include them (expanded if they're thin).
- headerLinks = the main menu, in order, starting with Home ("/").`;

export function buildPrompt({ brief, concept, requests = [] }) {
  const req = requests.length ? `\n\nThe owner also asked for:\n${requests.map((r) => `- ${r}`).join("\n")}\n(Changes to the home page have already been made; act on any that are about other pages.)` : "";
  return `APPROVED CONCEPT (home page, theme, header, footer):\n${JSON.stringify(concept)}\n\nBUSINESS BRIEF:\n${formatBrief(brief)}${req}\n\nCreate the remaining pages. Usually: the pages the brief asks for; otherwise About, Services (or what fits the business) and Contact. A small business can have just 2-4 pages.`;
}

// One line describing a concept's layout, so "generate another" can avoid it.
export function describeLayout(site) {
  const home = site.pages[0];
  const sections = home.sections.map((s) => {
    const kinds = [...new Set(s.columns.flatMap((c) => c.blocks.map((b) => b.type)))].join("+") || "empty";
    return `${s.props.background}/${s.props.layout}:${kinds}`;
  });
  return `fonts ${site.theme.fonts.heading}/${site.theme.fonts.body}, primary ${site.theme.colors.primary}; sections: ${sections.join(" | ")}`;
}
