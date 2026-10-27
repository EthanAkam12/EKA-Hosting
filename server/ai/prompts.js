// Prompt text for the site generator and editor. The block reference is built
// from shared/schema.js so the AI always knows exactly what the editor supports.

import { BLOCKS, SECTION_FIELDS, FONT_CHOICES, HOVER_EFFECTS, ENTRANCE_EFFECTS, slugify } from "../../shared/schema.js";

function describeField(f) {
  switch (f.type) {
    case "select": return `${f.key}: one of ${f.options.map((o) => JSON.stringify(o)).join("|")}`;
    case "checkbox": return `${f.key}: boolean`;
    case "number":
    case "slider": return `${f.key}: number`;
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
    "radius": number 0-32 (corner rounding in px),
    "buttons": { "size": "sm"|"md"|"lg"|"xl", "shape": "theme"|"square"|"rounded"|"pill", "weight": 400-800, "uppercase": boolean, "shadow": boolean, "hover": HOVER },
    "type": { "base": 14-22 (body text px), "headingScale": 60-160 (% of normal), "headingWeight": 300-900 },
    "layout": { "width": 720-1600 (content width px), "spacing": 25-200 (% of normal section spacing), "motion": ANIMATION (every section animates in unless it sets its own) }
  },
  "header": { "logoText": string, "logoImage": "", "ctaText": string, "ctaHref": string, "ctaStyle": "primary"|"secondary"|"outline"|"light"|"dark", "sticky": boolean, "logoHeight"?: px, "style"?: STYLE,
    "menu"?: { "font": FONT, "size": px, "weight": 300-900, "transform": "uppercase"|"lowercase"|"capitalize", "letterSpacing": px, "color", "hoverColor", "activeColor": hex, "hover": "color"|"underline"|"overline"|"pill"|"none", "gap": px, "align": "center"|"left" } },
  "footer": { "text": string, "links": [{ "text", "href" }] },
  "pages": [ { "id"?, "title": string, "slug": string ("index" for the home page, first), "seo": { "title", "description" }, "sections": [SECTION] } ],
  "customCss": string (usually ""),
  "business": { "type": string, "keywords": string }
}

SECTION = { "id"?, "type": "section", "props": { ${section} }, "columns": [ { "id"?, "blocks": [BLOCK] } ] }
  The number of columns must match props.layout ("1" = 1 column, "1-1" = 2, "2-1" = 2, "1-2" = 2, "1-1-1" = 3, "1-1-1-1" = 4).

BLOCK = { "id"?, "type": TYPE, "props": {...}, "style"?: STYLE } where TYPE and props are:
${blocks}

STYLE (optional on any SECTION or BLOCK, like Elementor's Style/Advanced tabs; leave out what you don't need):
{ "margin"|"padding": { "d"|"t"|"m": { "t", "r", "b", "l" } } (px per side; d = desktop, t = tablet override, m = mobile override),
  "bg": hex, "bg2": hex (gradient end), "color": hex (text), "radius": px, "borderWidth": px, "borderStyle": "solid"|"dashed"|"dotted"|"double", "borderColor": hex,
  "shadow": "sm"|"md"|"lg"|"xl", "fontSize": px, "fontWeight": 300-900, "fontFamily": FONT, "lineHeight": % (e.g. 150), "letterSpacing": px, "textTransform": "uppercase"|"lowercase"|"capitalize"|"none", "italic": true, "maxWidth": px, "align": "center"|"right" (with maxWidth), "gap": px (sections: space between columns),
  "animation": ANIMATION, "speed": "fast"|"slow", "delay": ms, "hover": HOVER (buttons blocks: button hover animation; other blocks: hover effect), "btnSize": "sm"|"md"|"lg"|"xl",
  "hide": { "d"|"t"|"m": true }, "minHeight": px,
  background image: "bgImage": URL (blocks only; sections use props.background "image" + props.image), "bgImageMobile": URL, "bgPos": "center"|"top"|"bottom"|"left"|"right"|"top left"|…, "bgSize": "contain",
  "bgFixed": true, "bgRepeat": true, "tint": hex, "tint2": hex (gradient tint), "tintDir": "up"|"right"|"left"|"diagonal"|"radial", "tintOpacity": 0-100 (sections default to props.overlay),
  "bgEffect": "fade"|"zoom"|"zoom-out"|"pan"|"parallax", "bgBlur": px, "bgGray": %, "bgBright": %,
  "bgVideo": YouTube/Vimeo/.mp4 URL (only if the owner gives one), "bgVideoPhones": true,
  "textEffect": "words-blur"|"words-up"|"underline" (headings only)|"shine"|"gradient", "bgAnimate": true (moves a bg→bg2 gradient) }
Effects are pure CSS and cheap, but use them sparingly: one text effect on the hero heading reads as polish; on every heading it's noise.
HOVER is one of ${HOVER_EFFECTS.join("|")}. ANIMATION is one of ${ENTRANCE_EFFECTS.join("|")}.
Prefer the section/block props and theme settings first; use STYLE for specific tweaks the owner asks for (spacing, borders, animations, hiding on mobile…).
PHOTO BACKGROUNDS deserve finishing touches, so set these in STYLE whenever a section uses background "image" (or a block uses a background photo):
- "bgPhoto": a concrete description of the photo, e.g. "sunlit antique shop interior with clocks" (it's used to find a matching stock photo when no image URL is given; for a block, setting bgPhoto asks for a background photo);
- a tint so the text is easy to read: "tint" (often the theme's dark colour) with "tintOpacity" 35-70, or "tint" + "tint2" for a gradient (e.g. dark to transparent-looking brand colour, "tintDir": "up" or "diagonal");
- "bgPos" to keep the subject in view when the photo is cropped;
- at most one effect, used with taste: "bgEffect": "zoom" (slow zoom) suits a hero; "parallax" suits one mid-page band; don't put effects on every section.

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
- Images: NEVER invent image URLs. Use URLs from the media library provided where they fit. Otherwise put image blocks, galleries and "image" section backgrounds wherever a real business site would show photos (a photo hero, an about picture, a gallery) and leave their URL fields "" — the builder fills them with matching stock photos. So give every image block alt text that describes a concrete, photographable scene (e.g. "brass carriage clock on an oak sideboard", not "our quality"), and set "business": { "type": "<what the business is, e.g. Antique shop>", "keywords": "<3-6 words to search stock photos for the backgrounds and gallery, e.g. antique shop interior vintage>" }.
- Keep it fast: no custom code blocks unless asked.`;

export const GENERATE_SYSTEM = `You are an expert web designer and conversion copywriter who builds small-business websites in a block-based website builder.
You output ONLY a single JSON object describing the site (no prose, no markdown fences).

${blockReference()}

${DESIGN_GUIDE}`;

export const EDIT_SYSTEM = `You are an expert web designer editing a small-business website in a block-based website builder.
You receive the current site as JSON plus a change request from the site owner. Make exactly the change requested and nothing else.
Respond with ONLY a single JSON object (no prose, no markdown fences): { "summary": "<one or two sentences describing what you changed>", "changes": [CHANGE, ...] }
Return ONLY what changes, never the whole site. CHANGE is one of:
  { "op": "theme", "theme": { only the theme fields that change, e.g. { "colors": { "primary": "#1f3a5f" } } } }
  { "op": "header", "header": { only the header fields that change } }
  { "op": "footer", "footer": { only the footer fields that change } }
  { "op": "site", "name"?: string, "customCss"?: string }
  { "op": "replace", "id": "<existing section or block id>", "node": <the complete updated section or block, same id> }
  { "op": "insert", "page": "<page slug>", "after": "<section id, or null for the top of the page>", "section": <new SECTION> }
  { "op": "remove", "id": "<section or block id>" }
  { "op": "move", "id": "<section id>", "after": "<section id on the same page, or null for the top>" }
  { "op": "page", "page": <a complete page> }   (adds a page, or replaces the page with the same slug)
  { "op": "removePage", "slug": "<page slug>" }
Use the smallest changes that do the job: to change one block, replace that block; to add a block to a section, replace that section. Keep existing ids; new sections and blocks may omit "id".
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
  const info = Object.entries(brief.pageInfo || {}).filter(([, v]) => v && String(v).trim());
  if (info.length) lines.push(`What the owner wants on each page (follow closely):\n${info.map(([page, text]) => `- ${page}: ${String(text).trim()}`).join("\n")}`);
  if (brief.logoUrl) add("Logo", `${brief.logoUrl} (already uploaded; put it in header.logoImage${brief.imagesAttached ? "; it's the first attached image, so you can match its colours" : ""})`);
  if (brief.photos?.length) {
    lines.push(`The owner's own photos (use the URLs exactly; place each where it works best, e.g. a strong wide shot as the hero background, people or the shop front in the about section, products in a gallery${brief.imagesAttached ? `; they're attached${brief.logoUrl ? " after the logo" : ""}, in this order, so you can see them` : ""}):\n${brief.photos.map((p, i) => `${i + 1}. ${p.url}${p.note ? ` (${p.note})` : ""}`).join("\n")}`);
  }
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
  // The brief is the same for every "generate another", so it's cached.
  return [{ text: `Design a home page concept for this business.\n\n${formatBrief(brief)}`, cache: true }, { text: prev.trim() }];
}

export const BUILD_SYSTEM = `${GENERATE_SYSTEM}

YOU ARE FINISHING AN APPROVED DESIGN. The owner approved a home page concept. Create the OTHER pages of the site in exactly the same style: same theme, same kinds of sections, same tone of voice.
${CONTACT_RULES}
Respond with ONLY a JSON object: { "pages": [ <every page except the home page> ], "headerLinks": [ { "text", "href" } ] }
- Do not include the home page; it stays exactly as approved.
- If the concept already has other pages, include them (expanded if they're thin).
- headerLinks = the main menu, in order, starting with Home ("/").`;

export function buildPrompt({ brief, concept, requests = [], pageNotes = {} }) {
  const req = requests.length ? `\n\nThe owner also asked for:\n${requests.map((r) => `- ${r}`).join("\n")}\n(Changes to the home page have already been made; act on any that are about other pages.)` : "";
  const notes = Object.entries(pageNotes).filter(([k]) => k !== "Home" && k !== "Whole site");
  const perPage = notes.length ? `\n\nWHAT THE OWNER WANTS ON EACH PAGE (follow these closely; create any page named here even if the brief doesn't list it):\n${notes.map(([page, text]) => `- ${page} page: ${text}`).join("\n")}` : "";
  return `APPROVED CONCEPT (home page, theme, header, footer):\n${JSON.stringify(concept)}\n\nBUSINESS BRIEF:\n${formatBrief(brief)}${req}${perPage}\n\nCreate the remaining pages. Usually: the pages the brief asks for; otherwise About, Services (or what fits the business) and Contact. A small business can have just 2-4 pages.`;
}

// One line describing a concept's layout, so "generate another" can avoid it.
export function describeLayout(site) {
  return `fonts ${site.theme.fonts.heading}/${site.theme.fonts.body}, primary ${site.theme.colors.primary}; sections: ${describePage(site.pages[0])}`;
}

export function describePage(page) {
  return page.sections.map((s) => {
    const kinds = [...new Set(s.columns.flatMap((c) => c.blocks.map((b) => b.type)))].join("+") || "empty";
    return `${s.props.background}/${s.props.layout}:${kinds}`;
  }).join(" | ");
}

export const PAGE_SYSTEM = `${GENERATE_SYSTEM}

YOU ARE DESIGNING ONE PAGE of a site whose home page design is approved. Use exactly the same theme, fonts, colours, tone of voice and kinds of section styling as the approved site, but give this page a layout that suits its purpose.
${CONTACT_RULES}
Respond with ONLY a JSON object: { "page": { "title", "slug", "seo": { "title", "description" }, "sections": [SECTION] } }. Do not change the theme, header or footer.`;

export function pagePrompt({ brief, concept, title, previous = [], wishes = "" }) {
  const prev = previous.length ? `\n\nThe owner has already seen these layouts for this page; make this one clearly DIFFERENT (different section order, backgrounds and block types):\n${previous.map((p, i) => `${i + 1}. ${p}`).join("\n")}` : "";
  const info = brief.pageInfo?.[title] ? `\nWhat the owner wants on this page: ${brief.pageInfo[title]}` : "";
  const extra = wishes ? `\nThe owner also asked: ${wishes}` : "";
  // The approved site and brief are the same for every page and every
  // "generate another", so they're cached; only the page request varies.
  return [
    { text: `APPROVED SITE (theme, header, footer and home page):\n${JSON.stringify(concept)}\n\nBUSINESS BRIEF:\n${formatBrief(brief)}`, cache: true },
    { text: `DESIGN THIS PAGE: "${title}" (slug "${slugify(title)}").${info}${extra}${prev}` },
  ];
}
