// Right-hand property panel for whatever is selected.

import { BLOCKS, SECTION_FIELDS, findNode, slugify } from "/admin/shared/schema.js";
import { h } from "../ui.js";
import { fieldControl } from "./fields.js";

export function createInspector({ state, canvas, root, head, pickImage, askAi }) {
  function linkOptions() {
    const s = state.get().site;
    const out = s.pages.map((p) => ({ value: p.slug === "index" ? "/" : `/${p.slug}`, label: `Page: ${p.title}` }));
    for (const p of s.pages) for (const sec of p.sections) if (sec.props.anchor) out.push({ value: p.id === state.page().id ? `#${sec.props.anchor}` : `/${p.slug === "index" ? "" : p.slug}#${sec.props.anchor}`, label: `Section #${sec.props.anchor} (${p.title})` });
    return out;
  }

  const ctx = () => ({ pickImage, links: linkOptions() });

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

  function renderBlock(sel) {
    const block = sel.node;
    const def = BLOCKS[block.type];
    head.textContent = def.label;
    root.append(actions(block.id));
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
    for (const f of SECTION_FIELDS) {
      if (f.showIf && !Object.entries(f.showIf).every(([k, v]) => section.props[k] === v)) continue;
      root.append(fieldControl(f, section.props[f.key], (v, opts) => set(`sec:${section.id}:${f.key}`, (site) => {
        const n = findNode(site, section.id);
        if (n) n.node.props[f.key] = f.key === "anchor" ? slugify(v).replace(/^page$/, "") : v;
      }, opts), ctx()));
    }
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
