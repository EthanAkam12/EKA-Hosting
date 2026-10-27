// Reads a site (or page) design out of the AI's answer while it's still being
// written, so the wizard can show sections as they arrive instead of a
// spinner. Only complete pieces are returned: the theme and header once
// they're finished, and every finished section so far.

// Index just past the value that starts at `start` ({…} or […]), or -1 if
// it isn't complete yet. Strings are skipped so braces inside text don't count.
function endOf(text, start) {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i + 1;
  }
  return -1;
}

// The finished object after "key": …, or undefined.
function objectAfter(text, key) {
  const k = text.indexOf(`"${key}"`);
  if (k === -1) return undefined;
  const start = text.indexOf("{", k);
  if (start === -1 || text.slice(k + key.length + 2, start).trim() !== ":") return undefined;
  const end = endOf(text, start);
  if (end === -1) return undefined;
  try { return JSON.parse(text.slice(start, end)); } catch { return undefined; }
}

// Every finished element of the first "sections": [ … ] array.
function sectionsSoFar(text) {
  const k = text.indexOf('"sections"');
  if (k === -1) return [];
  let i = text.indexOf("[", k);
  if (i === -1) return [];
  i++;
  const out = [];
  for (;;) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (text[i] !== "{") break;
    const end = endOf(text, i);
    if (end === -1) break;
    try { out.push(JSON.parse(text.slice(i, end))); } catch { break; }
    i = end;
  }
  return out;
}

/** What's ready of a design so far: { theme?, header?, footer?, business?, sections[] }. */
export function partialDesign(text) {
  const t = String(text || "");
  return {
    theme: objectAfter(t, "theme"),
    header: objectAfter(t, "header"),
    footer: objectAfter(t, "footer"),
    sections: sectionsSoFar(t),
  };
}
