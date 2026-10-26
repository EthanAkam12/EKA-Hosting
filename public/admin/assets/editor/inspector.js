// Right-hand property panel for whatever is selected.

import { BLOCKS, SECTION_FIELDS, FONT_CHOICES, BG_POSITIONS, BG_EFFECTS, BG_EFFECT_LABELS, HOVER_EFFECTS, HOVER_LABELS, ENTRANCE_EFFECTS, ENTRANCE_LABELS, findNode, slugify } from "/admin/shared/schema.js";
import { h, api } from "../ui.js";
import { fieldControl } from "./fields.js";

export function createInspector({ state, canvas, root, head, pickImage, askAi }) {
  function linkOptions() {
    const s = state.get().site;
    const out = s.pages.map((p) => ({ value: p.slug === "index" ? "/" : `/${p.slug}`, label: `Page: ${p.title}` }));
    for (const p of s.pages) for (const sec of p.sections) if (sec.props.anchor) out.push({ value: p.id === state.page().id ? `#${sec.props.anchor}` : `/${p.slug === "index" ? "" : p.slug}#${sec.props.anchor}`, label: `Section #${sec.props.anchor} (${p.title})` });
    return out;
  }

  const uploadFile = (file) => api(`/sites/${state.get().siteId}/media`, { method: "POST", raw: true, body: file, headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(file.name) } }).then((r) => r.url);
  const ctx = () => ({ pickImage, uploadFile, links: linkOptions(), device: state.get().device, setDevice: (d) => state.setDevice(d) });
  let tab = "content"; // Content / Style / Advanced, kept while moving between elements

  // Updates a value somewhere in the site. Text inputs don't rebuild the
  // panel (so the cursor stays put); structural changes do.
  function set(key, apply, opts) {
    state.mutate(apply, { key, source: opts?.rebuild ? null : "inspector" });
  }

  function render() {
    const sel = state.selected();
    root.replaceChildren();
    if (!sel) return renderPage();
    if (sel.kind === "block") return renderBlock(sel);
    if (sel.kind === "section") return renderSection(sel.node);
    if (sel.kind === "column") return renderSection(sel.section, true);
    if (sel.kind === "header") return renderHeader();
    if (sel.kind === "footer") return renderFooter();
  }

  function actions(id) {
    return h("div", { class: "insp-actions" },
      h("button", { class: "btn btn-sm", onclick: () => canvas.duplicate(id) }, "⧉ Duplicate"),
      h("button", { class: "btn btn-sm", onclick: () => askAi(id) }, "✦ Ask AI"),
      h("button", { class: "btn btn-sm btn-danger", onclick: () => canvas.remove(id) }, "Delete"),
    );
  }

  function tabs(labels) {
    root.append(h("div", { class: "insp-tabs", role: "tablist" }, Object.entries(labels).map(([key, label]) =>
      h("button", { class: tab === key ? "active" : "", role: "tab", onclick: () => { tab = key; render(); } }, label))));
  }

  function renderBlock(sel) {
    const block = sel.node;
    const def = BLOCKS[block.type];
    head.textContent = def.label;
    root.append(actions(block.id));
    tabs({ content: "Content", style: "Style", advanced: "Advanced" });
    if (tab === "style") return styleControls(block, "block");
    if (tab === "advanced") return advancedControls(block, "block");
    for (const f of def.fields) {
      root.append(fieldControl(f, block.props[f.key], (v, opts) => set(`prop:${block.id}:${f.key}`, (site) => {
        const n = findNode(site, block.id);
        if (n) n.node.props[f.key] = v;
      }, opts), ctx()));
    }
    if (block.type === "form") {
      root.append(h("p", { class: "field-hint" }, "Messages sent through this form appear under Site → Form messages."));
    }
  }

  function renderSection(section, fromColumn = false) {
    head.textContent = fromColumn ? "Column (section settings)" : "Section";
    if (fromColumn) root.append(h("p", { class: "field-hint", style: { marginTop: 0 } }, "Drag blocks from the Add tab into this column. The settings below apply to the whole section."));
    root.append(actions(section.id));
    tabs({ content: "Layout", style: "Style", advanced: "Advanced" });
    if (tab === "style") return styleControls(section, "section");
    if (tab === "advanced") return advancedControls(section, "section");
    if (section.props.background === "image") root.append(h("p", { class: "field-hint", style: { marginTop: 0 } }, "Tint, focus point, effects and more for the image are in the Style tab."));
    for (const f of SECTION_FIELDS) {
      if (f.hidden || (f.showIf && !Object.entries(f.showIf).every(([k, v]) => section.props[k] === v))) continue;
      root.append(fieldControl(f, section.props[f.key], (v, opts) => set(`sec:${section.id}:${f.key}`, (site) => {
        const n = findNode(site, section.id);
        if (n) n.node.props[f.key] = f.key === "anchor" ? slugify(v).replace(/^page$/, "") : v;
      }, opts), ctx()));
    }
  }

  // ---- Style / Advanced tabs: everything lives in node.style -------------

  // `bucket` is where the value lives on the node: "style", or "menu" for the header's menu links.
  function styleField(node, key, field, bucket = "style") {
    const st = node[bucket] || {};
    root.append(fieldControl({ key, ...field }, st[key], (v, opts) => set(`${bucket}:${node.id}:${key}`, (site) => {
      const n = node.id === "header" || node.id === "footer" ? { node: site[node.id] } : findNode(site, node.id);
      if (!n) return;
      const next = { ...(n.node[bucket] || {}) };
      if (v === null || v === undefined || v === "" || v === "default" || v === false) delete next[key];
      else next[key] = v;
      n.node[bucket] = next;
    }, opts), ctx()));
  }
  const group = (title) => root.append(h("div", { class: "insp-group" }, title));
  const TEXTY = ["heading", "text", "buttons", "list", "card", "testimonial", "stats", "faq", "pricing", "form"];

  function styleControls(node, kind) {
    const isSection = kind === "section";
    if (isSection || TEXTY.includes(node.type)) {
      group("Text");
      styleField(node, "fontFamily", { label: "Font", type: "select", options: ["default", ...Object.keys(FONT_CHOICES)], labels: ["Site default", ...Object.values(FONT_CHOICES).map((f) => f.label)] });
      if (isSection) root.append(h("p", { class: "field-hint", style: { marginTop: "-6px" } }, "Changes all the text in this section."));
      if (!isSection) {
        styleField(node, "fontSize", { label: "Font size", type: "slider", min: 10, max: 120 });
        styleField(node, "fontWeight", { label: "Weight", type: "select", options: ["default", 300, 400, 500, 600, 700, 800, 900], labels: ["Default", "Light", "Normal", "Medium", "Semi-bold", "Bold", "Extra bold", "Black"] });
        styleField(node, "textTransform", { label: "Capitals", type: "select", options: ["default", "uppercase", "lowercase", "capitalize", "none"], labels: ["Default", "ALL CAPITALS", "all lower case", "Capital Each Word", "As typed"] });
        styleField(node, "italic", { label: "Italic", type: "checkbox" });
        styleField(node, "lineHeight", { label: "Line height", type: "slider", min: 80, max: 250, step: 5, unit: "%" });
        styleField(node, "letterSpacing", { label: "Letter spacing", type: "slider", min: -3, max: 20 });
      }
      styleField(node, "color", { label: "Text colour", type: "coloropt" });
    }
    if (node.type === "buttons") {
      group("Buttons");
      styleField(node, "btnSize", { label: "Size", type: "select", options: ["default", "sm", "md", "lg", "xl"], labels: ["Site default", "Small", "Medium", "Large", "Extra large"] });
      styleField(node, "hover", { label: "Hover animation", type: "select", options: ["default", ...HOVER_EFFECTS], labels: ["Site default", ...HOVER_LABELS] });
      root.append(h("p", { class: "field-hint", style: { marginTop: "-6px" } }, "Hover over the buttons on the page to see it. Site-wide button settings are in the Style tab on the left."));
    }
    group("Background");
    if (isSection) root.append(h("p", { class: "field-hint", style: { marginTop: 0 } }, "Overrides the Background choice in Layout."));
    styleField(node, "bg", { label: "Colour", type: "coloropt" });
    if (node.style?.bg) styleField(node, "bg2", { label: "Fade into (gradient)", type: "coloropt" });
    backgroundImage(node, isSection);
    group("Border & corners");
    styleField(node, "borderWidth", { label: "Border width", type: "slider", min: 0, max: 20, placeholder: 0 });
    if (node.style?.borderWidth) {
      styleField(node, "borderStyle", { label: "Border style", type: "select", options: ["default", "dashed", "dotted", "double"], labels: ["Solid", "Dashed", "Dotted", "Double"] });
      styleField(node, "borderColor", { label: "Border colour", type: "coloropt" });
    }
    styleField(node, "radius", { label: "Corner radius", type: "slider", min: 0, max: 100, placeholder: isSection ? 0 : state.get().site.theme.radius });
    styleField(node, "shadow", { label: "Shadow", type: "select", options: ["default", "sm", "md", "lg", "xl"], labels: ["None", "Small", "Medium", "Large", "Extra large"] });
    if (isSection) {
      group("Columns");
      styleField(node, "gap", { label: "Space between columns", type: "slider", min: 0, max: 120, placeholder: 40 });
    }
  }

  // Background image: picture, how it sits, a tint over it, effects and filters.
  function backgroundImage(node, isSection) {
    const st = node.style || {};
    group("Background image");
    const image = isSection ? (node.props.background === "image" ? node.props.image : "") : st.bgImage;
    if (isSection) {
      root.append(fieldControl({ key: "image", label: "Image", type: "image" }, image, (v) => set(`sec:${node.id}:image`, (site) => {
        const n = findNode(site, node.id);
        if (!n) return;
        n.node.props.image = v;
        // Choosing a picture switches the section to an image background (white text); removing it goes back.
        n.node.props.background = v ? "image" : n.node.props.background === "image" ? "default" : n.node.props.background;
      }, { rebuild: true }), ctx()));
    } else {
      styleField(node, "bgImage", { label: "Image", type: "image" });
    }
    if (image) {
      styleField(node, "bgImageMobile", { label: "Different image on phones (optional)", type: "image" });
      styleField(node, "bgPos", { label: "Focus on", type: "select", options: ["default", ...BG_POSITIONS.slice(1)], labels: ["Centre", "Top", "Bottom", "Left", "Right", "Top left", "Top right", "Bottom left", "Bottom right"] });
      styleField(node, "bgSize", { label: "Fit", type: "select", options: ["default", "contain"], labels: ["Fill the space (crop)", "Show the whole image"] });
      styleField(node, "bgFixed", { label: "Stay still while the page scrolls", type: "checkbox" });
      styleField(node, "bgRepeat", { label: "Repeat as a pattern", type: "checkbox" });
    }
    group("Background video");
    styleField(node, "bgVideo", { label: "Video", type: "video", hint: "Plays silently on a loop behind the content. An uploaded MP4 (10–20 seconds) is fastest; YouTube and Vimeo work but load their players. The image above shows while it loads, and in Preview (the builder's preview blocks autoplay); the video plays on the live site." });
    if (st.bgVideo) {
      if (isSection && node.props.background !== "image") root.append(h("button", { class: "btn btn-sm", style: { marginBottom: "12px" }, onclick: () => set(`sec:${node.id}:background`, (site) => { const n = findNode(site, node.id); if (n) n.node.props.background = "image"; }, { rebuild: true }) }, "Use white text and a dark tint"));
      styleField(node, "bgVideoPhones", { label: "Play on phones too (uses their data)", type: "checkbox" });
    }
    group("Tint over the image");
    if (!image) root.append(h("p", { class: "field-hint", style: { marginTop: 0 } }, "A see-through colour on top of the background. Most useful over an image, to make text readable."));
    styleField(node, "tint", { label: "Tint colour", type: "coloropt" });
    styleField(node, "tint2", { label: "Fade into (gradient tint)", type: "coloropt" });
    if (st.tint2) styleField(node, "tintDir", { label: "Gradient direction", type: "select", options: ["default", "up", "right", "left", "diagonal", "radial"], labels: ["Top to bottom", "Bottom to top", "Left to right", "Right to left", "Diagonal", "From the centre"] });
    styleField(node, "tintOpacity", { label: "Tint strength", type: "slider", min: 0, max: 100, unit: "%", placeholder: isSection && node.props.background === "image" ? node.props.overlay : st.tint ? 50 : 0 });
    if (image) {
      group("Image effects");
      styleField(node, "bgEffect", { label: "Effect", type: "select", options: ["default", ...BG_EFFECTS], labels: ["None", ...BG_EFFECT_LABELS] });
      if (st.bgEffect === "fade" || st.bgEffect === "zoom-out") root.append(h("p", { class: "field-hint", style: { marginTop: "-6px" } }, "Plays on the live site (use Preview); switched off while editing."));
      if (st.bgEffect === "parallax" && st.bgFixed) root.append(h("p", { class: "field-hint", style: { marginTop: "-6px", color: "var(--danger)" } }, "Parallax and \"stay still\" don't mix: untick one."));
      styleField(node, "bgBlur", { label: "Blur", type: "slider", min: 0, max: 30, placeholder: 0 });
      styleField(node, "bgGray", { label: "Black & white", type: "slider", min: 0, max: 100, unit: "%", placeholder: 0 });
      styleField(node, "bgBright", { label: "Brightness", type: "slider", min: 20, max: 200, step: 5, unit: "%", placeholder: 100 });
    }
  }

  function advancedControls(node, kind) {
    const isSection = kind === "section";
    group("Spacing");
    styleField(node, "margin", { label: "Margin (outside)", type: "box" });
    styleField(node, "padding", { label: "Padding (inside)", type: "box" });
    if (isSection) root.append(h("p", { class: "field-hint", style: { marginTop: "-6px" } }, "Padding here overrides the Spacing choice in Layout."));

    group("Size & position");
    styleField(node, "maxWidth", { label: isSection ? "Content width" : "Max width", type: "slider", min: 100, max: 1600 });
    styleField(node, "minHeight", { label: "Min height", type: "slider", min: 0, max: 1200, step: 10 });
    if (!isSection && node.style?.maxWidth) styleField(node, "align", { label: "Position", type: "select", options: ["default", "center", "right"], labels: ["Left", "Centre", "Right"] });

    group("Motion");
    const siteMotion = state.get().site.theme.layout.motion;
    styleField(node, "animation", isSection
      ? { label: "Entrance animation", type: "select", options: ["default", ...ENTRANCE_EFFECTS], labels: [`Site default (${ENTRANCE_LABELS[ENTRANCE_EFFECTS.indexOf(siteMotion)]})`, ...ENTRANCE_LABELS] }
      : { label: "Entrance animation", type: "select", options: ENTRANCE_EFFECTS, labels: ENTRANCE_LABELS });
    const anim = node.style?.animation || (isSection ? siteMotion : "none");
    if (anim !== "none") {
      styleField(node, "speed", { label: "Speed", type: "select", options: ["default", "fast", "slow"], labels: ["Normal", "Fast", "Slow"] });
      styleField(node, "delay", { label: "Delay", type: "slider", min: 0, max: 2000, step: 50, unit: "ms", placeholder: 0 });
      root.append(h("div", { class: "play-row" }, h("button", { class: "btn btn-sm", onclick: () => canvas.playAnimation(node.id) }, "▶ Preview animation")));
      root.append(h("p", { class: "field-hint", style: { marginTop: "-6px" } }, "Plays as it scrolls into view (the first section plays when the page opens). Off while editing, and for visitors who turn off motion."));
    }
    if (node.type !== "buttons") {
      styleField(node, "hover", { label: "Hover effect", type: "select", options: ["default", ...HOVER_EFFECTS.filter((x) => x !== "none")], labels: ["None", ...HOVER_LABELS.slice(1)] });
    }

    group("Responsive");
    styleField(node, "hide", { label: "Hide on", type: "hide" });
    if (node.style?.hide) root.append(h("p", { class: "field-hint", style: { marginTop: "-6px" } }, "Hidden items show faded here so you can still edit them."));
  }

  function renderHeader() {
    head.textContent = "Header (every page)";
    const hd = state.get().site.header;
    tabs({ content: "Content", style: "Style" });
    if (tab !== "content") return frameStyle({ id: "header", style: hd.style, menu: hd.menu });
    const field = (f) => root.append(fieldControl(f, hd[f.key], (v, opts) => set(`header:${f.key}`, (site) => { site.header[f.key] = v; }, opts), ctx()));
    field({ key: "logoText", label: "Logo text", type: "text" });
    field({ key: "logoImage", label: "Logo image (optional, replaces text)", type: "image" });
    const slider = (key, label, min, max, def) => root.append(fieldControl({ key, label, type: "slider", min, max, placeholder: def ?? "auto" }, hd[key] === def ? null : hd[key], (v) => set(`header:${key}`, (site) => { site.header[key] = v ?? def; }), ctx()));
    if (hd.logoImage) {
      slider("logoHeight", "Logo size", 20, 160, 40);
      slider("logoHeightMobile", "Logo size on phones", 16, 120, null);
    } else {
      slider("logoTextSize", "Logo text size", 12, 72, 20);
    }
    field({ key: "ctaText", label: "Button text (leave empty for none)", type: "text" });
    field({ key: "ctaStyle", label: "Button style", type: "select", options: ["primary", "secondary", "outline", "light", "dark"], labels: ["Main colour", "Accent colour", "Outline", "White", "Dark"] });
    field({ key: "ctaHref", label: "Button link", type: "url" });
    field({ key: "sticky", label: "Stick to top when scrolling", type: "checkbox" });
    root.append(h("hr", { class: "sep" }));
    const auto = hd.links === null;
    root.append(fieldControl({ key: "auto", label: "Build the menu from my pages automatically", type: "checkbox" }, auto, (v) => set("header:links", (site) => {
      site.header.links = v ? null : site.pages.map((p) => ({ text: p.title, href: p.slug === "index" ? "/" : `/${p.slug}` }));
    }, { rebuild: true }), ctx()));
    if (!auto) {
      root.append(fieldControl(menuField, hd.links, (v, opts) => set("header:links", (site) => { site.header.links = v.length ? v : null; }, opts), ctx()));
    }
  }

  function renderFooter() {
    head.textContent = "Footer (every page)";
    const ft = state.get().site.footer;
    tabs({ content: "Content", style: "Style" });
    if (tab !== "content") return frameStyle({ id: "footer", style: ft.style });
    root.append(fieldControl({ key: "text", label: "Footer text", type: "textarea" }, ft.text, (v, opts) => set("footer:text", (site) => { site.footer.text = v; }, opts), ctx()));
    root.append(fieldControl({ ...menuField, label: "Footer links" }, ft.links, (v, opts) => set("footer:links", (site) => { site.footer.links = v; }, opts), ctx()));
  }

  // Header and footer: the same style controls as a section, on one tab.
  function frameStyle(node) {
    group("Colours & text");
    styleField(node, "bg", { label: "Background", type: "coloropt" });
    styleField(node, "color", { label: "Text & link colour", type: "coloropt" });
    styleField(node, "fontFamily", { label: "Font", type: "select", options: ["default", ...Object.keys(FONT_CHOICES)], labels: ["Site default", ...Object.values(FONT_CHOICES).map((f) => f.label)] });
    group("Border & shadow");
    styleField(node, "borderWidth", { label: "Border width", type: "slider", min: 0, max: 20, placeholder: 0 });
    if (node.style?.borderWidth) styleField(node, "borderColor", { label: "Border colour", type: "coloropt" });
    styleField(node, "shadow", { label: "Shadow", type: "select", options: ["default", "sm", "md", "lg", "xl"], labels: ["None", "Small", "Medium", "Large", "Extra large"] });
    group("Spacing");
    styleField(node, "padding", { label: "Padding (inside)", type: "box" });
    if (node.id === "header") menuControls(node);
  }

  function menuControls(node) {
    const mf = (key, field) => styleField(node, key, field, "menu");
    group("Menu links");
    mf("font", { label: "Font", type: "select", options: ["default", ...Object.keys(FONT_CHOICES)], labels: ["Site default", ...Object.values(FONT_CHOICES).map((f) => f.label)] });
    mf("size", { label: "Size", type: "slider", min: 10, max: 40, placeholder: 16 });
    mf("weight", { label: "Weight", type: "select", options: ["default", 300, 400, 500, 600, 700, 800, 900], labels: ["Default", "Light", "Normal", "Medium", "Semi-bold", "Bold", "Extra bold", "Black"] });
    mf("transform", { label: "Capitals", type: "select", options: ["default", "uppercase", "lowercase", "capitalize"], labels: ["As typed", "ALL CAPITALS", "all lower case", "Capital Each Word"] });
    mf("letterSpacing", { label: "Letter spacing", type: "slider", min: -3, max: 20, placeholder: 0 });
    mf("color", { label: "Colour", type: "coloropt" });
    mf("hoverColor", { label: "Colour on hover", type: "coloropt" });
    mf("activeColor", { label: "Colour of the current page", type: "coloropt" });
    mf("hover", { label: "Hover effect", type: "select", options: ["default", "underline", "overline", "pill", "none"], labels: ["Change colour", "Underline slides in", "Line above slides in", "Highlight (pill)", "None"] });
    mf("gap", { label: "Space between links", type: "slider", min: 0, max: 80, placeholder: 22 });
    mf("align", { label: "Position", type: "select", options: ["default", "center", "left"], labels: ["Right", "Centre", "Left, next to the logo"] });
    root.append(h("p", { class: "field-hint", style: { marginTop: "-6px" } }, "Hover over the menu on the page to try it. On phones the menu folds into the ☰ button."));
  }

  function renderPage() {
    const page = state.page();
    head.textContent = "Page settings";
    root.append(h("div", { class: "empty-insp" }, h("div", { class: "big" }, "👆"), "Click anything on the page to edit it, or drag new blocks in from the Add tab."));
    root.append(h("div", { class: "row", style: { justifyContent: "center", marginTop: "-6px" } },
      h("button", { class: "btn btn-sm", onclick: () => state.select("header") }, "Edit header"),
      h("button", { class: "btn btn-sm", onclick: () => state.select("footer") }, "Edit footer")));
    root.append(h("hr", { class: "sep" }));
    const pf = (f, get, apply) => root.append(fieldControl(f, get(), (v, opts) => set(`page:${page.id}:${f.key}`, (site) => {
      const p = site.pages.find((x) => x.id === page.id);
      if (p) apply(p, v);
    }, opts), ctx()));
    pf({ key: "title", label: "Page name (shown in the menu)", type: "text" }, () => page.title, (p, v) => { p.title = v; });
    if (page.slug !== "index") pf({ key: "slug", label: "Web address", type: "text" }, () => page.slug, (p, v) => { p.slug = slugify(v); });
    pf({ key: "seoTitle", label: "Google title (optional)", type: "text" }, () => page.seo.title, (p, v) => { p.seo.title = v; });
    pf({ key: "seoDesc", label: "Google description", type: "textarea" }, () => page.seo.description, (p, v) => { p.seo.description = v; });
    root.append(h("p", { class: "field-hint" }, "The description shows under your link in search results. Aim for 120–155 characters."));
  }

  return { render };
}

const menuField = {
  key: "links", label: "Menu links", type: "list", itemLabel: "text",
  itemDefaults: () => ({ text: "Link", href: "/" }),
  itemFields: [
    { key: "text", label: "Text", type: "text" },
    { key: "href", label: "Link", type: "url" },
  ],
};
