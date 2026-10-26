// The editing canvas: renders the page into an iframe with the same renderer
// the live site uses, and handles selection, inline text editing and
// drag-and-drop.
//
// Drag-and-drop is pointer-based rather than HTML5 DnD: while dragging, a
// transparent overlay covers the iframe so the editor receives every pointer
// move, and drop positions are worked out from the iframe's layout.

import { renderBody, renderCss, fontsHref } from "/admin/shared/render.js";
import { createBlock, createSection, findNode, reId, BLOCKS } from "/admin/shared/schema.js";
import { sanitizeRichText } from "/admin/shared/sanitize.js";
import { h } from "../ui.js";

const EDITOR_CSS = `
[data-eka-kind]{cursor:default}
a,button,summary,label{cursor:default!important}
.eka-hover{outline:1px dashed rgba(79,70,229,.7);outline-offset:-1px}
section.eka-hover{outline:2px dashed rgba(15,118,110,.55);outline-offset:-2px}
.eka-sel{outline:2px solid #4f46e5!important;outline-offset:-2px}
section.eka-sel,header.eka-sel,footer.eka-sel{outline:2px solid #0f766e!important;outline-offset:-2px}
.eka-col{min-height:48px}
.eka-col.eka-sel{outline:2px dashed #4f46e5!important}
.eka-empty{border:2px dashed #c4c8da;border-radius:8px;padding:22px 10px;text-align:center;color:#7d8399;font:600 13px system-ui,sans-serif;background:rgba(255,255,255,.55)}
.bg-dark .eka-empty,.bg-primary .eka-empty,.bg-image .eka-empty{background:rgba(255,255,255,.08);color:inherit;border-color:rgba(255,255,255,.4)}
.eka-page-empty{margin:48px auto;max-width:640px;padding:64px 24px;border:2px dashed #c4c8da;border-radius:12px;text-align:center;color:#7d8399;font:600 15px system-ui,sans-serif}
[contenteditable]{outline:2px solid #f59e0b!important;outline-offset:3px;cursor:text!important;border-radius:2px}
.eka-drag-src{opacity:.3}
.eka-header.sticky{position:relative}
.eka-form-ok{display:none!important}
.eka-img,.eka-gallery{position:relative}
.eka-ph-tag{position:absolute;top:10px;left:10px;z-index:3;background:rgba(17,24,39,.78);color:#fff;font:600 11px/1.2 system-ui,sans-serif;padding:5px 8px;border-radius:5px;pointer-events:none;letter-spacing:.01em}
section>.eka-ph-tag{top:12px;left:12px}
.an{animation:none!important}
.an.eka-an-play{animation:var(--an) var(--an-d,.8s) cubic-bezier(.2,.7,.2,1) var(--an-delay,0s) both!important}
`;

export function createCanvas({ state, iframe, overlay, frameWrap, onRequestMedia, onAskAi, onKey }) {
  let doc = null;
  let win = null;
  let ready = null;
  let inline = null; // { el, id, mode }
  let hoverEl = null;
  let selBar = null;
  let rtBar = null;
  let lastFonts = "";
  let scale = 1; // canvas CSS px → screen px

  // ---------------------------------------------------------------- setup --

  function boot() {
    ready = new Promise((resolve) => {
      iframe.addEventListener("load", () => {
        doc = iframe.contentDocument;
        win = iframe.contentWindow;
        attachEvents();
        resolve();
      }, { once: true });
    });
    iframe.srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="eka-theme"></style><style>${EDITOR_CSS}</style><link id="eka-fonts" rel="stylesheet"></head><body></body></html>`;
    return ready;
  }

  function attachEvents() {
    doc.addEventListener("mouseover", (e) => {
      if (overlay.classList.contains("dragging")) return;
      const el = e.target.closest?.("[data-eka-kind]");
      if (el === hoverEl) return;
      hoverEl?.classList.remove("eka-hover");
      hoverEl = el;
      if (el && el.dataset.ekaId !== state.get().selectedId) el.classList.add("eka-hover");
    });
    doc.addEventListener("mouseleave", () => { hoverEl?.classList.remove("eka-hover"); hoverEl = null; });

    doc.addEventListener("click", (e) => {
      if (inline && inline.el.contains(e.target)) return;
      e.preventDefault();
      if (inline) stopInline();
      const el = e.target.closest("[data-eka-kind]");
      state.select(el ? el.dataset.ekaId : null);
    }, true);

    doc.addEventListener("dblclick", (e) => {
      const blockEl = e.target.closest('[data-eka-kind="block"]');
      if (!blockEl) return;
      const id = blockEl.dataset.ekaId;
      const found = findNode(state.get().site, id);
      if (!found) return;
      const editable = e.target.closest("[data-eka-edit]");
      if (editable && blockEl.contains(editable)) {
        e.preventDefault();
        state.select(id);
        startInline(editable, id, editable.dataset.ekaEdit);
      } else if (found.node.type === "image" || found.node.type === "gallery") {
        onRequestMedia(id);
      }
    });

    doc.addEventListener("submit", (e) => e.preventDefault(), true);
    doc.addEventListener("keydown", (e) => {
      if (inline) {
        if (e.key === "Escape" || (e.key === "Enter" && inline.mode === "text")) { e.preventDefault(); stopInline(); }
        return;
      }
      onKey?.(e);
    });
    win.addEventListener("scroll", positionBars, { passive: true });
    win.addEventListener("resize", positionBars);
  }

  // --------------------------------------------------------------- render --

  async function render({ keepScroll = true } = {}) {
    await ready;
    const s = state.get();
    const page = state.page();
    const y = keepScroll ? win.scrollY : 0;
    if (inline) stopInline({ commit: false });
    doc.getElementById("eka-theme").textContent = renderCss(s.site);
    const fonts = fontsHref(s.site, page);
    if (fonts !== lastFonts) {
      lastFonts = fonts;
      const link = doc.getElementById("eka-fonts");
      if (fonts) link.href = fonts; else link.removeAttribute("href");
    }
    doc.body.innerHTML = renderBody(s.site, page, { editor: true, base: "/" });
    hoverEl = null;
    win.scrollTo(0, y);
    updateSelection();
  }

  // ------------------------------------------------------------ selection --

  function elFor(id) {
    return id ? doc?.querySelector(`[data-eka-id="${CSS.escape(id)}"]`) : null;
  }

  function updateSelection() {
    if (!doc) return;
    doc.querySelectorAll(".eka-sel").forEach((el) => el.classList.remove("eka-sel"));
    const id = state.get().selectedId;
    const el = elFor(id);
    el?.classList.add("eka-sel");
    el?.classList.remove("eka-hover");
    drawSelBar(el);
  }

  function drawSelBar(el) {
    selBar?.remove();
    selBar = null;
    if (!el) return;
    const sel = state.selected();
    if (!sel) return;
    const kind = sel.kind;
    let label = kind;
    if (kind === "block") label = BLOCKS[sel.node.type]?.label || "Block";
    if (kind === "section") label = "Section";
    if (kind === "column") label = "Column";
    if (kind === "header") label = "Header";
    if (kind === "footer") label = "Footer";

    const btn = (icon, title, fn, cls = "") => h("button", { title, "aria-label": title, class: cls, onclick: (e) => { e.stopPropagation(); fn(); } }, icon);
    const movable = kind === "block" || kind === "section";
    const id = state.get().selectedId;

    selBar = h("div", { class: `sel-bar ${kind === "block" || kind === "column" ? "" : "section"}` },
      movable ? h("button", { class: "grip", title: "Drag to move", "aria-label": "Drag to move", onpointerdown: (e) => startDrag(e, { kind: kind === "block" ? "move-block" : "move-section", id }, label, true) }, "⠿") : null,
      h("span", { class: "lbl" }, label),
      kind === "block" || kind === "column" ? btn("⤒", "Select section", () => state.select(findNode(state.get().site, id).section.id)) : null,
      movable ? btn("↑", "Move up", () => moveBy(id, -1)) : null,
      movable ? btn("↓", "Move down", () => moveBy(id, 1)) : null,
      movable ? btn("⧉", "Duplicate (Ctrl+D)", () => duplicate(id)) : null,
      movable ? btn("✦", "Ask AI to change this", () => onAskAi?.(id)) : null,
      movable ? btn("🗑", "Delete (Del)", () => remove(id)) : null,
    );
    overlay.append(selBar);
    positionBars();
  }

  function positionBars() {
    const id = state.get().selectedId;
    const el = elFor(id);
    if (selBar && el) {
      const r = scaled(el.getBoundingClientRect());
      const barH = 28;
      const w = selBar.offsetWidth;
      let top = r.top - barH;
      selBar.classList.toggle("below", top < 0);
      if (top < 0) top = Math.max(0, Math.min(r.bottom, frameWrap.clientHeight - barH));
      const left = Math.max(0, Math.min(r.left + (el.tagName === "SECTION" || el.tagName === "HEADER" || el.tagName === "FOOTER" ? 8 : 0), frameWrap.clientWidth - w));
      selBar.style.top = `${top}px`;
      selBar.style.left = `${left}px`;
      selBar.style.display = r.bottom < 0 || r.top > frameWrap.clientHeight ? "none" : "flex";
    }
    if (rtBar && inline) {
      const r = scaled(inline.el.getBoundingClientRect());
      rtBar.style.top = `${Math.max(0, r.top - 40)}px`;
      rtBar.style.left = `${Math.max(0, r.left)}px`;
    }
  }

  function scaled(r) {
    return { top: r.top * scale, bottom: r.bottom * scale, left: r.left * scale, right: r.right * scale, width: r.width * scale, height: r.height * scale };
  }

  function setScale(s) {
    scale = s;
    positionBars();
  }

  // ----------------------------------------------------- inline text edit --

  function startInline(el, id, mode) {
    if (inline) stopInline();
    inline = { el, id, mode };
    try { el.contentEditable = mode === "text" ? "plaintext-only" : "true"; } catch { el.contentEditable = "true"; }
    if (el.contentEditable !== "plaintext-only" && mode === "text") el.contentEditable = "true";
    el.focus();
    el.addEventListener("input", onInlineInput);
    el.addEventListener("blur", onInlineBlur);
    el.addEventListener("paste", onInlinePaste);
    if (mode === "html") {
      const cmd = (c, v) => (e) => { e.preventDefault(); doc.execCommand(c, false, v); onInlineInput(); };
      rtBar = h("div", { class: "rt-bar", onmousedown: (e) => e.preventDefault() },
        h("button", { title: "Bold", onmousedown: cmd("bold") }, "B"),
        h("button", { title: "Italic", onmousedown: cmd("italic"), style: { fontStyle: "italic" } }, "I"),
        h("button", { title: "Link", onmousedown: (e) => { e.preventDefault(); const url = prompt("Link to (e.g. /contact, #contact, https://…, tel:…)"); if (url) { doc.execCommand("createLink", false, url); onInlineInput(); } } }, "🔗"),
        h("button", { title: "Bullet list", onmousedown: cmd("insertUnorderedList") }, "•"),
        h("button", { title: "Remove formatting", onmousedown: cmd("removeFormat") }, "⌫"),
        h("button", { title: "Done (Esc)", onmousedown: (e) => { e.preventDefault(); stopInline(); } }, "✓"),
      );
      overlay.append(rtBar);
    }
    positionBars();
  }

  function readInline() {
    const { el, mode } = inline;
    return mode === "text" ? el.innerText.replace(/\s+/g, " ").trim() : sanitizeRichText(el.innerHTML);
  }

  function onInlineInput() {
    if (!inline) return;
    const { id, mode } = inline;
    const value = readInline();
    state.mutate((site) => {
      const f = findNode(site, id);
      if (f) f.node.props[mode === "text" ? "text" : "html"] = value;
    }, { key: `inline:${id}`, silent: true });
  }

  function onInlinePaste(e) {
    // Paste as plain text so formatting from Word/web pages doesn't leak in.
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    doc.execCommand("insertText", false, text);
  }

  function onInlineBlur() {
    // Let toolbar clicks keep focus (they preventDefault on mousedown).
    setTimeout(() => { if (inline && doc.activeElement !== inline.el) stopInline(); }, 0);
  }

  function stopInline({ commit = true } = {}) {
    if (!inline) return;
    const { el } = inline;
    if (commit) onInlineInput();
    el.removeAttribute("contenteditable");
    el.removeEventListener("input", onInlineInput);
    el.removeEventListener("blur", onInlineBlur);
    el.removeEventListener("paste", onInlinePaste);
    inline = null;
    rtBar?.remove();
    rtBar = null;
    if (commit) render();
  }

  // ------------------------------------------------------- tree operations --

  function moveBy(id, delta) {
    state.mutate((site) => {
      const f = findNode(site, id);
      if (!f) return;
      const to = f.index + delta;
      if (to < 0 || to >= f.parent.length) {
        // Blocks at the edge of a column hop to the neighbouring section.
        if (f.kind === "block") {
          const sections = f.page.sections;
          const si = sections.indexOf(f.section);
          const next = sections[si + delta];
          if (!next) return;
          f.parent.splice(f.index, 1);
          const col = next.columns[0];
          if (delta < 0) col.blocks.push(f.node); else col.blocks.unshift(f.node);
        }
        return;
      }
      const [node] = f.parent.splice(f.index, 1);
      f.parent.splice(to, 0, node);
    });
    scrollTo(id);
  }

  function duplicate(id) {
    let newId = null;
    state.mutate((site) => {
      const f = findNode(site, id);
      if (!f) return;
      const copy = reId(f.node);
      newId = copy.id;
      f.parent.splice(f.index + 1, 0, copy);
    });
    if (newId) { state.select(newId); scrollTo(newId); }
  }

  function remove(id) {
    state.mutate((site) => {
      const f = findNode(site, id);
      if (f && (f.kind === "block" || f.kind === "section")) f.parent.splice(f.index, 1);
    });
    state.select(null);
  }

  function scrollTo(id) {
    requestAnimationFrame(() => setTimeout(() => {
      const el = elFor(id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top < 60 || r.bottom > win.innerHeight - 20) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 30));
  }

  // --------------------------------------------------------- drag & drop --

  let drag = null;

  // payload kinds: new-block {type} | new-section {make} | move-block {id} | move-section {id}
  function startDrag(e, payload, label, immediate = false) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    drag = { payload, label, started: false, target: null, x: startX, y: startY, ghost: null, line: null, raf: 0 };

    const begin = () => {
      drag.started = true;
      drag.ghost = h("div", { class: "drag-ghost" }, label);
      document.body.append(drag.ghost);
      overlay.classList.add("dragging");
      if (payload.id) elFor(payload.id)?.classList.add("eka-drag-src");
      selBar && (selBar.style.visibility = "hidden");
      drag.raf = requestAnimationFrame(autoScroll);
    };
    if (immediate) begin();

    const move = (ev) => {
      drag.x = ev.clientX; drag.y = ev.clientY;
      if (!drag.started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        begin();
      }
      drag.ghost.style.left = `${ev.clientX}px`;
      drag.ghost.style.top = `${ev.clientY}px`;
      updateTarget();
    };
    const up = () => {
      cleanup();
      if (!drag.started) {
        // A click on a palette item (no drag) adds it at a sensible spot.
        if (payload.kind.startsWith("new-")) insertByClick(payload);
        drag = null;
        return;
      }
      const target = drag.target;
      drag = null;
      if (target) applyDrop(payload, target);
      else updateSelection();
    };
    const key = (ev) => { if (ev.key === "Escape") { drag.target = null; up(); } };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
      cancelAnimationFrame(drag?.raf);
      drag?.ghost?.remove();
      drag?.line?.remove();
      overlay.classList.remove("dragging");
      doc?.querySelectorAll(".eka-drag-src").forEach((el) => el.classList.remove("eka-drag-src"));
      selBar && (selBar.style.visibility = "");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
  }

  function autoScroll() {
    if (!drag) return;
    const r = frameWrap.getBoundingClientRect();
    const inside = drag.x >= r.left && drag.x <= r.right;
    if (inside && drag.y > r.top && drag.y < r.top + 60) { win.scrollBy(0, -14); updateTarget(); }
    else if (inside && drag.y < r.bottom && drag.y > r.bottom - 60) { win.scrollBy(0, 14); updateTarget(); }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function updateTarget() {
    const r = frameWrap.getBoundingClientRect();
    const inside = drag.x >= r.left && drag.y >= r.top && drag.x <= r.right && drag.y <= r.bottom;
    const x = (drag.x - r.left) / scale, y = (drag.y - r.top) / scale;
    drag.target = inside ? computeTarget(drag.payload, x, y) : null;
    drawLine(drag.target);
  }

  function sectionEls() {
    return [...doc.querySelectorAll('main > section[data-eka-kind="section"]')];
  }

  function sectionIndexAt(y, skipId) {
    const els = sectionEls().filter((el) => el.dataset.ekaId !== skipId);
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return { index: i, els };
    }
    return { index: els.length, els };
  }

  function sectionLine(index, els, label) {
    const main = doc.querySelector("main");
    let top;
    if (!els.length) top = main.getBoundingClientRect().top + 10;
    else if (index < els.length) top = els[index].getBoundingClientRect().top;
    else top = els[els.length - 1].getBoundingClientRect().bottom;
    return { top: top - 3, left: 0, width: doc.documentElement.clientWidth, cls: "section", label };
  }

  function computeTarget(payload, x, y) {
    const isSection = payload.kind === "new-section" || payload.kind === "move-section";
    if (isSection) {
      const { index, els } = sectionIndexAt(y, payload.kind === "move-section" ? payload.id : null);
      return { type: "section", index, line: sectionLine(index, els, "Drop section here") };
    }

    const hit = doc.elementFromPoint(x, y);
    let col = hit?.closest?.('[data-eka-kind="column"]');
    if (!col) {
      const sec = hit?.closest?.('section[data-eka-kind="section"]');
      if (sec) {
        // Over a section's padding: use the horizontally nearest column.
        const cols = [...sec.querySelectorAll(':scope [data-eka-kind="column"]')];
        let best = null, bestD = Infinity;
        for (const c of cols) {
          const cr = c.getBoundingClientRect();
          const d = x < cr.left ? cr.left - x : x > cr.right ? x - cr.right : 0;
          if (d < bestD) { bestD = d; best = c; }
        }
        col = best;
      }
    }
    if (col) {
      const blocks = [...col.children].filter((el) => el.dataset.ekaKind === "block" && el.dataset.ekaId !== payload.id);
      let index = blocks.length;
      for (let i = 0; i < blocks.length; i++) {
        const br = blocks[i].getBoundingClientRect();
        if (y < br.top + br.height / 2) { index = i; break; }
      }
      const cr = col.getBoundingClientRect();
      let top;
      if (!blocks.length) top = cr.top + Math.min(cr.height, 60) / 2;
      else if (index < blocks.length) top = blocks[index].getBoundingClientRect().top - 9;
      else top = blocks[blocks.length - 1].getBoundingClientRect().bottom + 5;
      return { type: "block", columnId: col.dataset.ekaId, index, line: { top, left: cr.left, width: cr.width, cls: "", label: "Drop here" } };
    }

    // Not over a column (header, footer, empty page): make a new section.
    const { index, els } = sectionIndexAt(y);
    return { type: "new-section", index, line: sectionLine(index, els, "New section") };
  }

  function drawLine(target) {
    if (!target) { drag.line?.remove(); drag.line = null; return; }
    if (!drag.line) { drag.line = h("div", { class: "drop-line" }); overlay.append(drag.line); }
    const l = target.line;
    drag.line.className = `drop-line ${l.cls}`;
    drag.line.dataset.label = l.label;
    drag.line.style.top = `${Math.max(2, l.top * scale)}px`;
    drag.line.style.left = `${l.left * scale}px`;
    drag.line.style.width = `${l.width * scale}px`;
  }

  function makeSections(payload) {
    const made = payload.make();
    return Array.isArray(made) ? made : [made];
  }

  function applyDrop(payload, target) {
    let selectId = null;
    state.mutate((site) => {
      const page = site.pages.find((p) => p.id === state.get().pageId) || site.pages[0];
      let node = null;

      if (payload.kind === "new-block") node = createBlock(payload.type);
      if (payload.kind === "move-block" || payload.kind === "move-section") {
        const f = findNode(site, payload.id);
        if (!f) return;
        node = f.node;
        f.parent.splice(f.index, 1); // indexes in `target` already exclude the dragged node
      }

      if (target.type === "section") {
        const sections = payload.kind === "new-section" ? makeSections(payload) : [node];
        page.sections.splice(target.index, 0, ...sections);
        selectId = sections[0].id;
      } else if (target.type === "block") {
        const col = findNode(site, target.columnId);
        if (!col) return;
        col.node.blocks.splice(target.index, 0, node);
        selectId = node.id;
      } else if (target.type === "new-section") {
        const section = createSection({}, [[node]]);
        page.sections.splice(target.index, 0, section);
        selectId = node.id;
      }
    });
    if (selectId) { state.select(selectId); scrollTo(selectId); }
  }

  // Click-to-add: put the new item next to whatever is selected.
  function insertByClick(payload) {
    const s = state.get();
    const sel = s.selectedId ? findNode(s.site, s.selectedId) : null;
    let selectId = null;
    state.mutate((site) => {
      const page = site.pages.find((p) => p.id === s.pageId) || site.pages[0];
      const f = sel ? findNode(site, sel.node.id) : null;
      if (payload.kind === "new-block") {
        const block = createBlock(payload.type);
        selectId = block.id;
        if (f?.kind === "block") f.parent.splice(f.index + 1, 0, block);
        else if (f?.kind === "column") f.node.blocks.push(block);
        else if (f?.kind === "section") f.node.columns[0].blocks.push(block);
        else page.sections.push(createSection({}, [[block]]));
      } else {
        const sections = makeSections(payload);
        selectId = sections[0].id;
        const sectionIdx = f ? page.sections.indexOf(f.kind === "section" ? f.node : f.section) : -1;
        page.sections.splice(sectionIdx >= 0 ? sectionIdx + 1 : page.sections.length, 0, ...sections);
      }
    });
    if (selectId) { state.select(selectId); scrollTo(selectId); }
  }

  // Plays an element's entrance animation once (animations are off while editing).
  function playAnimation(id) {
    const el = elFor(id);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.remove("eka-an-play");
    void el.offsetWidth;
    el.classList.add("eka-an-play");
    el.addEventListener("animationend", () => el.classList.remove("eka-an-play"), { once: true });
  }

  return {
    playAnimation,
    boot,
    render,
    updateSelection,
    positionBars,
    setScale,
    startDrag,
    insertByClick,
    moveBy,
    duplicate,
    remove,
    scrollTo,
    isEditingText: () => !!inline,
  };
}
