// Right-hand property panel for whatever is selected.

import { BLOCKS, SECTION_FIELDS, HOVER_EFFECTS, HOVER_LABELS, ENTRANCE_EFFECTS, ENTRANCE_LABELS, findNode, slugify } from "/admin/shared/schema.js";
import { h } from "../ui.js";
import { fieldControl } from "./fields.js";

export function createInspector({ state, canvas, root, head, pickImage, askAi }) {
  function linkOptions() {
    const s = state.get().site;
    const out = s.pages.map((p) => ({ value: p.slug === "index" ? "/" : `/${p.slug}`, label: `Page: ${p.title}` }));
    for (const p of s.pages) for (const sec of p.sections) if (sec.props.anchor) out.push({ value: p.id === state.page().id ? `#${sec.props.anchor}` : `/${p.slug === "index" ? "" : p.slug}#${sec.props.anchor}`, label: `Section #${sec.props.anchor} (${p.title})` });
    return out;
  }

  const ctx = () => ({ pickImage, links: linkOptions(), device: state.get().device, setDevice: (d) => state.setDevice(d) });
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
    for (const f of SECTION_FIELDS) {
      if (f.showIf && !Object.entries(f.showIf).every(([k, v]) => section.props[k] === v)) continue;
      root.append(fieldControl(f, section.props[f.key], (v, opts) => set(`sec:${section.id}:${f.key}`, (site) => {
        const n = findNode(site, section.id);
        if (n) n.node.props[f.key] = f.key === "anchor" ? slugify(v).replace(/^page$/, "") : v;
      }, opts), ctx()));
    }
  }

  // ---- Style / Advanced tabs: everything lives in node.style -------------

  function styleField(node, key, field) {
    const st = node.style || {};
    root.append(fieldControl({ key, ...field }, st[key], (v, opts) => set(`style:${node.id}:${key}`, (site) => {
      const n = findNode(site, node.id);
      if (!n) return;
      const next = { ...(n.node.style || {}) };
      if (v === null || v === undefined || v === "" || v === "default") delete next[key];
      else next[key] = v;
      n.node.style = next;
    }, opts), ctx()));
  }
  const group = (title) => root.append(h("div", { class: "insp-group" }, title));
  const TEXTY = ["heading", "text", "buttons", "list", "card", "testimonial", "stats", "faq", "pricing", "form"];

  function styleControls(node, kind) {
    const isSection = kind === "section";
    if (isSection || TEXTY.includes(node.type)) {
      group("Text");
      if (!isSection) {
        styleField(node, "fontSize", { label: "Font size", type: "slider", min: 10, max: 120 });
        styleField(node, "fontWeight", { label: "Weight", type: "select", options: ["default", 300, 400, 500, 600, 700, 800, 900], labels: ["Default", "Light", "Normal", "Medium", "Semi-bold", "Bold", "Extra bold", "Black"] });
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

  function advancedControls(node, kind) {
    const isSection = kind === "section";
    group("Spacing");
    styleField(node, "margin", { label: "Margin (outside)", type: "box" });
    styleField(node, "padding", { label: "Padding (inside)", type: "box" });
    if (isSection) root.append(h("p", { class: "field-hint", style: { marginTop: "-6px" } }, "Padding here overrides the Spacing choice in Layout."));

    group("Size & position");
    styleField(node, "maxWidth", { label: isSection ? "Content width" : "Max width", type: "slider", min: 100, max: 1600 });
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
    head.textContent = "Header";
    const hd = state.get().site.header;
    const field = (f) => root.append(fieldControl(f, hd[f.key], (v, opts) => set(`header:${f.key}`, (site) => { site.header[f.key] = v; }, opts), ctx()));
    field({ key: "logoText", label: "Logo text", type: "text" });
    field({ key: "logoImage", label: "Logo image (optional, replaces text)", type: "image" });
    field({ key: "ctaText", label: "Button text (leave empty for none)", type: "text" });
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
    head.textContent = "Footer";
    const ft = state.get().site.footer;
    root.append(fieldControl({ key: "text", label: "Footer text", type: "textarea" }, ft.text, (v, opts) => set("footer:text", (site) => { site.footer.text = v; }, opts), ctx()));
    root.append(fieldControl({ ...menuField, label: "Footer links" }, ft.links, (v, opts) => set("footer:links", (site) => { site.footer.links = v; }, opts), ctx()));
  }

  function renderPage() {
    const page = state.page();
    head.textContent = "Page settings";
    root.append(h("div", { class: "empty-insp" }, h("div", { class: "big" }, "👆"), "Click anything on the page to edit it, or drag new blocks in from the Add tab."));
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
