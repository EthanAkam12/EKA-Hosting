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
      .map((b) => `<a class="eka-btn btn-${b.style}" ${attrHref(b.href, ctx)}>${esc(b.text)}</a>`)
      .join("")}</div>`;
  },

  image(p, ctx) {
    const ratio = p.ratio === "auto" ? "" : ` r-${p.ratio.replace(":", "-")}`;
    const inner = p.src ? img(p.src, p.alt, ctx, { sizes: "(max-width: 760px) 100vw, 50vw" }) : ctx.editor ? placeholderImage() : "";
    if (!inner) return "";
    const cap = p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : "";
    return `<figure class="eka-img${ratio}${p.rounded ? " rounded" : ""}">${inner}${cap}</figure>`;
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
    return `<div class="eka-gallery g-${p.columns}">${imgs.map((i) => img(i.src, i.alt, ctx, { sizes })).join("")}</div>`;
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
  return `<div class="eka-b eka-b-${block.type}"${editorAttrs(ctx, "block", block.id)}>${inner}</div>`;
}

export function renderSection(section, ctx) {
  const p = section.props;
  const cls = ["eka-s", `bg-${p.background}`, `pad-${p.padding}`, `w-${p.width}`, `t-${p.align}`, `va-${p.valign}`];
  if (p.minHeight) cls.push("tall");
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
  return `<section${id} class="${cls.join(" ")}"${style}${editorAttrs(ctx, "section", section.id)}><div class="eka-wrap"><div class="eka-cols l-${layout}">${cols}</div></div></section>`;
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
    ? `<img src="${esc(safeUrl(h.logoImage))}" alt="${esc(h.logoText || site.name)}" height="40" fetchpriority="high">`
    : `<span>${esc(h.logoText || site.name)}</span>`;
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
  return `<header class="eka-header${h.sticky ? " sticky" : ""}"${ctx.editor ? ' data-eka-kind="header" data-eka-id="header"' : ""}><div class="eka-wrap eka-header-in"><a class="eka-logo" ${attrHref("/", ctx)}>${logo}</a>${burger}<nav class="eka-nav" aria-label="Main">${nav}${cta}</nav></div></header>`;
}

function renderFooter(site, ctx) {
  const f = site.footer;
  const links = f.links.length ? `<nav class="eka-footer-links">${f.links.map((l) => `<a ${attrHref(l.href, ctx)}>${esc(l.text)}</a>`).join("")}</nav>` : "";
  return `<footer class="eka-footer"${ctx.editor ? ' data-eka-kind="footer" data-eka-id="footer"' : ""}><div class="eka-wrap eka-footer-in"><p>${esc(f.text)}</p>${links}</div></footer>`;
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

export function themeCss(theme) {
  const c = theme.colors;
  const heading = FONT_CHOICES[theme.fonts.heading] || FONT_CHOICES.system;
  const body = FONT_CHOICES[theme.fonts.body] || FONT_CHOICES.system;
  return `:root{--c-primary:${c.primary};--c-accent:${c.accent};--c-bg:${c.background};--c-surface:${c.surface};--c-text:${c.text};--c-muted:${c.muted};--c-dark:${c.dark};--c-on-primary:${contrastText(c.primary)};--c-on-dark:${contrastText(c.dark)};--f-head:${heading.stack};--f-body:${body.stack};--r:${theme.radius}px}`;
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
body{margin:0;font-family:var(--f-body);font-size:1.0625rem;line-height:1.65;color:var(--c-text);background:var(--c-bg);-webkit-font-smoothing:antialiased}
img{max-width:100%;height:auto;display:block}
a{color:var(--c-primary)}
h1,h2,h3,h4{font-family:var(--f-head);line-height:1.15;margin:0 0 .5em;letter-spacing:-.015em}
h1{font-size:clamp(2.2rem,5vw,3.75rem)}h2{font-size:clamp(1.75rem,3.5vw,2.6rem)}h3{font-size:1.35rem}h4{font-size:1.1rem}
p{margin:0 0 1em}
.eka-wrap{width:100%;max-width:var(--wrap,1140px);margin:0 auto;padding:0 20px}
.t-left{text-align:left}.t-center{text-align:center}.t-right{text-align:right}
.eka-header{background:var(--c-bg);border-bottom:1px solid color-mix(in srgb,var(--c-text) 10%,transparent);z-index:50;position:relative}
.eka-header.sticky{position:sticky;top:0}
.eka-header-in{display:flex;align-items:center;gap:20px;min-height:68px}
.eka-logo{display:flex;align-items:center;font-family:var(--f-head);font-weight:700;font-size:1.25rem;color:var(--c-text);text-decoration:none;margin-right:auto}
.eka-logo img{height:40px;width:auto}
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
.pad-none{padding:0}.pad-sm{padding:32px 0}.pad-md{padding:56px 0}.pad-lg{padding:88px 0}.pad-xl{padding:128px 0}
@media (max-width:760px){.pad-md{padding:44px 0}.pad-lg{padding:60px 0}.pad-xl{padding:84px 0}}
.w-narrow{--wrap:760px}.w-normal{--wrap:1140px}.w-wide{--wrap:1360px}.w-full{--wrap:none}.w-full>.eka-wrap{padding:0}
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
.eka-btn{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:10px 24px;border-radius:var(--r);font-weight:600;font-size:1rem;text-decoration:none;border:2px solid transparent;transition:transform .15s,filter .15s,background .15s;cursor:pointer;font-family:inherit;line-height:1.2}
.eka-btn:hover{transform:translateY(-1px);filter:brightness(1.08)}
.btn-primary{background:var(--c-primary);color:var(--c-on-primary)}
.btn-secondary{background:var(--c-accent);color:#111}
.btn-outline{border-color:currentColor;color:inherit;background:transparent}
.btn-light{background:#fff;color:#111}
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
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}`;

function fontLinks(theme) {
  const families = [...new Set([theme.fonts.heading, theme.fonts.body])]
    .map((k) => FONT_CHOICES[k]?.google)
    .filter(Boolean);
  if (!families.length) return "";
  const href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join("&")}&display=swap`;
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
  const ctx = { site, page, base: opts.base || "/", editor: !!opts.editor, formAction: opts.formAction, eagerImages: 2 };
  const sections = page.sections.map((s) => renderSection(s, ctx)).join("");
  const empty = ctx.editor && !page.sections.length ? `<div class="eka-page-empty">This page is empty. Drag a section or block here, or ask the AI to build it.</div>` : "";
  return `${renderHeader(site, ctx)}<main id="main">${sections}${empty}</main>${renderFooter(site, ctx)}`;
}

export function renderCss(site) {
  return themeCss(site.theme) + "\n" + BASE_CSS + (site.customCss ? "\n/* custom */\n" + site.customCss.replace(/<\/style/gi, "<\\/style") : "");
}

export function renderPage(site, page, opts = {}) {
  const title = page.seo.title || (page.slug === "index" ? site.name : `${page.title} | ${site.name}`);
  const desc = page.seo.description;
  const canonical = opts.canonical ? `<link rel="canonical" href="${esc(opts.canonical)}">` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${desc ? `<meta name="description" content="${esc(desc)}">` : ""}<meta property="og:title" content="${esc(title)}">${desc ? `<meta property="og:description" content="${esc(desc)}">` : ""}${canonical}<meta name="theme-color" content="${esc(site.theme.colors.primary)}"><link rel="icon" href="data:,">${fontLinks(site.theme)}<style>${renderCss(site)}</style></head><body>${renderBody(site, page, opts)}</body></html>`;
}

export { BLOCKS, LAYOUT_COLUMNS };
