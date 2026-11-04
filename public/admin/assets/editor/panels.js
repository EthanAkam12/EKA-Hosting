// Left-hand tabs: Add, AI, Pages, Style, Site.

import { BLOCKS, FONT_CHOICES, HOVER_EFFECTS, HOVER_LABELS, ENTRANCE_EFFECTS, ENTRANCE_LABELS, createPage, createSection, createBlock, createPost, listPosts, findNode } from "/admin/shared/schema.js";
import { h, api, waitForJob, toast, modal, confirmDialog, timeAgo } from "../ui.js";
import { fieldControl } from "./fields.js";
import { SECTION_TEMPLATES, EMPTY_LAYOUTS } from "./templates.js";
import { followDeploy } from "./deploy-ui.js";
import { showChecklist, siteIssues } from "./checklist.js";
import { contrast } from "/admin/shared/checks.js";
import { LANGUAGES } from "/admin/shared/i18n.js";
import { SECTION_LIBRARY, LIBRARY_CATEGORIES } from "/admin/shared/library.js";
import { renderPage } from "/admin/shared/render.js";
import { reworkSections } from "./section-ai.js";
import { savedEntries, sharedEntries, importSavedMedia, deleteSaved } from "./my-sections.js";
import { adviceCard } from "./advisor.js";
import { STYLE_KITS, applyStyleKit, paletteFromPixels } from "/admin/shared/style-kits.js";
import { ensurePrivacyPage } from "/admin/shared/legal.js";

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
    root.append(h("button", { class: "btn btn-primary btn-block", style: { marginBottom: "12px" }, onclick: openLibrary }, `📚 Section library · ${SECTION_LIBRARY.length} designs`));
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

  // ---------------------------------------------------- Section library -----

  // Ready-made sections shown in this site's own colours and fonts. Click one
  // to add it after the selected section; with AI, it's then filled in for the business.
  let libraryCat = "hero";
  function openLibrary() {
    const s = state.get();
    const fill = h("input", { type: "checkbox", checked: s.aiEnabled });
    const nav = h("nav", { class: "lib-nav" });
    const grid = h("div", { class: "lib-grid" });
    // Your own designs first: saved ones (any of your sites) and shared ones on this site.
    let mine = null;
    const shared = sharedEntries(s.site);
    const cats = [["mine", "★ My sections"], ...(shared.length ? [["shared", "⇄ Shared on this site"]] : []), ...LIBRARY_CATEGORIES];
    const entriesFor = (cat) => (cat === "mine" ? mine || [] : cat === "shared" ? shared : SECTION_LIBRARY.filter((e) => e.cat === cat));
    const preview = (entry) => {
      const site = structuredClone(s.site);
      const page = { ...site.pages[0], sections: [].concat(entry.make()) };
      site.pages = [page];
      const html = renderPage(site, page, { editor: true }).replace("</head>", "<style>.eka-header,.eka-footer,.eka-fabs,.eka-ph-tag{display:none!important}body{overflow:hidden;pointer-events:none}.eka-empty{display:none}</style></head>");
      return h("iframe", { srcdoc: html, loading: "lazy", tabindex: "-1", title: "", sandbox: "" });
    };
    const paint = () => {
      nav.replaceChildren(...cats.map(([id, label]) => h("button", { class: `lib-cat${id === libraryCat ? " on" : ""}`, onclick: () => { libraryCat = id; paint(); } }, label, h("small", {}, id === "mine" && !mine ? "…" : String(entriesFor(id).length)))));
      const entries = entriesFor(libraryCat);
      const empty = libraryCat === "mine" ? (mine ? "Nothing saved yet. Select a section on any page and click ★ Save (right-hand panel) to keep it here for all your websites." : "Loading…") : "";
      grid.replaceChildren(...(entries.length ? entries.map((entry) => h("div", { class: "lib-card-wrap" },
        h("button", { class: "lib-card", title: `Add "${entry.name}"`, onclick: () => add(entry) }, h("div", { class: "lib-thumb" }, preview(entry)), h("span", {}, entry.name)),
        entry.saved ? h("button", { class: "icon-btn lib-del", title: "Delete from My sections", onclick: async () => { await deleteSaved(entry.saved); mine = mine.filter((x) => x !== entry); paint(); } }, "✕") : null)) : [h("p", { class: "muted small" }, empty)]));
      grid.scrollTop = 0;
      fit();
    };
    // Previews are drawn 1200px wide and scaled down to the card.
    const fit = () => grid.querySelectorAll(".lib-thumb").forEach((t) => t.style.setProperty("--s", t.clientWidth / 1200));
    const ro = new ResizeObserver(fit);
    const add = async (entry) => {
      m.close();
      const own = !!(entry.saved || libraryCat === "shared");
      let make = entry.make;
      if (entry.saved) {
        const sections = await importSavedMedia(state, entry.make());
        make = () => sections;
      }
      canvas.insertByClick({ kind: "new-section", make, onAdded: fill.checked && !own ? (ids) => reworkSections(state, ids, "fill") : null });
    };
    const m = modal({
      title: "Section library",
      wide: true,
      body: h("div", {},
        h("div", { class: "row", style: { justifyContent: "space-between", flexWrap: "wrap", marginBottom: "10px", gap: "8px" } },
          h("span", { class: "small muted" }, "Shown in this site's colours and fonts. It goes after the selected section; change anything afterwards."),
          s.aiEnabled ? h("label", { class: "check small" }, fill, "✦ Fill it in for this business with AI (text and photos)") : null),
        h("div", { class: "lib" }, nav, grid)),
    });
    m.el.querySelector(".modal").classList.add("modal-lib");
    ro.observe(grid);
    paint();
    savedEntries(state).then((list) => { mine = list; paint(); }).catch(() => { mine = []; paint(); });
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
      root.append(adviceCard({ state, rerender: render, runInstruction: () => {} }));
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

    root.append(adviceCard({ state, rerender: () => { if (active === "ai") render(); }, runInstruction: (text) => { aiScope = null; input.value = text; send(); } }));
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
    const pages = s.site.pages.map((p, i) => [p, i]).filter(([p]) => !p.post);
    pages.forEach(([p, i], n) => {
      root.append(h("div", { class: `page-row${p.id === s.pageId ? " active" : ""}`, onclick: () => state.setPage(p.id) },
        h("span", { class: "name" }, p.title),
        h("span", { class: "slug", title: p.hidden ? "Not in the menu" : "" }, `${p.slug === "index" ? "/" : `/${p.slug}`}${p.hidden ? " · hidden" : ""}`),
        n > 1 ? h("button", { class: "icon-btn", title: "Move up", onclick: (e) => { e.stopPropagation(); movePage(i, pages[n - 1][1]); } }, "↑") : null,
        n > 0 && n < pages.length - 1 ? h("button", { class: "icon-btn", title: "Move down", onclick: (e) => { e.stopPropagation(); movePage(i, pages[n + 1][1]); } }, "↓") : null,
        i > 0 ? h("button", { class: "icon-btn", title: "Duplicate page", onclick: (e) => { e.stopPropagation(); duplicatePage(p.id); } }, "⧉") : null,
        i > 0 ? h("button", { class: "icon-btn", title: "Delete page", onclick: (e) => { e.stopPropagation(); deletePage(p); } }, "🗑") : null,
      ));
    });
    root.append(h("button", { class: "btn btn-block", style: { marginTop: "12px" }, onclick: addPage }, "+ Add page"));
    root.append(h("p", { class: "field-hint" }, "Rename a page or set its Google description in the right-hand panel when nothing is selected. The home page always stays first."));

    // Blog posts: pages with a date, listed by "Blog posts" blocks.
    root.append(h("hr", { class: "sep" }), h("div", { class: "group-title" }, "Blog posts"));
    const posts = listPosts(s.site, { drafts: true });
    if (!posts.length) root.append(h("p", { class: "field-hint", style: { marginTop: 0 } }, "No posts yet. Posts are listed wherever you add a \"Blog posts\" block (Add tab → Shop & blog), usually on a Blog or News page."));
    for (const p of posts) {
      root.append(h("div", { class: `page-row${p.id === s.pageId ? " active" : ""}`, onclick: () => state.setPage(p.id) },
        h("span", { class: "name" }, p.title, p.post.draft ? h("small", { class: "muted" }, " · draft") : null),
        h("span", { class: "slug" }, p.post.date),
        h("button", { class: "icon-btn", title: "Delete post", onclick: (e) => { e.stopPropagation(); deletePage(p); } }, "🗑")));
    }
    root.append(h("div", { class: "row", style: { marginTop: "12px", flexWrap: "wrap" } },
      h("button", { class: "btn", onclick: () => newPost() }, "+ New post"),
      s.aiEnabled ? h("button", { class: "btn", onclick: writePostWithAi }, "✦ Write a post with AI") : null));
    if (posts.length && !s.site.pages.some((p) => !p.post && p.sections.some((sec) => sec.columns.some((c) => c.blocks.some((b) => b.type === "posts"))))) {
      root.append(h("div", { class: "notice", style: { marginTop: "10px" } }, "No page lists your posts yet. ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); addBlogPage(); } }, "Add a Blog page"), " so visitors can find them."));
    }
  }

  function newPost(page = createPost("New post")) {
    state.mutate((site) => { site.pages.push(page); }, { label: "New blog post" });
    const added = state.get().site.pages.find((p) => p.id === page.id);
    if (added) state.setPage(added.id);
    render();
    return added;
  }

  function addBlogPage() {
    const page = createPage("Blog");
    page.sections = [
      createSection({ background: "surface", width: "narrow", align: "center" }, [[createBlock("heading", { text: "Blog", level: 1, align: "center" }), createBlock("text", { html: "<p>News, tips and stories.</p>", align: "center" })]]),
      createSection({}, [[createBlock("posts", { count: 12 })]]),
    ];
    state.mutate((site) => {
      const contact = site.pages.findIndex((p) => p.slug === "contact" && !p.post);
      site.pages.splice(contact > 0 ? contact : site.pages.filter((p) => !p.post).length, 0, page);
    }, { label: "Added Blog page" });
    const added = state.get().site.pages.find((p) => p.id === page.id);
    if (added) state.setPage(added.id);
    render();
  }

  function writePostWithAi() {
    const topic = h("textarea", { class: "textarea", rows: "3", placeholder: "e.g. 5 tips for looking after antique furniture" });
    const m = modal({
      title: "Write a blog post with AI",
      body: h("div", {}, h("div", { class: "field" }, h("label", {}, "What's the post about?"), topic,
        h("div", { class: "field-hint" }, "The AI writes it in the site's style and tone, with a cover photo. It's saved as a draft for you to check before it goes live."))),
      footer: [h("button", { class: "btn", onclick: () => m.close() }, "Cancel"), h("button", { class: "btn btn-primary", onclick: go }, "Write it")],
    });
    async function go(e) {
      if (!topic.value.trim()) return topic.focus();
      e.target.disabled = true;
      e.target.textContent = "Writing…";
      try {
        const s = state.get();
        const { jobId } = await api(`/sites/${s.siteId}/ai/post`, { method: "POST", body: { topic: topic.value.trim(), site: s.site } });
        const result = await waitForJob(jobId, () => {});
        m.close();
        newPost(result.page);
        toast("Draft written. Read it through, then untick Draft in the right-hand panel to publish it.");
      } catch (err) {
        toast(err.message, { error: true });
        e.target.disabled = false;
        e.target.textContent = "Write it";
      }
    }
  }

  // Swaps two pages (by index in site.pages; posts in between are skipped).
  function movePage(i, j) {
    state.mutate((site) => {
      if (i < 1 || j < 1 || j >= site.pages.length) return;
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

    // Whole-site looks, previewed on this site's own home page.
    root.append(h("div", { class: "group-title" }, "Style kits"));
    const keep = h("input", { type: "checkbox" });
    const kitGrid = h("div", { class: "kit-grid" }, STYLE_KITS.map((k) => {
      const site = applyStyleKit(structuredClone(state.get().site), k.id);
      const page = { ...site.pages[0], sections: site.pages[0].sections.slice(0, 2) };
      const html = renderPage(site, page, { editor: true }).replace("</head>", "<style>body{overflow:hidden;pointer-events:none}.eka-ph-tag,.eka-fabs{display:none!important}</style></head>");
      return h("button", { class: "kit", title: `Use the ${k.name} look`, onclick: () => {
        state.mutate((s2) => { applyStyleKit(s2, k.id, { keepColours: keep.checked }); }, { label: `Style kit: ${k.name}` });
        toast(`${k.name} look applied. Undo (Ctrl+Z) to go back.`);
        render();
      } }, h("div", { class: "kit-thumb" }, h("iframe", { srcdoc: html, loading: "lazy", tabindex: "-1", title: "", sandbox: "" })), h("span", {}, k.name));
    }));
    root.append(kitGrid, h("label", { class: "check small", style: { margin: "6px 0 4px" } }, keep, "Keep my colours (change fonts, buttons and spacing only)"));

    // Colours from the logo, worked out in the browser (no AI needed).
    const logo = state.get().site.header.logoImage;
    if (logo) root.append(h("button", { class: "btn btn-sm btn-block", style: { margin: "8px 0" }, onclick: async () => {
      try {
        const pal = await logoPalette(logo);
        if (!pal) return toast("The logo is black, white or grey, so there are no colours to take from it.", { error: true });
        state.mutate((site) => { Object.assign(site.theme.colors, pal); }, { label: "Colours from the logo" });
        toast("Colours taken from the logo. Undo (Ctrl+Z) to go back.");
        render();
      } catch { toast("Couldn't read the logo's colours.", { error: true }); }
    } }, "🎨 Colours from my logo"));

    brandKits();

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

  // Reads a logo's pixels (same-site image) and makes a palette from them.
  function logoPalette(url) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement("canvas");
        const w = (c.width = Math.min(120, im.naturalWidth || 120)), hh = (c.height = Math.max(1, Math.round(w * ((im.naturalHeight || 1) / (im.naturalWidth || 1)))));
        const g = c.getContext("2d");
        g.drawImage(im, 0, 0, w, hh);
        try { resolve(paletteFromPixels(g.getImageData(0, 0, w, hh).data)); } catch (e) { reject(e); }
      };
      im.onerror = reject;
      im.src = url;
    });
  }

  // Brand kits: this site's look (colours, fonts, buttons, logo) saved to use on other websites.
  function brandKits() {
    const box = h("div", {});
    root.append(h("div", { class: "group-title" }, "Brand kits"), box);
    const paint = (kits) => box.replaceChildren(
      ...kits.map((k) => h("div", { class: "page-row" },
        h("span", { class: "row", style: { gap: "3px" } }, ["primary", "accent", "dark"].map((c) => h("span", { style: { width: "10px", height: "16px", borderRadius: "3px", background: k.theme.colors[c] } }))),
        h("span", { class: "name" }, k.name),
        h("button", { class: "btn btn-sm", onclick: async () => {
          let kit = k;
          if (k.logoImage && !k.logoImage.startsWith(`/_m/${state.get().siteId}/`)) {
            try { const { map } = await api(`/sites/${state.get().siteId}/media/import`, { method: "POST", body: { urls: [k.logoImage] } }); kit = { ...k, logoImage: map[k.logoImage] || "" }; } catch { kit = { ...k, logoImage: "" }; }
          }
          state.mutate((site) => {
            site.theme = { ...structuredClone(kit.theme), layout: { ...site.theme.layout, ...kit.theme.layout } };
            if (kit.logoImage) site.header.logoImage = kit.logoImage;
          }, { label: `Brand kit: ${k.name}` });
          toast(`"${k.name}" applied.`);
          render();
        } }, "Apply"),
        h("button", { class: "icon-btn", title: "Delete this brand kit", onclick: async () => { await api(`/brand-kits/${k.id}`, { method: "DELETE" }); load(); } }, "🗑"))),
      h("button", { class: "btn btn-sm btn-block", style: { marginTop: "6px" }, onclick: async () => {
        const s2 = state.get().site;
        try {
          await api("/brand-kits", { method: "POST", body: { name: s2.name, theme: s2.theme, logoImage: s2.header.logoImage } });
          toast("Saved. Apply it to any of your websites here, or choose it when making a new one.");
          load();
        } catch (e) { toast(e.message, { error: true }); }
      } }, "★ Save this site's look as a brand kit"));
    const load = () => api("/brand-kits").then(({ kits }) => paint(kits)).catch(() => paint([]));
    load();
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

    renderPrivacy(s);
    renderPopup(s);

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
    root.append(h("div", { class: "row", style: { flexWrap: "wrap" } }, saveMeta,
      (meta.domains || []).length && !meta.deploy?.enabled ? h("button", { class: "btn btn-sm", onclick: () => domainHelper(s.siteId) }, "Connect & check the domain") : null));

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
    root.append(h("div", { class: "group-title" }, "Forms: messages, enquiries and bookings"));
    const formEmail = h("input", { class: "input", type: "email", value: meta.formEmail || "", placeholder: "owner@theirbusiness.co.uk" });
    root.append(h("div", { class: "field" }, h("label", {}, "Email them to"), formEmail,
      h("div", { class: "field-hint" }, s.mail
        ? "Every message, enquiry and booking request is emailed here and kept in the list below. Re-publish after changing it if the site is on the customer's own hosting."
        : "On the customer's own hosting, every message is emailed here. Sites hosted by this builder keep them in the list below; to email them too, the server needs email settings (SMTP_HOST in settings.txt).")));
    root.append(h("div", { class: "row", style: { flexWrap: "wrap" } },
      h("button", { class: "btn btn-sm", onclick: async () => {
        try {
          const { meta: m } = await api(`/sites/${s.siteId}/meta`, { method: "PATCH", body: { formEmail: formEmail.value } });
          onMetaChange(m);
          toast("Saved. Publish again to update the live site.");
        } catch (e) { toast(e.message, { error: true }); }
      } }, "Save email"),
      h("button", { class: "btn btn-sm", onclick: () => showSubmissions(s.siteId) }, "Messages, enquiries & bookings"),
    ));

    root.append(h("hr", { class: "sep" }));
    root.append(h("div", { class: "group-title" }, "Custom CSS"));
    root.append(fieldControl({ key: "customCss", label: "", type: "code" }, s.site.customCss, (v) => state.mutate((site) => { site.customCss = v; }, { key: "site:css", source: "panel" }), {}));
    root.append(h("p", { class: "field-hint", style: { marginTop: "-8px" } }, "Applies to every page. Blocks use classes like .eka-btn, .eka-card, .eka-h."));
  }

  // Step-by-step DNS settings for each custom domain, with a live check.
  async function domainHelper(siteId) {
    const body = h("div", {}, h("p", { class: "muted" }, "Checking…"));
    const m = modal({ title: "Connect your domain", wide: true, body });
    const badge = (state) => ({ ok: h("span", { class: "badge badge-live" }, "✓ Working"), elsewhere: h("span", { class: "badge badge-err" }, "Points somewhere else"), missing: h("span", { class: "badge" }, "Not set yet"), unknown: h("span", { class: "badge" }, "Set (can't confirm)") })[state];
    const code = (t) => h("code", { class: "dns-val", title: "Click to copy", onclick: () => navigator.clipboard?.writeText(t).then(() => toast("Copied.")) }, t);
    async function check() {
      body.replaceChildren(h("p", { class: "muted" }, "Checking…"));
      try {
        const r = await api(`/sites/${siteId}/domain-check`);
        const ip = r.ips[0] || "your server's IP address (ask your host)";
        body.replaceChildren(
          !r.baseDomain ? h("div", { class: "notice", style: { marginBottom: "12px" } }, "This builder doesn't have a main domain set (BASE_DOMAIN in settings.txt), so it isn't running as a public web host. Use \"Your hosting (FTP)\" to publish to the customer's own hosting instead.") : "",
          h("p", { style: { marginTop: 0 } }, "Log in where the domain was bought (e.g. GoDaddy, 123-reg, IONOS, Namecheap, Cloudflare), open its ", h("strong", {}, "DNS settings"), ", and add these two records. Changes usually work within an hour, sometimes up to a day."),
          ...r.domains.map((d) => h("div", { class: "dns-domain" },
            h("h3", {}, d.domain),
            h("table", { class: "usage-table dns-table" },
              h("tr", {}, h("th", {}, "Type"), h("th", {}, "Name / host"), h("th", {}, "Value / points to"), h("th", {}, "Now")),
              h("tr", {}, h("td", {}, "A"), h("td", {}, code("@")), h("td", {}, code(ip)), h("td", {}, badge(d.apex.state), d.apex.state === "elsewhere" ? h("div", { class: "small muted" }, `now: ${d.apex.a.join(", ")}`) : null)),
              h("tr", {}, h("td", {}, r.target ? "CNAME" : "A"), h("td", {}, code("www")), h("td", {}, code(r.target || ip)), h("td", {}, badge(d.www.state), d.www.state === "elsewhere" ? h("div", { class: "small muted" }, `now: ${d.www.cname || d.www.a.join(", ")}`) : null))),
            h("p", { class: "small" }, "Secure address (https): ", d.https === "ok" ? h("strong", { style: { color: "#15803d" } }, "✓ working: the site is live at this address") : d.https === "waiting" ? "waiting for the records above" : d.https === "other" ? "the domain answers, but with a different website (an old host?). Check the records above and remove any others for @ and www." : "not yet: the certificate is made automatically within a few minutes of the records working."))),
          h("details", { class: "small" }, h("summary", {}, "Tips if it isn't working"),
            h("ul", {},
              h("li", {}, "Delete any other A, AAAA or CNAME records for @ and www (often left from parking pages or old hosting)."),
              h("li", {}, "Cloudflare: set both records to \"DNS only\" (grey cloud), not \"Proxied\"."),
              h("li", {}, "Some providers want the domain written out instead of @, e.g. ", d0(r)),
              h("li", {}, "If you can't add a CNAME for www, use an A record with the IP address instead."))),
          h("div", { class: "row", style: { marginTop: "12px" } }, h("button", { class: "btn", onclick: check }, "Check again")));
      } catch (e) { body.replaceChildren(h("p", { class: "notice notice-err" }, e.message)); }
    }
    const d0 = (r) => r.domains[0]?.domain || "yourdomain.co.uk";
    check();
    return m;
  }

  // The pop-up: an offer or newsletter signup.
  function renderPopup(s) {
    const pop = s.site.popup;
    const pf = (key, field) => root.append(fieldControl({ key, ...field }, pop[key], (v, opts) => state.mutate((site) => { site.popup[key] = v ?? (field.type === "slider" ? field.placeholder : ""); }, { key: `popup:${key}`, source: opts?.rebuild ? null : "panel" }), { pickImage }));
    root.append(h("hr", { class: "sep" }), h("div", { class: "group-title" }, "Pop-up"));
    pf("show", { label: "Show a pop-up (an offer or newsletter signup)", type: "checkbox" });
    if (!pop.show) return;
    pf("title", { label: "Heading", type: "text", placeholder: "10% off your first order" });
    pf("text", { label: "Text", type: "textarea" });
    pf("image", { label: "Picture (optional)", type: "image" });
    const hasNews = s.site.pages.some((p) => p.sections.some((sec) => sec.columns.some((c) => c.blocks.some((b) => b.type === "newsletter"))));
    pf("newsletter", { label: hasNews ? "Include the newsletter signup" : "Include a newsletter signup (add a Newsletter block somewhere first)", type: "checkbox" });
    pf("buttonText", { label: "Button text", type: "text" });
    if (!pop.newsletter) pf("href", { label: "Button link", type: "url" });
    pf("trigger", { label: "When it appears", type: "select", options: ["delay", "exit", "scroll"], labels: ["After a few seconds", "When they're about to leave (mouse heads for the tabs)", "Halfway down the page"] });
    if (pop.trigger === "delay") pf("delay", { label: "Seconds to wait", type: "slider", min: 0, max: 60, placeholder: 8, unit: "s" });
    pf("days", { label: "Show it again to the same visitor after (days)", type: "slider", min: 0, max: 90, placeholder: 7, unit: "" });
    pf("homeOnly", { label: "Only on the home page", type: "checkbox" });
    root.append(h("button", { class: "btn btn-sm", onclick: () => {
      const site = structuredClone(state.get().site);
      const html = renderPage(site, site.pages[0], {}).replace(/<script>\(function\(\)\{var d=document\.getElementById\("eka-pop"\)[\s\S]*?<\/script>/, "<script>document.getElementById('eka-pop').showModal()</script>");
      modal({ title: "Pop-up preview", wide: true, body: h("iframe", { srcdoc: html, style: { width: "100%", height: "520px", border: "1px solid var(--line)", borderRadius: "8px" }, sandbox: "allow-scripts" }) });
    } }, "Preview the pop-up"));
    root.append(h("p", { class: "field-hint" }, "Pop-ups work best used sparingly: one clear offer, shown once. Visitors close it with ×, by clicking outside it, or with Esc."));
  }

  // Language, privacy policy, tracking code and the cookie notice.
  function renderPrivacy(s) {
    const legal = s.site.legal;
    const lf = (key, field) => root.append(fieldControl({ key, ...field }, legal[key], (v, opts) => state.mutate((site) => { site.legal[key] = v ?? ""; }, { key: `legal:${key}`, source: opts?.rebuild ? null : "panel" }), {}));
    root.append(h("hr", { class: "sep" }), h("div", { class: "group-title" }, "Language, privacy & cookies"));
    root.append(fieldControl({ key: "lang", label: "Website language", type: "select", options: Object.keys(LANGUAGES), labels: Object.values(LANGUAGES).map((l) => l.name) }, s.site.lang, (v) => state.mutate((site) => { site.lang = v; }, { label: "Changed the language" }), {}));
    root.append(h("p", { class: "field-hint", style: { marginTop: "-6px" } }, "Sets the language for search engines and the few words the builder adds (dates, \"Sold out\", the cookie notice). The AI writes new text in it; to translate what's there, ask the AI tab, e.g. \"translate the whole site into French\"."));

    const privacy = s.site.pages.find((p) => p.slug === "privacy" && !p.post);
    root.append(h("div", { class: "field" }, h("label", {}, "Privacy policy"),
      h("div", { class: "row", style: { flexWrap: "wrap" } },
        privacy ? h("button", { class: "btn btn-sm", onclick: () => state.setPage(privacy.id) }, "Open it") : null,
        h("button", { class: "btn btn-sm", onclick: async () => {
          if (privacy && !(await confirmDialog("Rewrite the privacy policy from the site's current details? Changes you made to its text are replaced (you can undo).", { okText: "Rewrite it" }))) return;
          state.mutate((site) => { ensurePrivacyPage(site, { rewrite: true }); }, { label: privacy ? "Rewrote the privacy policy" : "Added a privacy policy" });
          toast(privacy ? "Privacy policy rewritten." : "Privacy policy added and linked in the footer.");
          render();
        } }, privacy ? "Rewrite from the site's details" : "Create a privacy policy page")),
      h("div", { class: "field-hint" }, "Written from what the site does: its forms, map, videos, payment links, fonts and tracking. A starting point, not legal advice: read it through", s.site.lang && !/^en/.test(s.site.lang) ? " (it's written in English: ask the AI tab to translate it)" : "", ".")));

    lf("trackingCode", { label: "Tracking code (Google Analytics, Meta Pixel…)", type: "code" });
    root.append(h("p", { class: "field-hint", style: { marginTop: "-8px" } }, "Paste the code the service gives you. It's added to every page but only runs after a visitor clicks Accept on the cookie notice."));
    lf("cookieNotice", { label: "Cookie notice", type: "select", options: ["auto", "always", "off"], labels: ["When needed (tracking code or code marked for consent)", "Always show it", "Never show it"] });
    if (legal.cookieNotice !== "off") lf("cookieText", { label: "Notice wording (optional)", type: "text", placeholder: "We'd like to use cookies to understand how visitors use this website." });
    root.append(h("p", { class: "field-hint", style: { marginTop: "-6px" } }, "Maps and videos load only when a visitor clicks them, so they don't need the notice. Visitors can change their mind with the \"Cookie settings\" link in the footer."));
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
    const KINDS = { booking: "Booking request", enquiry: "Enquiry", contact: "Message", newsletter: "Newsletter sign-up" };
    let filter = "open";
    const list = h("div", {});
    const tabs = h("div", { class: "chips", style: { marginBottom: "12px" } });
    const paint = () => {
      const shown = submissions.filter((x) => (filter === "open" ? !x.done : filter === "all" ? true : (x.kind || "contact") === filter));
      tabs.replaceChildren(...[["open", "To do"], ["booking", "Bookings"], ["enquiry", "Enquiries"], ["contact", "Messages"], ["newsletter", "Sign-ups"], ["all", "All"]].map(([k, label]) => {
        const n = submissions.filter((x) => (k === "open" ? !x.done : k === "all" ? true : (x.kind || "contact") === k)).length;
        return h("span", { class: `chip${filter === k ? " on" : ""}`, role: "button", tabindex: "0", onclick: () => { filter = k; paint(); } }, `${label} (${n})`);
      }));
      list.replaceChildren(...(shown.length ? shown.map((sub) => {
        const email = Object.values(sub.fields).find((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()));
        const done = h("input", { type: "checkbox", checked: !!sub.done, disabled: !sub.id, onchange: async (e) => {
          try { await api(`/sites/${siteId}/submissions/${sub.id}`, { method: "PATCH", body: { done: e.target.checked } }); sub.done = e.target.checked; paint(); } catch (err) { toast(err.message, { error: true }); }
        } });
        return h("div", { class: "version", style: { display: "block", opacity: sub.done ? 0.6 : 1 } },
          h("div", { class: "row", style: { justifyContent: "space-between", flexWrap: "wrap", gap: "8px" } },
            h("div", { class: "small muted" }, h("strong", {}, KINDS[sub.kind] || "Message"), ` · ${new Date(sub.at).toLocaleString()} · page: ${sub.page}`),
            h("div", { class: "row", style: { gap: "10px" } },
              email ? h("a", { class: "btn btn-sm", href: `mailto:${email}?subject=${encodeURIComponent(`Re: your ${(KINDS[sub.kind] || "message").toLowerCase()}`)}` }, "Reply") : null,
              h("label", { class: "check small" }, done, "Done"))),
          Object.entries(sub.fields).filter(([, v]) => String(v).trim()).map(([k, v]) => h("div", {}, h("strong", {}, `${k}: `), h("span", { style: { whiteSpace: "pre-wrap" } }, v))));
      }) : [h("p", { class: "muted" }, submissions.length ? "Nothing here." : "No messages yet. They'll appear here when visitors use a form on the live site.")]));
    };
    paint();
    const signups = submissions.filter((x) => x.kind === "newsletter");
    const csv = signups.length ? h("button", { class: "btn btn-sm", style: { marginBottom: "10px" }, onclick: () => {
      const text = ["Email,Signed up", ...signups.map((x) => `${x.fields.Email},${x.at}`)].join("\r\n");
      const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: "text/csv" })), download: "newsletter-sign-ups.csv" });
      a.click();
    } }, `Download ${signups.length} sign-up${signups.length === 1 ? "" : "s"} (CSV, for Mailchimp etc.)`) : null;
    modal({ title: "Messages, enquiries and bookings", wide: true, body: h("div", {}, tabs, csv, list) });
  }

  tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.tab)));

  return { render, show, askAi, active: () => active };
}
