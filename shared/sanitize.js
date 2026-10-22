// Small, dependency-free HTML sanitiser for rich-text blocks. Works the same
// in Node and the browser (no DOM needed). Only a short allowlist of inline
// formatting tags survives; everything else is reduced to its text.
// The "Custom code" block deliberately bypasses this — it is the escape hatch.

const ALLOWED = new Set(["p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li", "blockquote", "small", "mark", "span"]);
const VOID = new Set(["br"]);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|noscript|svg|math)\b[\s\S]*?<\/\1\s*>/gi;

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

// Returns a URL that is safe to put in href/src, or "" if it isn't.
export function safeUrl(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  // Remove characters browsers ignore inside schemes ("java\tscript:").
  const probe = raw.replace(/[\u0000- \u007f-\u009f]/g, "").toLowerCase();
  const scheme = probe.match(/^([a-z][a-z0-9+.-]*):/);
  if (scheme && !SAFE_SCHEMES.has(scheme[1] + ":")) return "";
  return raw;
}

function cleanAttrs(tag, attrString) {
  if (tag !== "a") return "";
  const href = attrString.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  const url = href ? safeUrl(decodeEntities(href[1] ?? href[2] ?? href[3] ?? "")) : "";
  if (!url) return "";
  const external = /^https?:/i.test(url);
  return ` href="${escapeHtml(url)}"` + (external && /\btarget\s*=\s*["']?_blank/i.test(attrString) ? ' target="_blank" rel="noopener"' : "");
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export function sanitizeRichText(html) {
  let input = String(html ?? "").replace(/<!--[\s\S]*?-->/g, "").replace(DROP_WITH_CONTENT, "");
  const tagRe = /<\s*(\/?)\s*([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let out = "";
  let last = 0;
  const open = [];
  let m;
  while ((m = tagRe.exec(input))) {
    out += input.slice(last, m.index).replace(/</g, "&lt;").replace(/>/g, "&gt;");
    last = tagRe.lastIndex;
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const normalized = tag === "b" ? "strong" : tag === "i" ? "em" : tag === "div" ? "p" : tag;
    if (!ALLOWED.has(normalized)) continue;
    if (VOID.has(normalized)) { if (!closing) out += "<br>"; continue; }
    if (closing) {
      const idx = open.lastIndexOf(normalized);
      if (idx === -1) continue;
      while (open.length > idx) out += `</${open.pop()}>`;
    } else {
      out += `<${normalized}${cleanAttrs(normalized, m[3])}>`;
      open.push(normalized);
    }
  }
  out += input.slice(last).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  while (open.length) out += `</${open.pop()}>`;
  return out;
}
