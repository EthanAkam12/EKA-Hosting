// New-site wizard: 1) the brief, 2) pick a homepage design (generate another,
// or ask for changes), 3) confirm and build the full site.

import { h, api, waitForJob, toast } from "./ui.js";
import { renderPage } from "/admin/shared/render.js";

const STYLES = ["Let the AI decide", "Modern", "Classic", "Bold", "Minimal", "Warm & friendly", "Luxury", "Playful"];
const PAGE_CHOICES = ["About", "Services", "Gallery", "Pricing", "FAQ", "Contact"];
const EXAMPLES = [
  "A family-run Italian restaurant in Manchester. Wood-fired pizza, fresh pasta, takeaway and private dining. Warm, rustic feel.",
  "Personal trainer in Bristol offering 1-to-1 sessions, small group bootcamps and online coaching. Free first consultation.",
  "Local plumbing and heating company in Leeds. Boiler installs and repairs, 24/7 emergency call-outs, Gas Safe registered.",
];
const SAVE_KEY = "eka-new-site";

const app = document.getElementById("app");
let me = { ai: { enabled: false } };

// Everything the wizard knows. Saved in the tab so a refresh doesn't lose work.
let state = load() || {
  step: 1,
  brief: { name: "", description: "", phone: "", email: "", address: "", hours: "", socials: "", logoUrl: "", colors: null, style: STYLES[0], pages: ["About", "Contact"] },
  concepts: [], // [{ site, layout, requests: [], history: [] }]
  current: 0,
};
let busy = null; // text while waiting on the AI
let device = "desktop";

function load() {
  try { return JSON.parse(sessionStorage.getItem(SAVE_KEY)); } catch { return null; }
}
function save() {
  try { sessionStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* storage full or blocked: carry on */ }
}

function setStep(n) {
  state.step = n;
  save();
  render();
}

function render() {
  document.querySelectorAll("[data-step]").forEach((el) => el.classList.toggle("on", Number(el.dataset.step) === state.step));
  app.replaceChildren(state.step === 1 ? renderBrief() : renderDesign());
}

// ------------------------------------------------------------------ step 1 --

function renderBrief() {
  const b = state.brief;
  const bind = (key, el) => { el.addEventListener("input", () => { b[key] = el.value; save(); }); return el; };
  const input = (key, attrs = {}) => bind(key, h("input", { class: "input", value: b[key] || "", ...attrs }));
  const area = (key, rows, attrs = {}) => bind(key, h("textarea", { class: "textarea", rows: String(rows), ...attrs }, b[key] || ""));
  const field = (label, control, hint) => h("div", { class: "field" }, h("label", {}, label), control, hint ? h("div", { class: "field-hint" }, hint) : null);
  const err = h("p", { class: "small", style: { color: "var(--danger)", margin: 0 } });

  // Logo
  const logoPrev = h("div", { class: "logo-prev" });
  const paintLogo = () => {
    logoPrev.style.backgroundImage = b.logoUrl ? `url("${b.logoUrl}")` : "";
    logoPrev.textContent = b.logoUrl ? "" : "No logo";
    removeLogo.hidden = !b.logoUrl;
  };
  const fileInput = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: true, onchange: async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    logoPrev.textContent = "Uploading…";
    try {
      const { url } = await api("/wizard/media", { method: "POST", raw: true, body: file, headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(file.name) } });
      b.logoUrl = url; save();
    } catch (ex) { toast(ex.message, { error: true }); }
    paintLogo();
  } });
  const removeLogo = h("button", { class: "btn btn-sm btn-ghost", type: "button", onclick: () => { b.logoUrl = ""; save(); paintLogo(); } }, "Remove");
  paintLogo();

  // Colours
  const useColors = h("input", { type: "checkbox", checked: !!b.colors });
  const primary = h("input", { type: "color", value: b.colors?.primary || "#2563eb" });
  const accent = h("input", { type: "color", value: b.colors?.accent || "#f59e0b" });
  const colorRow = h("div", { class: "colors", hidden: !b.colors },
    h("label", {}, primary, "Main colour"),
    h("label", {}, accent, "Accent colour"));
  const syncColors = () => { b.colors = useColors.checked ? { primary: primary.value, accent: accent.value } : null; colorRow.hidden = !useColors.checked; save(); };
  [useColors, primary, accent].forEach((el) => el.addEventListener("input", syncColors));

  // Style + pages
  const styleChips = h("div", { class: "chips" }, STYLES.map((st) => h("span", {
    class: `chip${b.style === st ? " on" : ""}`, role: "button", tabindex: "0",
    onclick: (e) => { b.style = st; save(); e.currentTarget.parentNode.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c.textContent === st)); },
  }, st)));
  const pageChips = h("div", { class: "chips" });
  const paintPages = () => pageChips.replaceChildren(
    h("span", { class: "chip on fixed", title: "Every site has a home page" }, "Home"),
    ...[...new Set([...PAGE_CHOICES, ...b.pages])].map((p) => h("span", {
      class: `chip${b.pages.includes(p) ? " on" : ""}`, role: "button", tabindex: "0",
      onclick: () => { b.pages = b.pages.includes(p) ? b.pages.filter((x) => x !== p) : [...b.pages, p]; save(); paintPages(); },
    }, p)),
    h("input", { class: "input", placeholder: "+ Another page", style: { width: "150px", minHeight: "30px", padding: "4px 10px", borderRadius: "99px" }, onkeydown: (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const v = e.target.value.trim();
      if (v && !b.pages.includes(v)) { b.pages = [...b.pages, v]; save(); paintPages(); }
    } }),
  );
  paintPages();

  const go = h("button", { class: "btn btn-primary", onclick: async () => {
    err.textContent = "";
    if (!b.name.trim() && !b.description.trim()) { err.textContent = "Add the business name or a description first."; return; }
    state.concepts = [];
    state.current = 0;
    setStep(2);
    await newConcept();
  } }, "Show me a design →");

  return h("div", { class: "brief" },
    h("h2", {}, "Tell us about the business"),
    h("p", { class: "muted", style: { margin: 0 } }, me.ai.enabled
      ? "The AI designs a homepage from this. You can ask for another design or changes before building the full site."
      : "AI isn't set up, so designs come from built-in templates using these details. Add your API key in settings.txt for AI-written designs."),

    h("div", { class: "card" },
      h("h3", {}, "The business"),
      field("Business name", input("name", { placeholder: "e.g. Smith Antiques", maxlength: "120" })),
      field("What do they do?", area("description", 5, { placeholder: "What they sell or offer, where, who for, what makes them different, prices, the feel they want…" }),
        h("span", {}, "Try an example: ", EXAMPLES.map((ex) => h("a", { href: "#", style: { marginRight: "10px" }, onclick: (e) => { e.preventDefault(); b.description = ex; save(); render(); } }, ex.split(/[.,]/)[0])))),
      h("div", { class: "field" }, h("label", {}, "Logo"),
        h("div", { class: "logo-box" }, logoPrev, h("div", {},
          h("button", { class: "btn btn-sm", type: "button", onclick: () => fileInput.click() }, b.logoUrl ? "Change logo" : "Upload logo"), " ", removeLogo, fileInput,
          h("div", { class: "field-hint" }, me.ai.enabled ? "The AI will pick colours that go with it." : "Shown in the site's header.")))),
    ),

    h("div", { class: "card" },
      h("h3", {}, "Contact details"),
      h("div", { class: "grid2" },
        field("Phone", input("phone", { type: "tel", placeholder: "01234 567890" })),
        field("Email", input("email", { type: "email", placeholder: "hello@business.co.uk" }), "Contact form messages go here too."),
      ),
      field("Address", input("address", { placeholder: "12 High Street, York, YO1 2AB" })),
      h("div", { class: "grid2" },
        field("Opening hours", area("hours", 3, { placeholder: "Mon–Fri 9am–5pm\nSat 10am–4pm" })),
        field("Social media links", area("socials", 3, { placeholder: "facebook.com/…\ninstagram.com/…" })),
      ),
    ),

    h("div", { class: "card" },
      h("h3", {}, "Look and feel"),
      h("div", { class: "field" }, h("label", { class: "check" }, useColors, "Use our brand colours"), colorRow,
        h("div", { class: "field-hint" }, "Leave unticked to let the design choose.")),
      h("div", { class: "field" }, h("label", {}, "Style"), styleChips),
      h("div", { class: "field" }, h("label", {}, "Pages"), pageChips, h("div", { class: "field-hint" }, "Type a page name and press Enter to add your own.")),
    ),

    h("div", { class: "actions" }, go,
      h("a", { href: "#", onclick: async (e) => {
        e.preventDefault();
        const { site } = await api("/sites", { method: "POST", body: { name: b.name || "New site", blank: true } });
        clearAndGo(`/admin/sites/${site.id}`);
      } }, "Or start with a blank page"),
      err),
  );
}

// ------------------------------------------------------------------ step 2 --

function currentConcept() {
  return state.concepts[state.current];
}

async function runJob(label, start) {
  busy = label;
  render();
  try {
    const { jobId } = await start();
    return await waitForJob(jobId, (job) => {
      const el = document.getElementById("busy-text");
      if (el) el.textContent = `${label} ${Math.round(job.elapsedMs / 1000)}s`;
    });
  } finally {
    busy = null;
  }
}

async function newConcept() {
  try {
    const previous = state.concepts.map((c) => c.layout);
    const label = state.concepts.length ? "Designing another option…" : "Designing the homepage…";
    const result = await runJob(label, () => api("/wizard/concept", { method: "POST", body: { brief: state.brief, previous } }));
    state.concepts.push({ site: result.site, layout: result.layout, requests: [], history: [] });
    state.current = state.concepts.length - 1;
    save();
  } catch (err) {
    toast(err.message, { error: true });
    if (!state.concepts.length) state.step = 1;
  }
  render();
}

async function refine(instruction) {
  const c = currentConcept();
  try {
    const result = await runJob("Making your change…", () => api("/wizard/refine", { method: "POST", body: { concept: c.site, instruction } }));
    if (result.changed) {
      c.history.push(c.site);
      c.site = result.site;
      c.layout = result.layout;
    }
    c.requests.push(instruction);
    save();
    toast(result.summary || "Done.");
  } catch (err) {
    toast(err.message, { error: true });
  }
  render();
}

async function confirm() {
  const c = currentConcept();
  try {
    busy = "Building the full site…";
    render();
    const { site } = await api("/sites", { method: "POST", body: { brief: state.brief, concept: c.site, requests: c.requests } });
    clearAndGo(`/admin/sites/${site.id}`);
  } catch (err) {
    busy = null;
    toast(err.message, { error: true });
    render();
  }
}

function clearAndGo(url) {
  try { sessionStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  location.href = url;
}

function renderDesign() {
  const c = currentConcept();
  const refineBox = h("textarea", { class: "textarea", rows: "3", placeholder: "e.g. make the header darker, use a photo-style hero, add a page called Gallery", disabled: !!busy || !me.ai.enabled });

  const side = h("aside", { class: "side" },
    h("h2", { style: { fontSize: "18px" } }, "Pick a design"),
    h("p", { class: "small muted", style: { margin: "4px 0 0" } }, "This is a preview of the homepage. Your other pages are built in the same style when you confirm."),
    state.concepts.length > 1 ? h("div", { class: "options" }, state.concepts.map((_, i) => h("button", {
      class: `opt${i === state.current ? " on" : ""}`, disabled: !!busy,
      onclick: () => { state.current = i; save(); render(); },
    }, `Design ${i + 1}`))) : h("div", { style: { height: "14px" } }),

    h("button", { class: "btn btn-primary big", disabled: !!busy || !c, onclick: confirm }, "✓ Use this design"),
    h("button", { class: "btn big", style: { marginTop: "10px" }, disabled: !!busy, onclick: newConcept }, "↻ Generate another"),

    h("hr", { class: "sep" }),
    h("div", { class: "field" },
      h("label", {}, "Want something changed?"),
      refineBox,
      me.ai.enabled ? null : h("div", { class: "field-hint" }, "Written changes need AI (add your API key in settings.txt). You can still change anything by hand after you confirm."),
    ),
    h("div", { class: "row" },
      h("button", { class: "btn", disabled: !!busy || !me.ai.enabled, onclick: () => { const v = refineBox.value.trim(); if (v) refine(v); } }, "Apply change"),
      c?.history.length ? h("button", { class: "btn btn-ghost", disabled: !!busy, onclick: () => { c.site = c.history.pop(); c.requests.pop(); save(); render(); } }, "↶ Undo") : null,
    ),
    c?.requests.length ? h("ul", { class: "changes" }, c.requests.map((r) => h("li", {}, r))) : null,

    h("hr", { class: "sep" }),
    h("a", { href: "#", class: "small", onclick: (e) => { e.preventDefault(); if (!busy) setStep(1); } }, "← Edit the brief"),
  );
  refineBox.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { const v = refineBox.value.trim(); if (v) refine(v); } });

  const frame = h("div", { class: `frame${device === "mobile" ? " mobile" : ""}` });
  const inner = h("div", { class: "frame-in" });
  const iframe = h("iframe", { title: "Design preview", sandbox: "allow-same-origin" });
  inner.append(iframe);
  frame.append(inner);
  if (busy || !c) frame.append(h("div", { class: "busy" }, h("div", {}, h("div", { class: "spinner" }), h("div", { id: "busy-text", style: { fontWeight: 600 } }, busy || "Loading…"), h("div", { class: "small muted", style: { marginTop: "6px" } }, me.ai.enabled ? "This usually takes under a minute." : ""))));

  const stage = h("main", { class: "stage" },
    h("div", { class: "stage-bar" },
      h("span", { class: "small muted" }, c ? `Design ${state.current + 1}${c.requests.length ? ` · ${c.requests.length} change${c.requests.length > 1 ? "s" : ""}` : ""}` : ""),
      h("span", { class: "grow" }),
      h("button", { class: `icon-btn${device === "desktop" ? " active" : ""}`, title: "Desktop", onclick: () => { device = "desktop"; render(); } }, "🖥"),
      h("button", { class: `icon-btn${device === "mobile" ? " active" : ""}`, title: "Mobile", onclick: () => { device = "mobile"; render(); } }, "📱"),
    ),
    frame,
  );

  const wrap = h("div", { class: "design" }, side, stage);

  // Show the homepage at its real width, scaled to fit, as in the editor.
  requestAnimationFrame(() => {
    const logical = device === "mobile" ? 390 : 1280;
    const scale = Math.min(1, frame.clientWidth / logical);
    inner.style.width = `${logical}px`;
    inner.style.height = `${frame.clientHeight / scale}px`;
    inner.style.transform = scale < 1 ? `scale(${scale})` : "";
    if (c) {
      // Links in the preview don't go anywhere.
      iframe.srcdoc = renderPage(c.site, c.site.pages[0], { base: "/" }).replace("</head>", "<style>a,button{pointer-events:none}</style></head>");
    }
  });
  return wrap;
}

window.addEventListener("resize", () => { if (state.step === 2) render(); });

// ------------------------------------------------------------------- start --

api("/me").then((m) => { me = m; }).catch(() => {}).finally(() => {
  // A refresh in the middle of generating: show what we have.
  if (state.step === 2 && !state.concepts.length) state.step = 1;
  render();
});
