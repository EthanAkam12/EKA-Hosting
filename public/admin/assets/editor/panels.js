// Left-hand tabs: Add, AI, Pages, Style, Site.

import { BLOCKS, FONT_CHOICES, HOVER_EFFECTS, HOVER_LABELS, ENTRANCE_EFFECTS, ENTRANCE_LABELS, createPage, createSection, findNode } from "/admin/shared/schema.js";
import { h, api, waitForJob, toast, modal, confirmDialog, timeAgo } from "../ui.js";
import { fieldControl } from "./fields.js";
import { SECTION_TEMPLATES, EMPTY_LAYOUTS } from "./templates.js";
import { followDeploy } from "./deploy-ui.js";
import { showChecklist, siteIssues } from "./checklist.js";
import { contrast } from "/admin/shared/checks.js";

const PALETTES = [
  { name: "Ocean", colors: { primary: "#2563eb", accent: "#f59e0b", background: "#ffffff", surface: "#f1f5fb", text: "#111827", muted: "#6b7280", dark: "#0f172a" } },
  { name: "Forest", colors: { primary: "#15803d", accent: "#ca8a04", background: "#ffffff", surface: "#f2f7f2", text: "#14201a", muted: "#5f6f66", dark: "#10241a" } },
  { name: "Sunset", colors: { primary: "#ea580c", accent: "#be185d", background: "#fffdfb", surface: "#fdf3ec", text: "#1f1410", muted: "#7a6a62", dark: "#2a1710" } },
  { name: "Royal", colors: { primary: "#7c3aed", accent: "#ec4899", background: "#ffffff", surface: "#f6f3fd", text: "#1b1530", muted: "#6c6684", dark: "#1e1530" } },
  { name: "Mono", colors: { primary: "#111111", accent: "#d4a017", background: "#ffffff", surface: "#f4f4f4", text: "#111111", muted: "#666666", dark: "#111111" } },
  { name: "Teal", colors: { primary: "#0f766e", accent: "#f97316", background: "#ffffff", surface: "#eff7f6", text: "#102a27", muted: "#5d706d", dark: "#0b2522" } },
];

const AI_SUGGESTIONS = [
  "Make the hero headline punchier",
  "Add a pricing section with 3 plans",
  "Add an FAQ with 5 common questions",
  "Make the colours warmer and more premium",
  "Rewrite all text in a friendlier tone",
  "Add an About page",
];

export function createPanels({ state, canvas, root, tabs, pickImage, onMetaChange }) {
  let active = "add";
  let aiScope = null;
  const aiLog = [];
  let aiBusy = false;
  let aiProgress = null;

  function show(tab) {
    active = tab;
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    render();
  }

  function render() {
    root.replaceChildren();
    ({ add: renderAdd, ai: renderAi, pages: renderPages, layers: renderLayers, theme: renderTheme, settings: renderSettings })[active]();
  }

  // -------------------------------------------------------------- Add -----

  function renderAdd() {
    root.append(h("p", { class: "small muted", style: { marginTop: 0 } }, "Drag onto the page, or click to add after the selected item."));
    const groups = {};
    for (const [type, def] of Object.entries(BLOCKS)) (groups[def.group] ||= []).push([type, def]);
    for (const [group, items] of Object.entries(groups)) {
      root.append(h("div", { class: "group-title" }, group));
      root.append(h("div", { class: "palette" }, items.map(([type, def]) =>
        h("div", { class: "pal-item", role: "button", tabindex: "0", title: `Add ${def.label}`,
          onpointerdown: (e) => canvas.startDrag(e, { kind: "new-block", type }, def.label),
          onkeydown: (e) => { if (e.key === "Enter") canvas.insertByClick({ kind: "new-block", type }); } },
          h("span", { class: "ic" }, def.icon), def.label))));
    }
    root.append(h("div", { class: "group-title" }, "Ready-made sections"));
    root.append(h("div", { class: "tpl-list" }, SECTION_TEMPLATES.map((t) =>
      h("div", { class: "tpl", role: "button", tabindex: "0",
        onpointerdown: (e) => canvas.startDrag(e, { kind: "new-section", make: t.make }, t.name),
        onkeydown: (e) => { if (e.key === "Enter") canvas.insertByClick({ kind: "new-section", make: t.make }); } },
        h("span", { class: "ic" }, t.icon), h("span", {}, t.name, h("small", {}, t.desc))))));
    root.append(h("div", { class: "group-title" }, "Empty sections"));
    root.append(h("div", { class: "palette" }, EMPTY_LAYOUTS.map((l) =>
      h("div", { class: "pal-item", role: "button", tabindex: "0",
        onpointerdown: (e) => canvas.startDrag(e, { kind: "new-section", make: () => createSection({ layout: l.layout }) }, l.label),
        onkeydown: (e) => { if (e.key === "Enter") canvas.insertByClick({ kind: "new-section", make: () => createSection({ layout: l.layout }) }); } },
        h("span", { class: "ic" }, l.layout.split("-").map(() => "▯").join("")), l.label))));
  }

  // --------------------------------------------------------------- AI -----

  function scopeLabel(id) {
    const f = findNode(state.get().site, id);
    if (!f) return null;
    if (f.kind === "section") return "the selected section";
    if (f.kind === "block") {
      const p = f.node.props;
      const text = p.text || p.title || p.name || p.quote || "";
      return `${BLOCKS[f.node.type].label}${text ? ` "${String(text).slice(0, 30)}${text.length > 30 ? "…" : ""}"` : ""}`;
    }
    return null;
  }

  // Change requests typed in the new-site wizard that weren't done yet (no AI
  // key at the time): a to-do list for this page and the whole site.
  function notesCard(apply) {
    const s = state.get();
    const notes = s.meta?.notes || {};
    const page = state.page();
    const here = ["_site", page.slug].filter((k) => notes[k]);
    const elsewhere = s.site.pages.filter((p) => p.id !== page.id && notes[p.slug]);
    if (!here.length && !elsewhere.length) return null;
    const done = async (key) => {
      const next = { ...notes };
      delete next[key];
      try { const { meta } = await api(`/sites/${s.siteId}/meta`, { method: "PATCH", body: { notes: next } }); onMetaChange(meta); render(); } catch (e) { toast(e.message, { error: true }); }
    };
    return h("div", { class: "notes-card" },
      h("div", { class: "group-title", style: { marginTop: 0 } }, "Your change requests"),
      here.map((key) => h("div", { class: "note" },
        h("div", { class: "small", style: { fontWeight: 700 } }, key === "_site" ? "Whole site" : `${page.title} page`),
        h("p", {}, notes[key]),
        h("div", { class: "row" },
          apply ? h("button", { class: "btn btn-sm btn-primary", disabled: aiBusy, onclick: () => apply(key === "_site" ? notes[key] : `On the ${page.title} page: ${notes[key]}`, () => done(key)) }, "✦ Do it with AI") : null,
          h("button", { class: "btn btn-sm", onclick: () => done(key) }, "✓ Done")))),
      elsewhere.length ? h("p", { class: "field-hint" }, "Also requests for: ", elsewhere.map((p, i) => [i ? ", " : "", h("a", { href: "#", onclick: (e) => { e.preventDefault(); state.setPage(p.id); } }, p.title)])) : null,
    );
  }

  function renderAi() {
    const s = state.get();
    if (!s.aiEnabled) {
      const card = notesCard(null);
      if (card) root.append(card);
      root.append(h("div", { class: "notice" }, "AI isn't set up yet, so written changes can't be done automatically. Add your Anthropic API key to settings.txt and restart the builder. You can still change everything by hand."));
      return;
    }
    if (aiScope && !findNode(s.site, aiScope)) aiScope = null;
    const log = h("div", { class: "ai-log" },
      aiLog.length ? aiLog.map((m) => h("div", { class: `ai-msg ${m.role}` }, m.text))
        : h("div", { class: "ai-msg bot" }, "Tell me what to change, like you'd tell a designer. For example: “add a gallery section after the services”, “make the site feel more luxurious” or “translate the home page into Spanish”.\n\nSelect something on the page first to change just that part."),
    );
    const input = h("textarea", { class: "textarea", rows: "4", placeholder: aiScope ? "What should change about the selected item?" : "Describe a change to the site…", disabled: aiBusy });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); });
    const sendBtn = h("button", { class: "btn btn-primary btn-block", onclick: send, disabled: aiBusy }, aiBusy ? h("span", { class: "spinner" }) : null, aiBusy ? "Working…" : "Apply change");
    const progress = (aiProgress = h("div", { class: "small muted", style: { marginTop: "8px", minHeight: "1.4em" } }));

    const card = notesCard((text, onDone) => { aiScope = null; input.value = text; send().then((ok) => { if (ok) onDone(); }); });
    if (card) root.append(card);
    root.append(log);
    const label = aiScope && scopeLabel(aiScope);
    if (label) root.append(h("div", { class: "ai-scope" }, "Changing: ", h("strong", {}, label), h("button", { class: "icon-btn", title: "Change the whole site instead", "aria-label": "Clear selection", onclick: () => { aiScope = null; render(); } }, "✕")));
    root.append(input, h("div", { style: { marginTop: "8px" } }, sendBtn), progress);
    root.append(h("div", { class: "chips" }, AI_SUGGESTIONS.map((t) => h("button", { class: "chip", disabled: aiBusy, onclick: () => { input.value = t; input.focus(); } }, t))));
    root.append(h("p", { class: "field-hint", style: { marginTop: "14px" } }, "Every AI change can be undone with ↶, and is saved in History."));
    log.scrollTop = log.scrollHeight;
    if (!aiBusy) input.focus();

    async function send() {
      const instruction = input.value.trim();
      if (!instruction || aiBusy) return false;
      aiBusy = true;
      aiLog.push({ role: "user", text: instruction });
      render();
      try {
        await state.flush();
        const st = state.get();
        const { jobId } = await api(`/sites/${st.siteId}/ai`, { method: "POST", body: { instruction, selectedId: aiScope, pageId: st.pageId, site: st.site } });
        const result = await waitForJob(jobId, (job) => {
          if (aiProgress && job.status === "running") aiProgress.textContent = job.progress.chars ? `Writing changes… ${Math.round(job.elapsedMs / 1000)}s` : `Thinking… ${Math.round(job.elapsedMs / 1000)}s`;
        });
        if (result.changed) state.replaceSite(result.site, `AI: ${instruction.slice(0, 60)}`);
        aiLog.push({ role: "bot", text: result.summary });
        return result.changed;
      } catch (err) {
        aiLog.push({ role: "err", text: err.message });
        return false;
      } finally {
        aiBusy = false;
        if (active === "ai") render();
      }
    }
  }

  function askAi(id) {
    aiScope = id || null;
    show("ai");
  }

  // ------------------------------------------------------------- Pages ----

  function renderPages() {
    const s = state.get();
    root.append(h("div", { class: "group-title" }, "Pages"));
    s.site.pages.forEach((p, i) => {
      root.append(h("div", { class: `page-row${p.id === s.pageId ? " active" : ""}`, onclick: () => state.setPage(p.id) },
        h("span", { class: "name" }, p.title),
        h("span", { class: "slug" }, p.slug === "index" ? "/" : `/${p.slug}`),
        i > 1 ? h("button", { class: "icon-btn", title: "Move up", onclick: (e) => { e.stopPropagation(); movePage(i, -1); } }, "↑") : null,
        i > 0 && i < s.site.pages.length - 1 ? h("button", { class: "icon-btn", title: "Move down", onclick: (e) => { e.stopPropagation(); movePage(i, 1); } }, "↓") : null,
        i > 0 ? h("button", { class: "icon-btn", title: "Duplicate page", onclick: (e) => { e.stopPropagation(); duplicatePage(p.id); } }, "⧉") : null,
        i > 0 ? h("button", { class: "icon-btn", title: "Delete page", onclick: (e) => { e.stopPropagation(); deletePage(p); } }, "🗑") : null,
      ));
    });
    root.append(h("button", { class: "btn btn-block", style: { marginTop: "12px" }, onclick: addPage }, "+ Add page"));
    root.append(h("p", { class: "field-hint" }, "Rename a page or set its Google description in the right-hand panel when nothing is selected. The home page always stays first."));
  }

  function movePage(i, d) {
    state.mutate((site) => {
      const j = i + d;
      if (j < 1 || j >= site.pages.length) return;
      [site.pages[i], site.pages[j]] = [site.pages[j], site.pages[i]];
    });
  }

  function duplicatePage(id) {
    state.mutate((site) => {
      const i = site.pages.findIndex((p) => p.id === id);
      const copy = JSON.parse(JSON.stringify(site.pages[i]).replace(/"id":"[^"]+"/g, () => `"id":""`));
      copy.title += " (copy)";
      copy.slug += "-copy";
      site.pages.splice(i + 1, 0, copy);
    });
  }

  async function deletePage(p) {
    if (!(await confirmDialog(`Delete the "${p.title}" page? You can undo this.`, { okText: "Delete page", danger: true }))) return;
    state.mutate((site) => { site.pages = site.pages.filter((x) => x.id !== p.id); });
  }

  function addPage() {
    const name = h("input", { class: "input", placeholder: "e.g. About us" });
    const describe = h("textarea", { class: "textarea", rows: "3", placeholder: "Optional: what should be on it? The AI will build it." });
    const aiOn = state.get().aiEnabled;
    const m = modal({
      title: "New page",
      body: h("div", {},
        h("div", { class: "field" }, h("label", {}, "Page name"), name),
        aiOn ? h("div", { class: "field" }, h("label", {}, "Build it with AI"), describe) : null,
      ),
      footer: [h("button", { class: "btn", onclick: () => m.close() }, "Cancel"), h("button", { class: "btn btn-primary", onclick: create }, "Create page")],
    });
    function create() {
      const title = name.value.trim() || "New page";
      const page = createPage(title);
      state.mutate((site) => { site.pages.push(page); });
      const added = state.get().site.pages.find((p) => p.id === page.id);
      if (added) state.setPage(added.id);
      m.close();
      if (aiOn && describe.value.trim()) {
        aiScope = null;
        show("ai");
        const input = root.querySelector("textarea");
        input.value = `Build the "${title}" page (slug "${added?.slug}") with suitable sections. ${describe.value.trim()}`;
        root.querySelector(".btn-primary")?.click();
      }
    }
  }

  // ----------------------------------------------------------- Layers -----

  // A short name for a section or block, from what's in it.
  function layerName(node, kind) {
    const strip = (t) => String(t || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (kind === "section") {
      const heading = node.columns.flatMap((c) => c.blocks).find((b) => b.type === "heading");
      return heading ? strip(heading.props.text) : `${node.props.layout === "1" ? "One" : node.columns.length} column${node.columns.length > 1 ? "s" : ""}`;
    }
    const p = node.props;
    if (node.type === "buttons") return p.items.map((i) => i.text).filter(Boolean).join(", ");
    if (node.type === "image") return p.alt || p.caption || "";
    if (node.type === "marquee") return p.items.map((i) => i.text).filter(Boolean).join(" · ");
    return strip(p.text || p.title || p.html || p.quote || p.name || p.address || "");
  }

  function renderLayers() {
    const s = state.get();
    const page = state.page();
    const sel = s.selectedId;
    root.append(h("p", { class: "small muted", style: { marginTop: 0 } }, "Everything on this page, top to bottom. Click to select; right-click on the page for more."));
    const toggleHidden = (id) => state.mutate((site) => {
      const f = findNode(site, id);
      if (!f) return;
      const hidden = f.node.style?.hide?.d && f.node.style?.hide?.t && f.node.style?.hide?.m;
      f.node.style = { ...(f.node.style || {}), hide: hidden ? {} : { d: true, t: true, m: true } };
    }, { label: "Hid or showed an item" });
    const row = (node, kind, depth) => {
      const hidden = node.style?.hide && Object.keys(node.style.hide).length;
      const name = layerName(node, kind);
      const label = kind === "section" ? "Section" : BLOCKS[node.type]?.label || node.type;
      return h("div", { class: `layer${sel === node.id ? " on" : ""}${hidden ? " hidden-layer" : ""}`, style: { paddingLeft: `${8 + depth * 16}px` }, role: "button", tabindex: "0",
        onclick: () => { state.select(node.id); canvas.scrollTo(node.id); },
        onkeydown: (e) => { if (e.key === "Enter") { state.select(node.id); canvas.scrollTo(node.id); } } },
        h("span", { class: "layer-ic" }, kind === "section" ? "▭" : BLOCKS[node.type]?.icon || "•"),
        h("span", { class: "grow layer-name" }, h("strong", {}, label), name ? ` ${name.slice(0, 40)}` : ""),
        hidden ? h("span", { class: "small muted", title: "Hidden on some screens" }, "hidden") : null,
        h("button", { class: "icon-btn", title: hidden ? "Show everywhere" : "Hide everywhere", onclick: (e) => { e.stopPropagation(); toggleHidden(node.id); } }, hidden ? "◌" : "◉"),
        h("button", { class: "icon-btn", title: "Move up", onclick: (e) => { e.stopPropagation(); canvas.moveBy(node.id, -1); } }, "↑"),
        h("button", { class: "icon-btn", title: "Move down", onclick: (e) => { e.stopPropagation(); canvas.moveBy(node.id, 1); } }, "↓"),
      );
    };
    const list = h("div", { class: "layers" },
      h("div", { class: `layer${sel === "header" ? " on" : ""}`, role: "button", tabindex: "0", onclick: () => state.select("header") }, h("span", { class: "layer-ic" }, "▔"), h("span", { class: "grow layer-name" }, h("strong", {}, "Header"))));
    for (const section of page.sections) {
      list.append(row(section, "section", 0));
      section.columns.forEach((col, ci) => {
        if (section.columns.length > 1) list.append(h("div", { class: "layer col-layer", style: { paddingLeft: "24px" }, onclick: () => state.select(col.id) }, h("span", { class: "small muted" }, `Column ${ci + 1}${col.blocks.length ? "" : " (empty)"}`)));
        for (const block of col.blocks) list.append(row(block, "block", section.columns.length > 1 ? 2 : 1));
      });
    }
    list.append(h("div", { class: `layer${sel === "footer" ? " on" : ""}`, role: "button", tabindex: "0", onclick: () => state.select("footer") }, h("span", { class: "layer-ic" }, "▁"), h("span", { class: "grow layer-name" }, h("strong", {}, "Footer"))));
    root.append(list);
    root.querySelector(".layer.on")?.scrollIntoView({ block: "nearest" });
  }

  // ------------------------------------------------------------ Style -----

  function renderTheme() {
    const theme = state.get().site.theme;
    const set = (key, apply, opts) => state.mutate(apply, { key, source: opts?.rebuild ? null : "panel" });

    root.append(h("div", { class: "group-title" }, "Colour presets"));
    root.append(h("div", { class: "palette" }, PALETTES.map((p) =>
      h("button", { class: "pal-item", style: { cursor: "pointer" }, onclick: () => set("theme:preset", (site) => { site.theme.colors = { ...p.colors }; }, { rebuild: true }) },
        h("span", { class: "ic", style: { display: "flex", gap: "2px" } }, ["primary", "accent", "dark"].map((k) => h("span", { style: { width: "12px", height: "18px", borderRadius: "3px", background: p.colors[k] } }))),
        p.name))));

    root.append(h("div", { class: "group-title" }, "Colours"));
    const names = { primary: "Main brand colour", accent: "Accent", background: "Page background", surface: "Light panels", text: "Text", muted: "Soft text", dark: "Dark sections & footer" };
    for (const [k, label] of Object.entries(names)) {
      root.append(fieldControl({ key: k, label, type: "color" }, theme.colors[k], (v) => set(`theme:c:${k}`, (site) => { site.theme.colors[k] = v; }), {}));
    }
    // Readability of the main colour pairs (contrast 4.5:1 is the usual minimum for text).
    const c = theme.colors;
    const pairs = [
      [c.text, c.background, "Text on the page background"],
      [c.text, c.surface, "Text on light panels"],
      [c.muted, c.background, "Soft text on the page background"],
      ["#111111", c.accent, "Accent-coloured buttons (dark text)"],
      [c.primary, c.background, "Links in the main colour"],
    ].filter(([a, b]) => contrast(a, b) < 4.5);
    if (pairs.length) root.append(h("div", { class: "notice", style: { fontSize: "13px", marginBottom: "14px" } }, h("strong", {}, "Hard to read: "), pairs.map(([, , what]) => what).join("; "), ". Make the colours more different from each other."));
    root.append(h("div", { class: "group-title", style: { marginTop: "8px" } }, "Fonts"));
    const fontField = (key, label) => ({ key, label, type: "select", options: Object.keys(FONT_CHOICES), labels: Object.values(FONT_CHOICES).map((f) => f.label) });
    root.append(fieldControl(fontField("heading", "Headings"), theme.fonts.heading, (v) => set("theme:fh", (site) => { site.theme.fonts.heading = v; }, { rebuild: true }), {}));
    root.append(fieldControl(fontField("body", "Body text"), theme.fonts.body, (v) => set("theme:fb", (site) => { site.theme.fonts.body = v; }, { rebuild: true }), {}));
    root.append(h("p", { class: "field-hint", style: { marginTop: "-6px" } }, "System fonts load instantly. Each web font adds one small download."));
    const tf = (group, key, field, rebuild = false) => root.append(fieldControl({ key, ...field }, theme[group][key], (v) => set(`theme:${group}:${key}`, (site) => { site.theme[group][key] = v ?? field.placeholder; }, { rebuild: rebuild || field.type === "select" || field.type === "checkbox" }), {}));

    root.append(h("div", { class: "group-title", style: { marginTop: "8px" } }, "Text"));
    tf("type", "base", { label: "Body text size", type: "slider", min: 14, max: 22, placeholder: 17 });
    tf("type", "headingScale", { label: "Heading size", type: "slider", min: 60, max: 160, step: 5, unit: "%", placeholder: 100 });
    tf("type", "headingWeight", { label: "Heading weight", type: "select", options: [300, 400, 500, 600, 700, 800, 900], labels: ["Light", "Normal", "Medium", "Semi-bold", "Bold", "Extra bold", "Black"] });

    root.append(h("div", { class: "group-title", style: { marginTop: "8px" } }, "Buttons"));
    tf("buttons", "size", { label: "Size", type: "select", options: ["sm", "md", "lg", "xl"], labels: ["Small", "Medium", "Large", "Extra large"] });
    tf("buttons", "shape", { label: "Shape", type: "select", options: ["theme", "square", "rounded", "pill"], labels: ["Same as corner rounding", "Square", "Slightly rounded", "Pill"] });
    tf("buttons", "weight", { label: "Text weight", type: "select", options: [400, 500, 600, 700, 800], labels: ["Normal", "Medium", "Semi-bold", "Bold", "Extra bold"] });
    tf("buttons", "hover", { label: "Hover animation", type: "select", options: HOVER_EFFECTS, labels: HOVER_LABELS });
    tf("buttons", "uppercase", { label: "CAPITAL LETTERS", type: "checkbox" });
    tf("buttons", "shadow", { label: "Drop shadow", type: "checkbox" });
    root.append(h("p", { class: "field-hint", style: { marginTop: "-6px" } }, "Hover over any button on the page to try the animation. Change a single button group in its own Style tab."));

    root.append(h("div", { class: "group-title", style: { marginTop: "8px" } }, "Layout"));
    root.append(fieldControl({ key: "radius", label: "Corner rounding", type: "slider", min: 0, max: 32, placeholder: 10 }, theme.radius, (v) => set("theme:r", (site) => { site.theme.radius = v ?? 10; }), {}));
    tf("layout", "width", { label: "Content width", type: "slider", min: 720, max: 1600, step: 10, placeholder: 1140 });
    tf("layout", "spacing", { label: "Space between sections", type: "slider", min: 25, max: 200, step: 5, unit: "%", placeholder: 100 });

    root.append(h("div", { class: "group-title", style: { marginTop: "8px" } }, "Animation"));
    tf("layout", "motion", { label: "Sections animate in as you scroll", type: "select", options: ENTRANCE_EFFECTS, labels: ENTRANCE_LABELS });
    root.append(h("p", { class: "field-hint", style: { marginTop: "-6px" } }, "Applies to every section unless a section picks its own (Advanced tab). Use Preview to see it. Pure CSS, so it doesn't slow the site down."));
  }

  // ------------------------------------------------------------- Site -----

  function renderSettings() {
    const s = state.get();
    const meta = s.meta;
    const issues = siteIssues(state);
    const fixes = issues.filter((i) => i.level === "fix").length;
    root.append(h("button", { class: `btn btn-block${fixes ? "" : " btn-ok"}`, style: { marginBottom: "16px" }, onclick: () => showChecklist(state) },
      fixes ? `⚠ Site check: ${fixes} thing${fixes > 1 ? "s" : ""} to fix` : issues.length ? `✓ Site check: ${issues.length} tip${issues.length > 1 ? "s" : ""}` : "✓ Site check: all good"));
    root.append(fieldControl({ key: "name", label: "Site name", type: "text" }, s.site.name, (v) => state.mutate((site) => { site.name = v; }, { key: "site:name", source: "panel" }), {}));
    renderReview(s, meta);

    // Business details: shown to Google (and used by the phone contact button).
    const biz = s.site.business;
    const bf = (key, field) => root.append(fieldControl({ key, ...field }, biz[key], (v, opts) => state.mutate((site) => { site.business[key] = v ?? ""; }, { key: `biz:${key}`, source: opts?.rebuild ? null : "panel" }), {}));
    root.append(h("div", { class: "group-title", style: { marginTop: "8px" } }, "Business details"));
    root.append(h("p", { class: "field-hint", style: { marginTop: 0 } }, "Google reads these to show the business in search results and on Maps. Only fill in what's true."));
    bf("type", { label: "What the business is", type: "text", placeholder: "e.g. Antique shop" });
    bf("phone", { label: "Phone", type: "text" });
    bf("email", { label: "Email", type: "text" });
    bf("address", { label: "Address", type: "textarea" });
    bf("hours", { label: "Opening hours", type: "textarea" });
    bf("socials", { label: "Social media links (one per line)", type: "textarea" });
    bf("whatsapp", { label: "WhatsApp number (with country code, e.g. 44 7700 900123)", type: "text" });
    bf("contactButton", { label: "Contact button on phones", type: "select", options: ["none", "call", "whatsapp", "both"], labels: ["None", "Call", "WhatsApp", "Call and WhatsApp"] });
    if (biz.contactButton !== "none") root.append(h("p", { class: "field-hint", style: { marginTop: "-6px" } }, "A button that stays in the corner of the screen on phones. Uses the phone number above (and the WhatsApp number, or the phone number if that's empty)."));
    root.append(fieldControl({ key: "favicon", label: "Browser tab icon (optional; the logo is used if empty)", type: "image" }, s.site.favicon, (v) => state.mutate((site) => { site.favicon = v || ""; }, { key: "site:favicon" }), { pickImage }));

    const slug = h("input", { class: "input", value: meta.slug });
    const domains = h("textarea", { class: "textarea", rows: "2", placeholder: "www.customer.com" }, (meta.domains || []).join("\n"));
    const saveMeta = h("button", { class: "btn btn-sm", onclick: async () => {
      try {
        const { meta: m } = await api(`/sites/${s.siteId}/meta`, { method: "PATCH", body: { name: s.site.name, slug: slug.value, domains: domains.value.split(/[\s,]+/).filter(Boolean) } });
        onMetaChange(m);
        toast("Address settings saved.");
        render();
      } catch (e) { toast(e.message, { error: true }); }
    } }, "Save address settings");

    root.append(h("div", { class: "group-title", style: { marginTop: "8px" } }, "Address"));
    root.append(h("div", { class: "field" }, h("label", {}, s.baseDomain ? `Subdomain (.${s.baseDomain})` : "Site address name"), slug,
      h("div", { class: "field-hint" }, "Live at: ", h("a", { href: meta.liveUrl, target: "_blank", rel: "noopener" }, meta.liveUrl))));
    root.append(h("div", { class: "field" }, h("label", {}, "Domain name"), domains,
      h("div", { class: "field-hint" }, "The web address this site lives at, e.g. www.smithantiques.co.uk. Used for the \"View live\" link and search engines.")));
    root.append(saveMeta);

    root.append(h("hr", { class: "sep" }));
    root.append(h("div", { class: "group-title" }, "Publishing"));
    root.append(h("p", { class: "small", style: { marginTop: 0 } }, meta.publishedAt ? `Live · last published ${timeAgo(meta.publishedAt)}` : "Not published yet. Click Publish at the top when you're ready."));
    if (meta.publishedAt) root.append(h("button", { class: "btn btn-sm btn-danger", onclick: async () => {
      const msg = meta.deploy?.enabled
        ? "Unpublish the builder's copy of this site? This does NOT remove it from the customer's own hosting; to take that down, delete the files there."
        : "Take this site offline? Visitors will see a 'coming soon' page until you publish again.";
      if (!(await confirmDialog(msg, { okText: "Unpublish", danger: true }))) return;
      const { meta: m } = await api(`/sites/${s.siteId}/unpublish`, { method: "POST", body: {} });
      onMetaChange(m);
      render();
    } }, "Unpublish"));

    renderHosting(s, meta);

    root.append(h("hr", { class: "sep" }));
    root.append(h("div", { class: "group-title" }, "Contact forms"));
    const formEmail = h("input", { class: "input", type: "email", value: meta.formEmail || "", placeholder: "owner@theirbusiness.co.uk" });
    root.append(h("div", { class: "field" }, h("label", {}, "Email form messages to"), formEmail,
      h("div", { class: "field-hint" }, "On the customer's own hosting, every contact form message is emailed here. Re-publish after changing it.")));
    root.append(h("div", { class: "row", style: { flexWrap: "wrap" } },
      h("button", { class: "btn btn-sm", onclick: async () => {
        try {
          const { meta: m } = await api(`/sites/${s.siteId}/meta`, { method: "PATCH", body: { formEmail: formEmail.value } });
          onMetaChange(m);
          toast("Saved. Publish again to update the live site.");
        } catch (e) { toast(e.message, { error: true }); }
      } }, "Save email"),
      h("button", { class: "btn btn-sm", onclick: () => showSubmissions(s.siteId) }, "Messages received here"),
    ));

    root.append(h("hr", { class: "sep" }));
    root.append(h("div", { class: "group-title" }, "Custom CSS"));
    root.append(fieldControl({ key: "customCss", label: "", type: "code" }, s.site.customCss, (v) => state.mutate((site) => { site.customCss = v; }, { key: "site:css", source: "panel" }), {}));
    root.append(h("p", { class: "field-hint", style: { marginTop: "-8px" } }, "Applies to every page. Blocks use classes like .eka-btn, .eka-card, .eka-h."));
  }

  // "Your hosting": FTP details for publishing to the customer's own web host.
  function renderHosting(s, meta) {
    if (s.demo) {
      root.append(h("hr", { class: "sep" }), h("div", { class: "group-title" }, "Your hosting (FTP)"),
        h("p", { class: "field-hint" }, "In the full version, Publish uploads the site straight to your hosting over FTP, and you can download it as files. Switched off in the demo."));
      return;
    }
    const d = meta.deploy || {};
    root.append(h("hr", { class: "sep" }));
    root.append(h("div", { class: "group-title" }, "Your hosting (FTP)"));
    root.append(h("p", { class: "field-hint", style: { marginTop: 0 } }, "Put this site on any normal web host. Your host gives you these details, often called FTP account or FTP login."));

    const enabled = h("input", { type: "checkbox", checked: !!d.enabled });
    const host = h("input", { class: "input", value: d.host || "", placeholder: "ftp.theirdomain.co.uk" });
    const user = h("input", { class: "input", value: d.user || "", autocomplete: "off" });
    const password = h("input", { class: "input", type: "password", autocomplete: "new-password", placeholder: d.hasPassword ? "Saved (leave empty to keep it)" : "" });
    const dir = h("input", { class: "input", value: d.remoteDir ?? "public_html", placeholder: "public_html" });
    const port = h("input", { class: "input", type: "number", value: d.port || 21 });
    const secure = h("input", { type: "checkbox", checked: d.secure !== "none" });
    const status = h("div", { class: "small", style: { margin: "8px 0", minHeight: "1.2em" } });

    const values = () => ({ enabled: enabled.checked, host: host.value, user: user.value, password: password.value, remoteDir: dir.value, port: port.value, secure: secure.checked ? "explicit" : "none" });
    const field = (label, input, hint) => h("div", { class: "field" }, h("label", {}, label), input, hint ? h("div", { class: "field-hint" }, hint) : null);

    root.append(
      h("div", { class: "field" }, h("label", { class: "check" }, enabled, "Upload to this hosting every time I click Publish")),
      field("FTP server", host),
      field("Username", user),
      field("Password", password),
      field("Folder", dir, "Where the website files go. Usually public_html (sometimes htdocs or www)."),
      h("details", {}, h("summary", { class: "small", style: { cursor: "pointer", marginBottom: "10px" } }, "Advanced"),
        field("Port", port, "21 unless your host says otherwise."),
        h("div", { class: "field" }, h("label", { class: "check" }, secure, "Use encrypted connection (recommended)")),
      ),
      status,
    );

    if (meta.deployError) { status.style.color = "var(--danger)"; status.textContent = `Last upload failed: ${meta.deployError}`; }
    else if (meta.deployedAt) status.textContent = `Last uploaded ${timeAgo(meta.deployedAt)}.`;

    const save = async () => {
      const { meta: m } = await api(`/sites/${s.siteId}/meta`, { method: "PATCH", body: { deploy: values() } });
      onMetaChange(m);
      return m;
    };

    root.append(h("div", { class: "row", style: { flexWrap: "wrap" } },
      h("button", { class: "btn btn-sm", onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true; status.style.color = ""; status.textContent = "Connecting…";
        try {
          const r = await api(`/sites/${s.siteId}/deploy/test`, { method: "POST", body: values() });
          status.style.color = "var(--ok)";
          status.textContent = `Connected. The folder contains: ${r.entries.join(", ") || "(empty)"}`;
        } catch (err) { status.style.color = "var(--danger)"; status.textContent = err.message; }
        btn.disabled = false;
      } }, "Test connection"),
      h("button", { class: "btn btn-sm btn-primary", onclick: async () => {
        try { await save(); toast("Hosting details saved."); render(); } catch (err) { toast(err.message, { error: true }); }
      } }, "Save"),
      meta.publishedAt && d.host ? h("button", { class: "btn btn-sm", onclick: async () => {
        try {
          const { jobId } = await api(`/sites/${s.siteId}/deploy`, { method: "POST", body: {} });
          const m = await followDeploy(s.siteId, jobId);
          if (m) onMetaChange(m);
        } catch (err) { toast(err.message, { error: true }); }
      } }, "Upload now") : null,
    ));

    root.append(h("p", { class: "field-hint", style: { marginTop: "14px" } }, "Prefer to upload by hand? ",
      meta.publishedAt
        ? h("a", { href: `/api/sites/${s.siteId}/export.zip`, download: "" }, "Download the published site as files")
        : "Publish first, then you can download the site as files.",
      " (a ZIP to upload to any host)."));

    root.append(h("div", { class: "group-title", style: { marginTop: "18px" } }, "Online shop (CubeCart)"));
    root.append(h("p", { class: "field-hint" },
      "For a shop: install CubeCart on the hosting, then use this design as its skin. ",
      "It takes the colours, fonts, rounding and logo, plus a homepage banner from your first page. ",
      "Upload the ZIP into CubeCart's skins folder, extract it, and pick it in the CubeCart admin (instructions are inside)."));
    root.append(h("a", { class: "btn btn-sm", href: `/api/sites/${s.siteId}/cubecart-skin.zip`, download: "" }, "Download as CubeCart skin"));
  }

  // Customer review: a link to the draft where the customer comments and approves.
  function renderReview(s, meta) {
    root.append(h("div", { class: "group-title", style: { marginTop: "8px" } }, "Customer review"));
    if (s.demo) {
      root.append(h("p", { class: "field-hint", style: { marginTop: 0 } }, "In the full version you can send the customer a link to comment on the draft and approve it. Switched off in the demo."));
      return;
    }
    if (!meta.review) {
      root.append(h("p", { class: "field-hint", style: { marginTop: 0 } }, "Send the customer a link to the draft. They can click anything to comment on it, and press Approve when they're happy. No login needed."));
      root.append(h("button", { class: "btn btn-sm", onclick: async () => {
        try { const { meta: m } = await api(`/sites/${s.siteId}/review`, { method: "POST", body: {} }); onMetaChange(m); render(); } catch (e) { toast(e.message, { error: true }); }
      } }, "Create a review link"));
      return;
    }
    const link = new URL(`/review/${meta.review.token}`, location.href).href;
    const input = h("input", { class: "input", value: link, readonly: true, onfocus: (e) => e.target.select() });
    root.append(h("div", { class: "row" }, input, h("button", { class: "btn btn-sm", onclick: async () => {
      try { await navigator.clipboard.writeText(link); toast("Link copied. Send it to the customer."); } catch { input.select(); }
    } }, "Copy")));
    root.append(h("p", { class: "field-hint" }, "They see your latest saved draft, not the live site. ",
      h("a", { href: "#", onclick: async (e) => {
        e.preventDefault();
        if (!(await confirmDialog("Turn off this link? The customer won't be able to open it any more. Their comments are kept.", { okText: "Turn off" }))) return;
        const { meta: m } = await api(`/sites/${s.siteId}/review`, { method: "POST", body: { off: true } });
        onMetaChange(m); render();
      } }, "Turn off the link")));
    if (meta.approval) root.append(h("div", { class: "notice ok" }, `✓ Approved by ${meta.approval.name} on ${new Date(meta.approval.at).toLocaleDateString()}`));
    const box = h("div", { class: "review-comments" }, h("p", { class: "small muted" }, "Loading comments…"));
    root.append(box);
    loadComments(s, box);
  }

  async function loadComments(s, box, showResolved = false) {
    let comments;
    try { ({ comments } = await api(`/sites/${s.siteId}/comments`)); } catch { box.replaceChildren(); return; }
    const open = comments.filter((c) => !c.resolved);
    const shown = showResolved ? comments : open;
    const pageTitle = (slug) => s.site.pages.find((p) => p.slug === slug)?.title || slug;
    box.replaceChildren(
      h("div", { class: "small", style: { fontWeight: 600, margin: "10px 0 6px" } }, open.length ? `${open.length} comment${open.length > 1 ? "s" : ""} to look at` : "No open comments"),
      ...shown.slice().reverse().map((c) => h("div", { class: `review-comment${c.resolved ? " done" : ""}` },
        h("div", { class: "small muted" }, `${c.name} · ${pageTitle(c.page)} · ${timeAgo(c.at)}`),
        h("p", {}, c.text),
        h("div", { class: "row" },
          c.nodeId ? h("button", { class: "btn btn-sm", onclick: () => {
            const page = s.site.pages.find((p) => p.slug === c.page);
            if (page && page.id !== state.get().pageId) state.setPage(page.id);
            setTimeout(() => (findNode(state.get().site, c.nodeId) ? state.select(c.nodeId) : toast("That part of the page has since been removed.")), 50);
          } }, "Show") : null,
          h("button", { class: "btn btn-sm", onclick: async () => {
            await api(`/sites/${s.siteId}/comments/${c.id}`, { method: "PATCH", body: { resolved: !c.resolved } });
            loadComments(s, box, showResolved);
          } }, c.resolved ? "Reopen" : "✓ Done")))),
      comments.length > open.length ? h("a", { href: "#", class: "small", onclick: (e) => { e.preventDefault(); loadComments(s, box, !showResolved); } }, showResolved ? "Hide finished comments" : `Show finished comments (${comments.length - open.length})`) : null,
    );
  }

  async function showSubmissions(siteId) {
    const { submissions } = await api(`/sites/${siteId}/submissions`);
    modal({
      title: `Form messages (${submissions.length})`,
      wide: true,
      body: submissions.length
        ? h("div", {}, submissions.map((sub) => h("div", { class: "version", style: { display: "block" } },
          h("div", { class: "small muted" }, `${new Date(sub.at).toLocaleString()} · page: ${sub.page}`),
          Object.entries(sub.fields).map(([k, v]) => h("div", {}, h("strong", {}, `${k}: `), h("span", { style: { whiteSpace: "pre-wrap" } }, v))))))
        : h("p", { class: "muted" }, "No messages yet. They'll appear here when visitors use a contact form on the live site."),
    });
  }

  tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.tab)));

  return { render, show, askAi, active: () => active };
}
