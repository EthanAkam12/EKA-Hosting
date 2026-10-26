// Renders a site document to static HTML + CSS.
//
// The output of a published page is a single HTML file with its CSS inlined
// and NO JavaScript: the mobile menu, FAQ accordions and form "thank you"
// messages are all pure HTML/CSS. Images are lazy-loaded with responsive
// srcsets, and videos/maps load nothing heavy until they are needed.
//
// The editor uses the same renderer with { editor: true }, which adds data
// attributes for selection and drag-and-drop. What you see is what you ship.

import { BLOCKS, FONT_CHOICES, LAYOUT_COLUMNS } from "./schema.js";
import { escapeHtml as esc, safeUrl, sanitizeRichText } from "./sanitize.js";

// ---------------------------------------------------------------------------
// Links & media
// ---------------------------------------------------------------------------

export function pageUrl(page, base = "/") {
  return page.slug === "index" ? base : `${base}${page.slug}/`;
}

// "/about" or "/about#team" → the right URL for wherever the site is served
// from (custom domain, subdomain or the /s/<slug>/ preview path).
function resolveHref(href, ctx) {
  const url = safeUrl(href);
  if (!url) return "#";
  if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/_m/")) {
    const [path, hash] = url.slice(1).split("#");
    const slug = path.replace(/\/+$/, "") || "index";
    const page = ctx.site.pages.find((p) => p.slug === slug);
    if (page) return pageUrl(page, ctx.base) + (hash ? `#${hash}` : "");
  }
  return url;
}

function attrHref(href, ctx) {
  const url = resolveHref(href, ctx);
  const ext = /^https?:\/\//i.test(url);
  return `href="${esc(url)}"${ext ? ' target="_blank" rel="noopener"' : ""}`;
}

// Uploaded images are converted to WebP at two sizes: name-o.webp (≤1920px)
// and name-o-sm.webp (≤800px). Emit a srcset so phones get the small one.
function img(src, alt, ctx, { sizes = "100vw", cls = "", eager = false } = {}) {
  const url = safeUrl(src);
  if (!url) return "";
  // The first couple of images on a page are likely above the fold: load
  // them with high priority instead of lazily.
  const priority = eager || ctx.eagerImages > 0;
  if (ctx.eagerImages > 0) ctx.eagerImages--;
  let srcset = "";
  if (/^\/_m\/[^?#]+-o\.webp$/.test(url)) {
    srcset = ` srcset="${esc(url.replace(/-o\.webp$/, "-o-sm.webp"))} 800w, ${esc(url)} 1920w" sizes="${esc(sizes)}"`;
  }
  return `<img src="${esc(url)}"${srcset} alt="${esc(alt)}"${cls ? ` class="${cls}"` : ""} ${priority ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

// Generated placeholder pictures get a small tag in the editor only.
const isPlaceholder = (url) => /\/placeholder-[\w-]+\.(webp|svg)$/.test(String(url || ""));
const phTag = (ctx, text) => (ctx.editor ? `<span class="eka-ph-tag">${text}</span>` : "");

function placeholderImage(label = "Add an image") {
  return `<div class="eka-ph" role="img" aria-label="${esc(label)}"><span>${esc(label)}</span></div>`;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const renderers = {
  heading(p, ctx) {
    const lvl = [1, 2, 3, 4].includes(Number(p.level)) ? Number(p.level) : 2;
    return `<h${lvl} class="eka-h t-${p.align}"${ctx.editor ? ' data-eka-edit="text"' : ""}>${esc(p.text)}</h${lvl}>`;
  },

  text(p, ctx) {
    return `<div class="eka-text t-${p.align}"${ctx.editor ? ' data-eka-edit="html"' : ""}>${sanitizeRichText(p.html)}</div>`;
  },

  buttons(p, ctx) {
    const items = p.items.filter((b) => b.text);
    if (!items.length) return ctx.editor ? `<div class="eka-hint">Add buttons in the panel</div>` : "";
    return `<div class="eka-btns j-${p.align}">${items
      .map((b) => {
        const icon = BUTTON_ICONS[b.icon] ? `<svg class="bi-${b.icon}" viewBox="0 0 24 24" aria-hidden="true">${BUTTON_ICONS[b.icon]}</svg>` : "";
        const label = `<span>${esc(b.text)}</span>`;
        return `<a class="eka-btn btn-${b.style}" ${attrHref(b.href, ctx)}>${b.icon === "arrow" ? label + icon : icon + label}</a>`;
      })
      .join("")}</div>`;
  },

  logo(p, ctx) {
    const hd = ctx.site.header;
    const src = p.image || hd.logoImage;
    const hgt = Math.max(20, Math.min(400, Number(p.height) || 80));
    const inner = src
      ? `<img src="${esc(safeUrl(src))}" alt="${esc(hd.logoText || ctx.site.name)}" style="height:${hgt}px;width:auto" loading="lazy" decoding="async">`
      : `<span class="eka-logo-text" style="font-size:${Math.round(hgt * 0.45)}px">${esc(hd.logoText || ctx.site.name)}</span>`;
    return `<div class="eka-logo-b j-${p.align}">${p.link ? `<a ${attrHref("/", ctx)}>${inner}</a>` : inner}</div>`;
  },

  image(p, ctx) {
    const ratio = p.ratio === "auto" ? "" : ` r-${p.ratio.replace(":", "-")}`;
    const inner = p.src ? img(p.src, p.alt, ctx, { sizes: "(max-width: 760px) 100vw, 50vw" }) : ctx.editor ? placeholderImage() : "";
    if (!inner) return "";
    const cap = p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : "";
    const tag = isPlaceholder(p.src) ? phTag(ctx, "Placeholder · double-click to replace") : "";
    return `<figure class="eka-img${ratio}${p.rounded ? " rounded" : ""}">${tag}${inner}${cap}</figure>`;
  },

  list(p) {
    const tag = p.icon === "number" ? "ol" : "ul";
    return `<${tag} class="eka-list li-${p.icon}">${p.items.map((i) => `<li>${esc(i)}</li>`).join("")}</${tag}>`;
  },

  card(p, ctx) {
    const media = p.image
      ? `<div class="eka-card-img">${img(p.image, p.title, ctx, { sizes: "(max-width: 760px) 100vw, 33vw" })}</div>`
      : p.icon ? `<div class="eka-card-icon" aria-hidden="true">${esc(p.icon)}</div>` : "";
    const link = p.linkText ? `<a class="eka-card-link" ${attrHref(p.href, ctx)}>${esc(p.linkText)} →</a>` : "";
    return `<div class="eka-card c-${p.style} t-${p.align}">${media}<div class="eka-card-body">${p.title ? `<h3>${esc(p.title)}</h3>` : ""}${p.text ? `<p>${esc(p.text)}</p>` : ""}${link}</div></div>`;
  },

  pricing(p, ctx) {
    return `<div class="eka-price${p.featured ? " featured" : ""}"><h3>${esc(p.name)}</h3><div class="eka-price-amt"><strong>${esc(p.price)}</strong><span>${esc(p.period)}</span></div><ul class="eka-list li-check">${p.features
      .map((f) => `<li>${esc(f)}</li>`)
      .join("")}</ul>${p.buttonText ? `<a class="eka-btn ${p.featured ? "btn-primary" : "btn-outline"}" ${attrHref(p.href, ctx)}>${esc(p.buttonText)}</a>` : ""}</div>`;
  },

  testimonial(p, ctx) {
    const rating = Number(p.rating) || 0;
    const stars = rating ? `<div class="eka-stars" aria-label="${rating} out of 5 stars">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</div>` : "";
    const photo = p.image ? img(p.image, p.name, ctx, { sizes: "56px", cls: "eka-avatar" }) : "";
    return `<figure class="eka-quote">${stars}<blockquote>${esc(p.quote)}</blockquote><figcaption>${photo}<span><strong>${esc(p.name)}</strong>${p.role ? `<small>${esc(p.role)}</small>` : ""}</span></figcaption></figure>`;
  },

  stats(p) {
    return `<div class="eka-stats">${p.items.map((s) => `<div><strong>${esc(s.value)}</strong><span>${esc(s.label)}</span></div>`).join("")}</div>`;
  },

  faq(p) {
    return `<div class="eka-faq">${p.items.map((i) => `<details><summary>${esc(i.q)}</summary><p>${esc(i.a)}</p></details>`).join("")}</div>`;
  },

  gallery(p, ctx) {
    const imgs = p.images.filter((i) => i.src);
    if (!imgs.length) return ctx.editor ? `<div class="eka-gallery g-${p.columns}">${placeholderImage("Add gallery images")}</div>` : "";
    const sizes = `(max-width: 760px) 50vw, ${Math.round(100 / p.columns)}vw`;
    const tag = imgs.some((i) => isPlaceholder(i.src)) ? phTag(ctx, "Placeholder photos · replace in the panel") : "";
    return `<div class="eka-gallery g-${p.columns}">${tag}${imgs.map((i) => img(i.src, i.alt, ctx, { sizes })).join("")}</div>`;
  },

  video(p, ctx) {
    const embed = videoEmbed(p.url);
    if (!embed) return ctx.editor ? placeholderImage("Paste a YouTube or Vimeo link") : "";
    if (embed.youtube) {
      // Zero-JS "lite" embed: only a thumbnail loads until the visitor clicks
      // play, saving ~1MB of YouTube scripts per page view.
      const play = `https://www.youtube-nocookie.com/embed/${embed.youtube}?autoplay=1`;
      const thumb = `https://i.ytimg.com/vi/${embed.youtube}/hqdefault.jpg`;
      const doc = `<style>*{margin:0}a{display:block;height:100vh;position:relative;background:#000}img{width:100%;height:100%;object-fit:cover;opacity:.85}span{position:absolute;inset:0;margin:auto;width:72px;height:50px;border-radius:12px;background:#f00;color:#fff;font:28px/50px sans-serif;text-align:center}</style><a href="${play}"><img src="${thumb}" alt=""><span>▶</span></a>`;
      return `<div class="eka-video"><iframe title="${esc(p.title)}" loading="lazy" srcdoc="${esc(doc)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
    }
    return `<div class="eka-video"><iframe title="${esc(p.title)}" loading="lazy" src="${esc(embed.src)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  },

  map(p) {
    if (!p.address) return "";
    const h = Math.max(160, Math.min(800, Number(p.height) || 320));
    const src = `https://maps.google.com/maps?q=${encodeURIComponent(p.address)}&output=embed`;
    return `<div class="eka-map" style="height:${h}px"><iframe title="Map of ${esc(p.address)}" loading="lazy" src="${esc(src)}" referrerpolicy="no-referrer-when-downgrade"></iframe></div>`;
  },

  form(p, ctx, block) {
    const fid = `f-${block.id}`;
    const fields = p.fields
      .map((f, i) => {
        const name = `field_${i}`;
        const id = `${fid}-${i}`;
        const req = f.required ? " required" : "";
        const input = f.type === "textarea"
          ? `<textarea id="${id}" name="${name}" rows="5"${req}></textarea>`
          : `<input id="${id}" name="${name}" type="${esc(f.type)}"${req}${f.type === "email" ? ' autocomplete="email"' : ""}>`;
        return `<label for="${id}">${esc(f.label)}${f.required ? " *" : ""}</label>${input}`;
      })
      .join("");
    const action = ctx.editor ? "#" : esc(ctx.formAction || "#");
    return `<div class="eka-form-wrap"><div id="sent-${block.id}" class="eka-form-ok" role="status">${esc(p.successMessage)}</div><form class="eka-form" method="post" action="${action}" id="${fid}"><input type="hidden" name="_block" value="${esc(block.id)}"><input type="hidden" name="_page" value="${esc(ctx.page.slug)}"><div class="eka-hp" aria-hidden="true"><label>Leave empty<input name="website" tabindex="-1" autocomplete="off"></label></div>${fields}<button class="eka-btn btn-primary" type="submit">${esc(p.submitText)}</button></form></div>`;
  },

  spacer(p) {
    const h = Math.max(0, Math.min(400, Number(p.size) || 0));
    return `<div class="eka-spacer" style="height:${h}px"></div>`;
  },

  divider() {
    return `<hr class="eka-hr">`;
  },

  html(p, ctx) {
    // Custom code is trusted (only the site owner can write it). In the editor
    // canvas scripts are neutralised so they can't interfere with editing.
    return ctx.editor
      ? `<div class="eka-html">${String(p.code).replace(/<script\b[\s\S]*?<\/script\s*>/gi, '<div class="eka-hint">[script runs on the live site]</div>')}</div>`
      : `<div class="eka-html">${p.code}</div>`;
  },
};

// Small line icons (Feather, MIT) drawn in the button's text colour.
const BUTTON_ICONS = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  email: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="m22 6-10 7L2 6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
  cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};

// ---------------------------------------------------------------------------
// Per-element styling (margin, padding, borders, animation…). Each styled
// element gets a class "x-<id>" and its rules go in one <style> per page.
// ---------------------------------------------------------------------------

const SHADOW_CSS = {
  sm: "0 1px 3px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.08)",
  md: "0 8px 20px -6px rgba(0,0,0,.18)",
  lg: "0 18px 40px -12px rgba(0,0,0,.25)",
  xl: "0 30px 64px -16px rgba(0,0,0,.35)",
};

export function hoverVars(effect) {
  const v = { t: "none", s: "var(--btn-sh,none)", f: "none", a: "none", sh: "none" };
  if (effect === "lift") { v.t = "translateY(-3px)"; v.s = "0 12px 22px -10px rgba(0,0,0,.45)"; }
  if (effect === "grow") v.t = "scale(1.05)";
  if (effect === "shrink") v.t = "scale(.95)";
  if (effect === "glow") v.s = "0 0 0 4px color-mix(in srgb,var(--c-primary) 25%,transparent),0 10px 26px -8px color-mix(in srgb,var(--c-primary) 70%,transparent)";
  if (effect === "brighten") v.f = "brightness(1.12)";
  if (effect === "pulse") v.a = "eka-pulse 1s ease-in-out infinite";
  if (effect === "wobble") v.a = "eka-wobble .6s ease";
  if (effect === "shine") v.sh = "eka-shine .8s ease";
  return `--bh-t:${v.t};--bh-s:${v.s};--bh-f:${v.f};--bh-a:${v.a};--bh-sh:${v.sh}`;
}

const BTN_SIZES = { sm: [38, 16, ".92rem"], md: [46, 24, "1rem"], lg: [54, 32, "1.08rem"], xl: [62, 40, "1.16rem"] };
const btnSizeVars = (size) => { const [hgt, px, fs] = BTN_SIZES[size] || BTN_SIZES.md; return `--btn-h:${hgt}px;--btn-px:${px}px;--btn-fs:${fs}`; };

const MEDIA = { d: "", t: "@media (max-width:1000px)", m: "@media (max-width:760px)" };
const HIDE_MEDIA = { d: "@media (min-width:1001px)", t: "@media (min-width:761px) and (max-width:1000px)", m: "@media (max-width:760px)" };
const SIDE_NAMES = { t: "top", r: "right", b: "bottom", l: "left" };

// Returns the extra classes for an element and adds its rules to ctx.css.
function styleNode(node, ctx, { kind, first }) {
  const st = node.style || {};
  const cls = [];
  const name = `x-${node.id.replace(/[^\w-]/g, "")}`;
  const sel = `.${name}.${name}`; // doubled: beats the base rules, e.g. the gap between blocks
  const rules = [];
  const at = {}; // media query → declarations
  const add = (decl, media = "") => (at[media] ||= []).push(decl);

  const anim = st.animation || (kind === "section" ? ctx.site.theme.layout.motion : "none");
  if (anim && anim !== "none") {
    cls.push("an", first ? "an-load" : "an-scroll");
    add(`--an:eka-${anim}`);
    if (st.speed) add(`--an-d:${st.speed === "fast" ? ".5s" : "1.2s"};--an-re:${st.speed === "fast" ? "40%" : "100%"}`);
    if (st.delay) add(`--an-delay:${st.delay}ms;--an-rs:${Math.min(50, Math.round(st.delay / 30))}%`);
  }
  if (st.hover) {
    add(hoverVars(st.hover));
    if (node.type !== "buttons") cls.push("hv");
  }
  if (st.btnSize) add(btnSizeVars(st.btnSize));

  if (st.maxWidth) {
    if (kind === "section") rules.push(`${sel}>.eka-wrap{--wrap:${st.maxWidth}px}`);
    else {
      add(`max-width:${st.maxWidth}px;width:100%`);
      if (st.align === "center") add("margin-left:auto;margin-right:auto");
      if (st.align === "right") add("margin-left:auto");
    }
  }
  for (const box of ["margin", "padding"]) {
    for (const [dev, sides] of Object.entries(st[box] || {})) {
      for (const [k, v] of Object.entries(sides)) add(`${box}-${SIDE_NAMES[k]}:${v}px`, MEDIA[dev]);
    }
  }
  if (st.bg) {
    if (st.bg2 && !(kind === "section" && node.props.background === "image")) add(`background:linear-gradient(135deg,${st.bg},${st.bg2})`);
    else add(`background-color:${st.bg}`);
  }
  if (st.color) add(`color:${st.color}`);
  if (st.radius !== undefined) {
    add(`border-radius:${st.radius}px`);
    if (kind === "section") add("overflow:hidden");
    else add(`--r:${st.radius}px;--btn-r:${st.radius}px`);
  }
  if (st.borderWidth) add(`border:${st.borderWidth}px ${st.borderStyle || "solid"} ${st.borderColor || "color-mix(in srgb,currentColor 25%,transparent)"}`);
  if (st.shadow) add(`box-shadow:${SHADOW_CSS[st.shadow]}`);
  if (st.gap !== undefined && kind === "section") rules.push(`${sel} .eka-cols{gap:${st.gap}px}`);
  if (kind === "header") {
    if (st.color) rules.push(`${sel} :is(.eka-logo,.eka-nav a:not(.eka-btn)){color:${st.color}}${sel} .eka-burger span,${sel} .eka-burger span::before,${sel} .eka-burger span::after{background:${st.color}}`);
    if (st.bg) rules.push(`${sel} .eka-nav{background:${st.bg}}`);
  }
  if (st.fontSize) {
    const fs = st.fontSize > 24 ? `clamp(${Math.round(st.fontSize * 0.6)}px,${(st.fontSize / 12.8).toFixed(2)}vw,${st.fontSize}px)` : `${st.fontSize}px`;
    rules.push(`${sel},${sel} :is(h1,h2,h3,h4,blockquote,.eka-btn){font-size:${fs}}`);
  }
  // Typography: on the element and on headings/buttons inside, which
  // otherwise use the site's heading and button settings.
  const type = [];
  if (st.fontWeight) type.push(`font-weight:${st.fontWeight}`);
  if (st.fontFamily && FONT_CHOICES[st.fontFamily]) type.push(`font-family:${FONT_CHOICES[st.fontFamily].stack}`);
  if (st.lineHeight) type.push(`line-height:${(st.lineHeight / 100).toFixed(2)}`);
  if (st.letterSpacing !== undefined) type.push(`letter-spacing:${st.letterSpacing}px`);
  if (st.textTransform) type.push(`text-transform:${st.textTransform}`);
  if (st.italic) type.push("font-style:italic");
  if (type.length) rules.push(`${sel},${sel} :is(h1,h2,h3,h4,blockquote,summary,.eka-btn,.eka-stats strong,.eka-price-amt strong){${type.join(";")}}`);
  for (const dev of Object.keys(st.hide || {})) {
    // The editor shows hidden elements faded so they can still be selected.
    rules.push(`${HIDE_MEDIA[dev]}{${sel}{${ctx.editor ? "opacity:.3;filter:grayscale(1)" : "display:none!important"}}}`);
  }

  // Desktop first, then tablet, then mobile, so the smaller screens win.
  const ordered = ["", MEDIA.t, MEDIA.m].filter((m) => at[m]).map((m) => (m ? `${m}{${sel}{${at[m].join(";")}}}` : `${sel}{${at[m].join(";")}}`));
  rules.unshift(...ordered);
  if (rules.length) { cls.push(name); ctx.css.push(...rules); }
  return cls;
}

function videoEmbed(url) {
  const u = String(url || "");
  const yt = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return { youtube: yt[1] };
  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { src: `https://player.vimeo.com/video/${vm[1]}?dnt=1` };
  return null;
}

function editorAttrs(ctx, kind, id) {
  return ctx.editor ? ` data-eka-kind="${kind}" data-eka-id="${esc(id)}"` : "";
}

export function renderBlock(block, ctx) {
  const fn = renderers[block.type];
  if (!fn) return "";
  const inner = fn(block.props, ctx, block);
  if (!inner && !ctx.editor) return `<div class="eka-b eka-b-${block.type}"></div>`;
  const extra = ctx.css ? styleNode(block, ctx, { kind: "block", first: ctx.sectionIndex === 0 }) : [];
  return `<div class="eka-b eka-b-${block.type}${extra.length ? " " + extra.join(" ") : ""}"${editorAttrs(ctx, "block", block.id)}>${inner}</div>`;
}

export function renderSection(section, ctx) {
  const p = section.props;
  const cls = ["eka-s", `bg-${p.background}`, `pad-${p.padding}`, `w-${p.width}`, `t-${p.align}`, `va-${p.valign}`];
  if (p.minHeight) cls.push("tall");
  if (ctx.css) cls.push(...styleNode(section, ctx, { kind: "section", first: ctx.sectionIndex === 0 }));
  let style = "";
  if (p.background === "image") {
    const url = safeUrl(p.image);
    if (url) style = ` style="background-image:url(&quot;${esc(url.replace(/"/g, "%22"))}&quot;);--ov:${(p.overlay / 100).toFixed(2)}"`;
    else style = ` style="--ov:${(p.overlay / 100).toFixed(2)}"`;
  }
  let columns = section.columns.map((c) => ({ c, blocks: c.blocks.map((b) => renderBlock(b, ctx)).filter((html) => !/^<div class="eka-b[^>]*><\/div>$/.test(html)) }));
  let layout = p.layout;
  if (!ctx.editor) {
    // On the live site, drop columns with nothing in them (e.g. an image
    // that hasn't been uploaded yet) so they don't leave a blank gap.
    const filled = columns.filter((col) => col.blocks.length);
    if (filled.length && filled.length < columns.length) {
      columns = filled;
      layout = ["1", "1-1", "1-1-1", "1-1-1-1"][filled.length - 1];
    }
  }
  const cols = columns
    .map(({ c, blocks }) => {
      const empty = ctx.editor && !c.blocks.length ? `<div class="eka-empty">Drop blocks here</div>` : "";
      return `<div class="eka-col"${editorAttrs(ctx, "column", c.id)}>${blocks.join("")}${empty}</div>`;
    })
    .join("");
  const id = p.anchor ? ` id="${esc(p.anchor)}"` : "";
  const bgTag = p.background === "image" && isPlaceholder(p.image) ? phTag(ctx, "Placeholder background · change it in the section settings") : "";
  return `<section${id} class="${cls.join(" ")}"${style}${editorAttrs(ctx, "section", section.id)}>${bgTag}<div class="eka-wrap"><div class="eka-cols l-${layout}">${cols}</div></div></section>`;
}

// ---------------------------------------------------------------------------
// Header / footer
// ---------------------------------------------------------------------------

function navLinks(site) {
  if (site.header.links) return site.header.links;
  return site.pages.map((p) => ({ text: p.title, href: p.slug === "index" ? "/" : `/${p.slug}` }));
}

function renderHeader(site, ctx) {
  const h = site.header;
  const logo = h.logoImage
    ? `<img src="${esc(safeUrl(h.logoImage))}" alt="${esc(h.logoText || site.name)}" height="${h.logoHeight || 40}" fetchpriority="high">`
    : `<span>${esc(h.logoText || site.name)}</span>`;
  // Logo size: --lh (image height) and --lt (text size), smaller on phones.
  const lh = h.logoHeight || 40, lt = h.logoTextSize || 20;
  const lhm = h.logoHeightMobile || Math.min(lh, 48);
  const logoVars = lh !== 40 || lt !== 20 || h.logoHeightMobile ? ` style="--lh:${lh}px;--lhm:${lhm}px;--lt:${lt}px"` : "";
  const links = navLinks(site);
  const current = pageUrl(ctx.page, ctx.base);
  const nav = links
    .map((l) => {
      const href = resolveHref(l.href, ctx);
      return `<a ${attrHref(l.href, ctx)}${href === current ? ' aria-current="page"' : ""}>${esc(l.text)}</a>`;
    })
    .join("");
  const cta = h.ctaText ? `<a class="eka-btn btn-primary" ${attrHref(h.ctaHref, ctx)}>${esc(h.ctaText)}</a>` : "";
  const burger = links.length || cta
    ? `<input type="checkbox" id="eka-nav-t" class="eka-nav-t"><label for="eka-nav-t" class="eka-burger" aria-label="Open menu"><span></span></label>`
    : "";
  const extra = ctx.css ? styleNode({ id: "header", type: "header", style: h.style }, ctx, { kind: "header" }) : [];
  return `<header class="eka-header${h.sticky ? " sticky" : ""}${extra.length ? " " + extra.join(" ") : ""}"${ctx.editor ? ' data-eka-kind="header" data-eka-id="header"' : ""}><div class="eka-wrap eka-header-in"><a class="eka-logo"${logoVars} ${attrHref("/", ctx)}>${logo}</a>${burger}<nav class="eka-nav" aria-label="Main">${nav}${cta}</nav></div></header>`;
}

function renderFooter(site, ctx) {
  const f = site.footer;
  const links = f.links.length ? `<nav class="eka-footer-links">${f.links.map((l) => `<a ${attrHref(l.href, ctx)}>${esc(l.text)}</a>`).join("")}</nav>` : "";
  const extra = ctx.css ? styleNode({ id: "footer", type: "footer", style: f.style }, ctx, { kind: "footer" }) : [];
  return `<footer class="eka-footer${extra.length ? " " + extra.join(" ") : ""}"${ctx.editor ? ' data-eka-kind="footer" data-eka-id="footer"' : ""}><div class="eka-wrap eka-footer-in"><p>${esc(f.text)}</p>${links}</div></footer>`;
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

export function themeCss(theme) {
  const c = theme.colors;
  const heading = FONT_CHOICES[theme.fonts.heading] || FONT_CHOICES.system;
  const body = FONT_CHOICES[theme.fonts.body] || FONT_CHOICES.system;
  const b = theme.buttons, t = theme.type, l = theme.layout;
  const btnR = { theme: "var(--r)", square: "0px", rounded: "8px", pill: "999px" }[b.shape];
  return `:root{--c-primary:${c.primary};--c-accent:${c.accent};--c-bg:${c.background};--c-surface:${c.surface};--c-text:${c.text};--c-muted:${c.muted};--c-dark:${c.dark};--c-on-primary:${contrastText(c.primary)};--c-on-dark:${contrastText(c.dark)};--f-head:${heading.stack};--f-body:${body.stack};--r:${theme.radius}px;`
    + `--btn-r:${btnR};${btnSizeVars(b.size)};--btn-w:${b.weight};--btn-tt:${b.uppercase ? "uppercase" : "none"};--btn-ls:${b.uppercase ? ".06em" : "0"};--btn-sh:${b.shadow ? "0 6px 16px -6px rgba(0,0,0,.35)" : "none"};${hoverVars(b.hover)};`
    + `--fs-base:${t.base}px;--hs:${t.headingScale / 100};--hw:${t.headingWeight};--wrap-n:${l.width}px;--sp:${l.spacing / 100}}`;
}

function contrastText(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#111111" : "#ffffff";
}

export const BASE_CSS = `*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;font-family:var(--f-body);font-size:var(--fs-base,17px);line-height:1.65;color:var(--c-text);background:var(--c-bg);-webkit-font-smoothing:antialiased}
img{max-width:100%;height:auto;display:block}
a{color:var(--c-primary)}
h1,h2,h3,h4{font-family:var(--f-head);font-weight:var(--hw,700);line-height:1.15;margin:0 0 .5em;letter-spacing:-.015em}
h1{font-size:calc(clamp(2.2rem,5vw,3.75rem)*var(--hs,1))}h2{font-size:calc(clamp(1.75rem,3.5vw,2.6rem)*var(--hs,1))}h3{font-size:calc(1.35rem*var(--hs,1))}h4{font-size:calc(1.1rem*var(--hs,1))}
main{overflow-x:clip}
p{margin:0 0 1em}
.eka-wrap{width:100%;max-width:var(--wrap,var(--wrap-n,1140px));margin:0 auto;padding:0 20px}
.t-left{text-align:left}.t-center{text-align:center}.t-right{text-align:right}
.eka-header{background:var(--c-bg);border-bottom:1px solid color-mix(in srgb,var(--c-text) 10%,transparent);z-index:50;position:relative}
.eka-header.sticky{position:sticky;top:0}
.eka-header-in{display:flex;align-items:center;gap:20px;min-height:68px}
.eka-logo{display:flex;align-items:center;font-family:var(--f-head);font-weight:700;font-size:1.25rem;color:var(--c-text);text-decoration:none;margin-right:auto}
.eka-logo{font-size:var(--lt,1.25rem)}.eka-logo img{height:var(--lh,40px);width:auto}
@media (max-width:760px){.eka-logo img{height:var(--lhm,40px)}}
.eka-logo-b{display:flex}.eka-logo-b a{display:inline-flex;text-decoration:none;color:inherit}.eka-logo-b img{max-width:100%;object-fit:contain}
.eka-logo-text{font-family:var(--f-head);font-weight:700;line-height:1.1}
.eka-nav{display:flex;align-items:center;gap:22px}
.eka-nav a:not(.eka-btn){color:var(--c-text);text-decoration:none;font-weight:500;font-size:.98rem}
.eka-nav a[aria-current=page]:not(.eka-btn),.eka-nav a:not(.eka-btn):hover{color:var(--c-primary)}
.eka-nav-t{position:absolute;opacity:0;pointer-events:none}
.eka-burger{display:none;width:44px;height:44px;cursor:pointer;position:relative}
.eka-burger span,.eka-burger span::before,.eka-burger span::after{position:absolute;left:10px;width:24px;height:2px;background:var(--c-text);content:"";transition:transform .2s}
.eka-burger span{top:21px}.eka-burger span::before{top:-7px;left:0}.eka-burger span::after{top:7px;left:0}
.eka-nav-t:focus-visible+.eka-burger{outline:2px solid var(--c-primary)}
@media (max-width:860px){.eka-burger{display:block}.eka-nav{display:none;position:absolute;top:100%;left:0;right:0;flex-direction:column;align-items:stretch;gap:0;padding:8px 20px 20px;background:var(--c-bg);border-bottom:1px solid color-mix(in srgb,var(--c-text) 10%,transparent)}.eka-nav a:not(.eka-btn){padding:12px 0;border-bottom:1px solid color-mix(in srgb,var(--c-text) 8%,transparent)}.eka-nav .eka-btn{margin-top:14px}.eka-nav-t:checked~.eka-nav{display:flex}.eka-nav-t:checked+.eka-burger span{background:transparent}.eka-nav-t:checked+.eka-burger span::before{transform:translateY(7px) rotate(45deg)}.eka-nav-t:checked+.eka-burger span::after{transform:translateY(-7px) rotate(-45deg)}}
.eka-s{position:relative;background-size:cover;background-position:center}
.eka-s>.eka-wrap{position:relative}
.pad-none{padding:0}.pad-sm{padding:calc(32px*var(--sp,1)) 0}.pad-md{padding:calc(56px*var(--sp,1)) 0}.pad-lg{padding:calc(88px*var(--sp,1)) 0}.pad-xl{padding:calc(128px*var(--sp,1)) 0}
@media (max-width:760px){.pad-md{padding:calc(44px*var(--sp,1)) 0}.pad-lg{padding:calc(60px*var(--sp,1)) 0}.pad-xl{padding:calc(84px*var(--sp,1)) 0}}
.w-narrow{--wrap:min(760px,var(--wrap-n,1140px))}.w-normal{--wrap:var(--wrap-n,1140px)}.w-wide{--wrap:calc(var(--wrap-n,1140px) + 220px)}.w-full{--wrap:none}.w-full>.eka-wrap{padding:0}
.tall{min-height:min(88vh,820px);display:flex;align-items:center}.tall>.eka-wrap{flex:1}
.bg-surface{background-color:var(--c-surface)}
.bg-primary{background-color:var(--c-primary);color:var(--c-on-primary)}
.bg-dark{background-color:var(--c-dark);color:var(--c-on-dark)}
.bg-image{background-color:var(--c-dark);color:#fff}
.bg-image::before{content:"";position:absolute;inset:0;background:rgba(0,0,0,var(--ov,.45))}
.bg-primary a:not(.eka-btn),.bg-dark a:not(.eka-btn),.bg-image a:not(.eka-btn){color:inherit}
.bg-primary .eka-muted,.bg-dark .eka-muted,.bg-image .eka-muted{color:inherit;opacity:.8}
.eka-cols{display:grid;gap:40px}
.l-1{grid-template-columns:1fr}.l-1-1{grid-template-columns:1fr 1fr}.l-2-1{grid-template-columns:2fr 1fr}.l-1-2{grid-template-columns:1fr 2fr}.l-1-1-1{grid-template-columns:repeat(3,1fr);gap:28px}.l-1-1-1-1{grid-template-columns:repeat(4,1fr);gap:24px}
.va-center .eka-cols{align-items:center}
@media (max-width:1000px){.l-1-1-1-1{grid-template-columns:repeat(2,1fr)}}
@media (max-width:760px){.eka-cols,.l-1-1-1-1{grid-template-columns:1fr;gap:28px}}
.eka-col{min-width:0;display:flex;flex-direction:column}
.eka-b+.eka-b{margin-top:18px}
.eka-col>.eka-b-card,.eka-col>.eka-b-pricing,.eka-col>.eka-b-testimonial{flex:1}
.eka-col>.eka-b-card>.eka-card,.eka-col>.eka-b-pricing>.eka-price,.eka-col>.eka-b-testimonial>.eka-quote{height:100%}
.eka-text>:last-child{margin-bottom:0}
.eka-text ul,.eka-text ol{padding-left:1.2em}
.eka-btns{display:flex;flex-wrap:wrap;gap:12px}
.j-left{justify-content:flex-start}.j-center{justify-content:center}.j-right{justify-content:flex-end}
.t-center .eka-btns.j-left{justify-content:center}
.eka-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5em;min-height:var(--btn-h,46px);padding:8px var(--btn-px,24px);border-radius:var(--btn-r,var(--r));font-weight:var(--btn-w,600);font-size:var(--btn-fs,1rem);text-transform:var(--btn-tt,none);letter-spacing:var(--btn-ls,0);box-shadow:var(--btn-sh,none);text-decoration:none;border:2px solid transparent;transition:transform .2s,box-shadow .2s,filter .2s,background-color .2s;cursor:pointer;font-family:inherit;line-height:1.2;position:relative;overflow:hidden}
.eka-btn::after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.45) 50%,transparent 70%);transform:translateX(-100%);pointer-events:none}
.eka-btn:hover{transform:var(--bh-t,none);box-shadow:var(--bh-s,none);filter:var(--bh-f,none);animation:var(--bh-a,none)}
.eka-btn:hover::after{animation:var(--bh-sh,none)}
.eka-btn svg{width:1.1em;height:1.1em;flex:none;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.bi-arrow{transition:transform .2s}.eka-btn:hover .bi-arrow{transform:translateX(3px)}
.hv>*{transition:transform .25s,box-shadow .25s,filter .25s}
.hv:hover>*{transform:var(--bh-t,none);box-shadow:var(--bh-s,none);filter:var(--bh-f,none);animation:var(--bh-a,none)}
.btn-primary{background:var(--c-primary);color:var(--c-on-primary)}
.btn-secondary{background:var(--c-accent);color:#111}
.btn-outline{border-color:currentColor;color:inherit;background:transparent}
.btn-light{background:#fff;color:#111}
.btn-dark{background:var(--c-dark);color:var(--c-on-dark)}
.btn-link{background:none;color:inherit;padding-left:0;padding-right:0;min-height:0;box-shadow:none;text-decoration:underline;text-underline-offset:4px}.btn-link::after{display:none}
.bg-primary .btn-primary{background:var(--c-on-primary);color:var(--c-primary)}
.eka-img{margin:0}.eka-img img{width:100%}.eka-img.rounded img,.eka-img.rounded .eka-ph{border-radius:var(--r)}
.eka-img[class*=" r-"] img{height:100%;object-fit:cover}
.r-16-9 img,.r-16-9 .eka-ph{aspect-ratio:16/9}.r-4-3 img,.r-4-3 .eka-ph{aspect-ratio:4/3}.r-1-1 img,.r-1-1 .eka-ph{aspect-ratio:1/1}.r-3-4 img,.r-3-4 .eka-ph{aspect-ratio:3/4}
.eka-img figcaption{font-size:.875rem;color:var(--c-muted);margin-top:8px}
.eka-ph{display:flex;align-items:center;justify-content:center;min-height:220px;aspect-ratio:4/3;background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--c-primary) 10%,transparent) 0 12px,color-mix(in srgb,var(--c-primary) 16%,transparent) 12px 24px);color:var(--c-primary);font-weight:600;font-size:.9rem}
.eka-list{list-style:none;padding:0;margin:0}.eka-list li{position:relative;padding-left:1.9em;margin-bottom:.55em}
.eka-list.li-check li::before{content:"✓";position:absolute;left:0;top:0;width:1.35em;height:1.35em;margin-top:.15em;border-radius:50%;background:color-mix(in srgb,var(--c-primary) 15%,transparent);color:var(--c-primary);font-size:.8em;font-weight:700;display:flex;align-items:center;justify-content:center}
.eka-list.li-dot li::before{content:"";position:absolute;left:.4em;top:.65em;width:.45em;height:.45em;border-radius:50%;background:var(--c-primary)}
ol.eka-list{counter-reset:n}ol.eka-list li{counter-increment:n}ol.eka-list li::before{content:counter(n);position:absolute;left:0;font-weight:700;color:var(--c-primary)}
.eka-list.li-none li{padding-left:0}
.eka-card{border-radius:var(--r);overflow:hidden;display:flex;flex-direction:column;color:var(--c-text)}
.c-surface{background:var(--c-surface)}.c-outline{border:1px solid color-mix(in srgb,var(--c-text) 14%,transparent)}.c-shadow{background:var(--c-bg);box-shadow:0 10px 30px -12px rgba(0,0,0,.18),0 2px 6px rgba(0,0,0,.05)}.c-plain{background:transparent;color:inherit}
.bg-surface .c-surface{background:var(--c-bg)}
.bg-dark .c-outline,.bg-image .c-outline,.bg-primary .c-outline{color:inherit;border-color:rgba(255,255,255,.25)}
.eka-card-body{padding:26px;flex:1;display:flex;flex-direction:column}.c-plain .eka-card-body{padding:0}
.eka-card-body h3{font-size:1.2rem;margin-bottom:.4em}.eka-card-body p{color:inherit;opacity:.82;margin-bottom:.8em}
.eka-card-icon{font-size:1.6rem;width:56px;height:56px;margin:26px 26px 0;border-radius:calc(var(--r) + 4px);display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--c-primary) 13%,transparent)}
.c-plain .eka-card-icon{margin:0 0 16px}.eka-card.t-center .eka-card-icon{margin-left:auto;margin-right:auto}
.eka-card-img img{width:100%;aspect-ratio:16/10;object-fit:cover}
.eka-card-link{margin-top:auto;font-weight:600;text-decoration:none}
.eka-price{border:1px solid color-mix(in srgb,var(--c-text) 14%,transparent);border-radius:var(--r);padding:32px;display:flex;flex-direction:column;background:var(--c-bg);color:var(--c-text)}
.eka-price.featured{border:2px solid var(--c-primary);box-shadow:0 18px 40px -18px color-mix(in srgb,var(--c-primary) 60%,transparent)}
.eka-price h3{font-size:1.1rem;color:var(--c-muted);font-weight:600}
.eka-price-amt{margin:.2em 0 1em}.eka-price-amt strong{font-size:2.6rem;font-family:var(--f-head)}.eka-price-amt span{color:var(--c-muted);margin-left:4px}
.eka-price .eka-list{margin-bottom:24px;flex:1}
.eka-quote{margin:0;padding:28px;border-radius:var(--r);background:var(--c-surface);color:var(--c-text)}
.bg-surface .eka-quote{background:var(--c-bg)}
.eka-quote blockquote{margin:0 0 18px;font-size:1.08rem}
.eka-stars{color:#f5a623;letter-spacing:2px;margin-bottom:10px}
.eka-quote figcaption{display:flex;align-items:center;gap:12px}.eka-quote small{display:block;color:var(--c-muted)}
.eka-avatar{width:48px;height:48px;border-radius:50%;object-fit:cover}
.eka-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:24px;text-align:center}
.eka-stats strong{display:block;font-family:var(--f-head);font-size:clamp(2rem,4vw,2.8rem);line-height:1.1;color:var(--c-primary)}
.bg-primary .eka-stats strong,.bg-dark .eka-stats strong,.bg-image .eka-stats strong{color:inherit}
.eka-stats span{opacity:.8}
.eka-faq details{border-bottom:1px solid color-mix(in srgb,currentColor 15%,transparent);padding:4px 0}
.eka-faq summary{cursor:pointer;font-weight:600;padding:14px 32px 14px 0;list-style:none;position:relative}
.eka-faq summary::-webkit-details-marker{display:none}
.eka-faq summary::after{content:"+";position:absolute;right:4px;top:10px;font-size:1.4rem;color:var(--c-primary);transition:transform .2s}
.eka-faq details[open] summary::after{transform:rotate(45deg)}
.eka-faq details p{padding-bottom:12px;opacity:.85}
.eka-gallery{display:grid;gap:12px}.g-2{grid-template-columns:repeat(2,1fr)}.g-3{grid-template-columns:repeat(3,1fr)}.g-4{grid-template-columns:repeat(4,1fr)}
@media (max-width:760px){.eka-gallery{grid-template-columns:repeat(2,1fr)}}
.eka-gallery img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--r)}
.eka-video{position:relative;aspect-ratio:16/9;border-radius:var(--r);overflow:hidden;background:#000}
.eka-video iframe,.eka-map iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.eka-map{position:relative;border-radius:var(--r);overflow:hidden;background:var(--c-surface)}
.eka-form{display:grid;gap:8px;text-align:left}
.eka-form label{font-weight:600;font-size:.92rem;margin-top:6px}
.eka-form input,.eka-form textarea{width:100%;font:inherit;padding:12px 14px;border-radius:var(--r);border:1px solid color-mix(in srgb,var(--c-text) 22%,transparent);background:var(--c-bg);color:var(--c-text)}
.eka-form input:focus,.eka-form textarea:focus{outline:2px solid var(--c-primary);outline-offset:1px;border-color:transparent}
.eka-form button{margin-top:12px;justify-self:start}
.eka-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.eka-form-ok{display:none;padding:16px 18px;border-radius:var(--r);background:color-mix(in srgb,#16a34a 14%,transparent);color:inherit;font-weight:600;margin-bottom:16px}
.eka-form-ok:target{display:block}
.eka-hr{border:0;border-top:1px solid color-mix(in srgb,currentColor 15%,transparent);margin:8px 0}
.eka-footer{background:var(--c-dark);color:var(--c-on-dark);padding:36px 0;font-size:.95rem}
.eka-footer-in{display:flex;flex-wrap:wrap;gap:16px 28px;align-items:center;justify-content:space-between}
.eka-footer p{margin:0;opacity:.8}.eka-footer-links{display:flex;flex-wrap:wrap;gap:20px}.eka-footer a{color:inherit;opacity:.85;text-decoration:none}.eka-footer a:hover{opacity:1}
.eka-hint{font-size:.85rem;opacity:.6;padding:8px;border:1px dashed currentColor;border-radius:6px}
@keyframes eka-pulse{50%{transform:scale(1.06)}}
@keyframes eka-wobble{20%{transform:rotate(-4deg)}40%{transform:rotate(3deg)}60%{transform:rotate(-2deg)}80%{transform:rotate(1deg)}}
@keyframes eka-shine{to{transform:translateX(100%)}}
@keyframes eka-fade{from{opacity:0}}
@keyframes eka-fade-up{from{opacity:0;transform:translateY(48px)}}
@keyframes eka-fade-down{from{opacity:0;transform:translateY(-48px)}}
@keyframes eka-fade-left{from{opacity:0;transform:translateX(-64px)}}
@keyframes eka-fade-right{from{opacity:0;transform:translateX(64px)}}
@keyframes eka-zoom{from{opacity:0;transform:scale(.85)}}
@keyframes eka-zoom-out{from{opacity:0;transform:scale(1.15)}}
@keyframes eka-flip{from{opacity:0;transform:perspective(900px) rotateX(45deg);transform-origin:50% 100%}}
@media (prefers-reduced-motion:no-preference){.an{animation:var(--an) var(--an-d,.8s) cubic-bezier(.2,.7,.2,1) var(--an-delay,0s) both}@supports (animation-timeline:view()){.an-scroll{animation-duration:auto;animation-delay:0s;animation-timeline:view();animation-range:entry var(--an-rs,0%) entry var(--an-re,70%)}}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}}`;

// Google Fonts URL for the site's fonts plus any picked for single elements
// on this page (so a font used once doesn't load on every page).
export function fontsHref(site, page) {
  const keys = new Set([site.theme.fonts.heading, site.theme.fonts.body]);
  const walk = (node) => {
    if (node.style?.fontFamily) keys.add(node.style.fontFamily);
    for (const c of node.columns || []) c.blocks.forEach(walk);
  };
  [site.header, site.footer, ...(page?.sections || [])].forEach(walk);
  const families = [...keys].map((k) => FONT_CHOICES[k]?.google).filter(Boolean);
  return families.length ? `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join("&")}&display=swap` : "";
}

function fontLinks(site, page) {
  const href = fontsHref(site, page);
  if (!href) return "";
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${href}">`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @param site normalized site
 * @param page one of site.pages
 * @param opts { base = "/", editor = false, formAction, canonical }
 */
export function renderBody(site, page, opts = {}) {
  const ctx = { site, page, base: opts.base || "/", editor: !!opts.editor, formAction: opts.formAction, eagerImages: 2, css: [] };
  const sections = page.sections.map((s, i) => { ctx.sectionIndex = i; return renderSection(s, ctx); }).join("");
  const header = renderHeader(site, ctx), footer = renderFooter(site, ctx);
  const nodeCss = ctx.css.length ? `<style id="eka-node-css">${ctx.css.join("\n")}</style>` : "";
  const empty = ctx.editor && !page.sections.length ? `<div class="eka-page-empty">This page is empty. Drag a section or block here, or ask the AI to build it.</div>` : "";
  return `${nodeCss}${header}<main id="main">${sections}${empty}</main>${footer}`;
}

export function renderCss(site) {
  return themeCss(site.theme) + "\n" + BASE_CSS + (site.customCss ? "\n/* custom */\n" + site.customCss.replace(/<\/style/gi, "<\\/style") : "");
}

export function renderPage(site, page, opts = {}) {
  const title = page.seo.title || (page.slug === "index" ? site.name : `${page.title} | ${site.name}`);
  const desc = page.seo.description;
  const canonical = opts.canonical ? `<link rel="canonical" href="${esc(opts.canonical)}">` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${desc ? `<meta name="description" content="${esc(desc)}">` : ""}<meta property="og:title" content="${esc(title)}">${desc ? `<meta property="og:description" content="${esc(desc)}">` : ""}${canonical}<meta name="theme-color" content="${esc(site.theme.colors.primary)}"><link rel="icon" href="data:,">${fontLinks(site, page)}<style>${renderCss(site)}</style></head><body>${renderBody(site, page, opts)}</body></html>`;
}

export { BLOCKS, LAYOUT_COLUMNS };
