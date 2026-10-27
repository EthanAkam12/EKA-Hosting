// New-site wizard: 1) the brief, 2) a short description of each page,
// 3) pick a homepage design (generate another, or ask for changes, page by
// page), then confirm to build the full site.

import { h, api, waitForJob, toast, demoBanner } from "./ui.js";
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
  version: 3,
  step: 1,
  brief: { name: "", description: "", phone: "", email: "", address: "", hours: "", socials: "", logoUrl: "", colors: null, style: STYLES[0], pages: ["About", "Contact"], pageInfo: {} },
  concepts: [], // [{ site, layout, requests: [], history: [] }]
  current: 0,
  notes: {}, // change requests per page: { "Whole site": "", "Home": "", "About": "" }
};
state.notes ||= {};
// Tags this wizard run's AI calls so their cost is credited to the site it becomes.
state.wizardId ||= Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => x.toString(16).padStart(2, "0")).join("");
const wapi = (path, opts = {}) => api(path, { ...opts, headers: { ...opts.headers, "X-EKA-Wizard": state.wizardId } });
state.brief.pageInfo ||= {};
let busy = null; // text while waiting on the AI
const openBoxes = new Set(["Home"]); // which page change boxes are expanded
let device = "desktop";

function load() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SAVE_KEY));
    return saved?.version === 3 ? saved : null; // older wizard layout: start again
  } catch { return null; }
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
  app.replaceChildren(state.step === 1 ? renderBrief() : state.step === 2 ? renderPages() : state.step === 3 ? renderDesign() : renderPageDesign());
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

  const go = h("button", { class: "btn btn-primary", onclick: () => {
    err.textContent = "";
    if (!b.name.trim() && !b.description.trim()) { err.textContent = "Add the business name or a description first."; return; }
    setStep(2);
    window.scrollTo(0, 0);
  } }, "Next: describe the pages →");

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
      h("div", { class: "field" }, h("label", {}, "Logo (optional)"),
        h("div", { class: "logo-box" }, logoPrev, h("div", {},
          h("button", { class: "btn btn-sm", type: "button", onclick: () => fileInput.click() }, b.logoUrl ? "Change logo" : "Upload logo"), " ", removeLogo, fileInput,
          h("div", { class: "field-hint" }, me.ai.enabled ? "The AI will pick colours that go with it." : "Shown in the site's header.")))),
    ),

    h("div", { class: "card" },
      h("h3", {}, "Contact details"),
      h("p", { class: "field-hint", style: { margin: "-6px 0 12px" } }, "All optional. Leave out anything they don't have or don't want shown; you can add it later in the editor."),
      h("div", { class: "grid2" },
        field("Phone (optional)", input("phone", { type: "tel", placeholder: "01234 567890" })),
        field("Email (optional)", input("email", { type: "email", placeholder: "hello@business.co.uk" }), "Contact form messages go here too."),
      ),
      field("Address (optional)", input("address", { placeholder: "12 High Street, York, YO1 2AB" })),
      h("div", { class: "grid2" },
        field("Opening hours (optional)", area("hours", 3, { placeholder: "Mon–Fri 9am–5pm\nSat 10am–4pm" })),
        field("Social media links (optional)", area("socials", 3, { placeholder: "facebook.com/…\ninstagram.com/…" })),
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

const PAGE_HINTS = {
  home: "The first thing visitors see: what you want to get across, the main offer, any special deals…",
  about: "Who runs the business, how it started, what makes it different, the team…",
  services: "Each service or product range, with prices if you want them shown…",
  gallery: "What the photos will show: finished work, the shop, products…",
  pricing: "Packages or prices to list…",
  faq: "Questions customers often ask, and the answers…",
  contact: "How people should get in touch, delivery/collection, areas covered…",
  shop: "What's for sale, how buying works…",
};

function renderPages() {
  const b = state.brief;
  const pages = ["Home", ...b.pages.filter((p) => p.toLowerCase() !== "home")];
  const card = (title) => {
    const box = h("textarea", { class: "textarea", rows: "3", placeholder: PAGE_HINTS[title.toLowerCase()] || `What should the ${title} page say or show?` }, b.pageInfo[title] || "");
    box.addEventListener("input", () => { b.pageInfo[title] = box.value; save(); });
    return h("div", { class: "card page-card" },
      h("div", { class: "row" },
        h("h3", { class: "grow", style: { margin: 0 } }, title === "Home" ? "Home page" : `${title} page`),
        title === "Home" ? null : h("button", { class: "btn btn-sm btn-ghost", type: "button", onclick: () => {
          b.pages = b.pages.filter((p) => p !== title); delete b.pageInfo[title]; save(); render();
        } }, "Remove")),
      box);
  };
  const addPage = h("input", { class: "input", placeholder: "+ Add another page (type a name, press Enter)", onkeydown: (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const v = e.target.value.trim().slice(0, 40);
    if (v && !pages.some((p) => p.toLowerCase() === v.toLowerCase())) { b.pages = [...b.pages, v]; save(); render(); document.querySelector(".page-card:last-of-type textarea")?.focus(); }
  } });

  return h("div", { class: "brief" },
    h("h2", {}, "What goes on each page?"),
    h("p", { class: "muted", style: { margin: 0 } }, "A sentence or two per page is plenty. All optional: leave a page blank and it's written from the business description."),
    pages.map(card),
    h("div", { class: "card" }, addPage),
    h("div", { class: "actions" },
      h("button", { class: "btn", onclick: () => setStep(1) }, "← Back"),
      h("button", { class: "btn btn-primary", onclick: async () => {
        state.concepts = [];
        state.current = 0;
        setStep(3);
        await newConcept();
      } }, "Show me a design →")),
  );
}

// ------------------------------------------------------------------ step 3 --

function currentConcept() {
  return state.concepts[state.current];
}

// While the AI writes a design, the server sends what's finished so far; it's
// shown in the preview straight away. `kind`: "site" (homepage) or "page".
let liveKind = null, liveCount = 0;
function showLive(preview) {
  const iframe = document.getElementById("preview-frame");
  if (!iframe || !preview) return;
  let html;
  if (liveKind === "page") {
    const home = currentConcept().site;
    html = renderPage({ ...home, pages: [home.pages[0], preview] }, preview, { base: "/" });
  } else html = renderPage(preview, preview.pages[0], { base: "/" });
  iframe.srcdoc = html.replace("</head>", "<style>a,button{pointer-events:none}</style></head>");
  liveCount = (liveKind === "page" ? preview : preview.pages[0]).sections.length;
  document.getElementById("busy")?.classList.add("live");
}

async function runJob(label, start, kind = null) {
  busy = label;
  liveKind = kind;
  liveCount = 0;
  render();
  try {
    const { jobId } = await start();
    return await waitForJob(jobId, (job) => {
      if (job.progress.preview) showLive(job.progress.preview);
      const el = document.getElementById("busy-text");
      if (el) el.textContent = `${label} ${liveCount ? `${liveCount} section${liveCount > 1 ? "s" : ""} so far · ` : ""}${Math.round(job.elapsedMs / 1000)}s`;
    });
  } finally {
    busy = null;
  }
}

async function newConcept() {
  try {
    const previous = state.concepts.map((c) => c.layout);
    const label = state.concepts.length ? "Designing another option…" : "Designing the homepage…";
    const result = await runJob(label, () => wapi("/wizard/concept", { method: "POST", body: { brief: state.brief, previous } }), "site");
    state.concepts.push({ site: result.site, layout: result.layout, requests: [], history: [] });
    state.current = state.concepts.length - 1;
    save();
  } catch (err) {
    toast(err.message, { error: true });
    if (!state.concepts.length) state.step = 2;
  }
  render();
}

// Applies a written change to the homepage preview. `key` is the change box
// it came from, which is emptied once the change is made.
async function refine(instruction, key) {
  const c = currentConcept();
  try {
    const result = await runJob("Making your change…", () => wapi("/wizard/refine", { method: "POST", body: { concept: c.site, instruction } }));
    if (result.changed) {
      c.history.push(c.site);
      c.site = result.site;
      c.layout = result.layout;
    }
    c.requests.push(instruction);
    if (key) state.notes[key] = "";
    save();
    toast(result.summary || "Done.");
    return true;
  } catch (err) {
    toast(err.message, { error: true });
    return false;
  } finally {
    render();
  }
}

// Pages other than Home, in menu order (Contact last).
function otherPages() {
  const list = state.brief.pages.filter((p) => p.toLowerCase() !== "home");
  return list.sort((a, b) => (a.toLowerCase() === "contact") - (b.toLowerCase() === "contact"));
}

async function useHomeDesign() {
  // With AI, changes typed for the whole site or the homepage are made first,
  // so the other pages are designed from the final homepage.
  if (me.ai.enabled) {
    for (const key of ["Whole site", "Home"]) {
      const text = (state.notes[key] || "").trim();
      if (text && !(await refine(text, key))) return;
    }
  }
  if (!otherPages().length) return buildSite();
  state.pw = { i: 0, d: {} };
  setStep(4); // the page step starts designing the first page itself
}

async function buildSite() {
  const c = currentConcept();
  const pageNotes = Object.fromEntries(Object.entries(state.notes).filter(([, v]) => v && v.trim()));
  // Pages picked in step 4 are used as they are; the rest are built automatically.
  const pages = otherPages().map((t) => state.pw?.d[t]).filter((d) => d?.chosen).map((d) => d.options[d.current].page);
  try {
    busy = "Building the full site…";
    render();
    const { site } = await wapi("/sites", { method: "POST", body: { brief: state.brief, concept: c.site, requests: c.requests, pageNotes, pages } });
    clearAndGo(`/admin/sites/${site.id}`);
  } catch (err) {
    busy = null;
    toast(err.message, { error: true });
    render();
  }
}

// ------------------------------------------------------------------ step 4 --

function pageWork(title = otherPages()[state.pw.i]) {
  return (state.pw.d[title] ||= { options: [], current: 0, requests: [], history: [], chosen: false });
}

async function newPageDesign() {
  const title = otherPages()[state.pw.i];
  if (!title || busy) return;
  const d = pageWork(title);
  try {
    const result = await runJob(d.options.length ? `Designing another ${title} page…` : `Designing the ${title} page…`, () => wapi("/wizard/page", { method: "POST", body: {
      brief: state.brief, concept: currentConcept().site, title,
      previous: d.options.map((o) => o.layout),
      // So stock photos already used on other pages aren't repeated.
      otherPages: Object.entries(state.pw.d).filter(([t]) => t !== title).map(([, x]) => x.options[x.current]?.page).filter(Boolean),
      wishes: me.ai.enabled ? (state.notes[title] || "") : "",
    } }), "page");
    d.options.push({ page: result.page, layout: result.layout });
    d.current = d.options.length - 1;
    d.failed = false;
    save();
  } catch (err) {
    d.failed = true;
    toast(err.message, { error: true });
  }
  render();
}

async function refinePage(instruction) {
  const title = otherPages()[state.pw.i];
  const d = pageWork(title);
  const opt = d.options[d.current];
  const home = currentConcept().site;
  try {
    const result = await runJob("Making your change…", () => wapi("/wizard/refine", { method: "POST", body: { concept: { ...home, pages: [home.pages[0], opt.page] }, instruction, pageSlug: opt.page.slug } }));
    const page = result.site.pages.find((p) => p.slug === opt.page.slug);
    if (result.changed && page) {
      d.history.push(structuredClone(opt));
      d.options[d.current] = { page, layout: result.layout };
    }
    d.requests.push(instruction);
    state.notes[title] = "";
    save();
    toast(result.summary || "Done.");
  } catch (err) {
    toast(err.message, { error: true });
  }
  render();
}

async function choosePage() {
  pageWork().chosen = true;
  const titles = otherPages();
  const next = titles.findIndex((t) => !state.pw.d[t]?.chosen);
  if (next === -1) return buildSite();
  state.pw.i = next;
  save();
  render();
}

function renderPageDesign() {
  const titles = otherPages();
  if (state.pw.i >= titles.length) state.pw.i = 0;
  const title = titles[state.pw.i];
  const d = pageWork(title);
  const opt = d.options[d.current];
  const ai = me.ai.enabled;
  if (!opt && !busy && !d.failed) queueMicrotask(newPageDesign);

  const box = h("textarea", { class: "textarea", rows: "3", disabled: !!busy, placeholder: ai ? `e.g. put the photos first, add opening hours, make it shorter` : "Write what you'd change; it's saved with the site as a to-do" }, state.notes[title] || "");
  box.addEventListener("input", () => { state.notes[title] = box.value; save(); });
  const applyChange = () => { const v = box.value.trim(); if (v) refinePage(v); };
  if (ai) box.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) applyChange(); });

  const side = h("aside", { class: "side" },
    h("h2", { style: { fontSize: "18px" } }, "Design each page"),
    h("p", { class: "small muted", style: { margin: "4px 0 10px" } }, "Pick a design for each page, like you did for the homepage."),
    h("div", { class: "page-steps" }, titles.map((t, i) => h("button", {
      class: `page-step${i === state.pw.i ? " on" : ""}${state.pw.d[t]?.chosen ? " done" : ""}`, disabled: !!busy,
      onclick: () => { state.pw.i = i; save(); render(); },
    }, state.pw.d[t]?.chosen ? `✓ ${t}` : t))),
    d.options.length > 1 ? h("div", { class: "options" }, d.options.map((_, i) => h("button", {
      class: `opt${i === d.current ? " on" : ""}`, disabled: !!busy, onclick: () => { d.current = i; save(); render(); },
    }, `Design ${i + 1}`))) : h("div", { style: { height: "12px" } }),
    h("button", { class: "btn btn-primary big", disabled: !!busy || !opt, onclick: choosePage }, d.chosen ? `✓ Keep this ${title} design` : `✓ Use this ${title} design`),
    h("button", { class: "btn big", style: { marginTop: "10px" }, disabled: !!busy, onclick: newPageDesign }, "↻ Generate another"),
    h("hr", { class: "sep" }),
    h("label", { style: { fontWeight: 600, display: "block", marginBottom: "6px" } }, `Change the ${title} page`),
    box,
    h("div", { class: "row", style: { marginTop: "6px" } },
      ai ? h("button", { class: "btn btn-sm", disabled: !!busy || !opt, onclick: applyChange }, "Apply to preview") : h("span", { class: "small muted" }, "Without an AI key, this becomes a to-do in the editor."),
      d.history.length ? h("button", { class: "btn btn-sm btn-ghost", disabled: !!busy, onclick: () => { d.options[d.current] = d.history.pop(); d.requests.pop(); save(); render(); } }, "↶ Undo") : null),
    d.requests.length ? h("ul", { class: "changes" }, d.requests.map((r) => h("li", {}, r))) : null,
    h("hr", { class: "sep" }),
    h("button", { class: "btn", disabled: !!busy, onclick: buildSite }, "Build the site now"),
    h("p", { class: "field-hint" }, "Pages you haven't picked a design for are designed automatically."),
    h("a", { href: "#", class: "small", onclick: (e) => { e.preventDefault(); if (!busy) setStep(3); } }, "← Back to the homepage"),
  );

  const home = currentConcept().site;
  const site = opt ? { ...home, pages: [home.pages[0], opt.page] } : null;
  return h("div", { class: "design" }, side, previewStage(opt ? `${title} · design ${d.current + 1}` : "", site, site?.pages[1]));
}

function clearAndGo(url) {
  try { sessionStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  location.href = url;
}

function renderDesign() {
  const c = currentConcept();
  const ai = me.ai.enabled;
  const pages = ["Whole site", "Home", ...state.brief.pages.filter((p) => p.toLowerCase() !== "home")];
  const hints = {
    "Whole site": ai ? "Colours, fonts, header, buttons… Applies to every page." : "Colours, fonts, header, buttons…",
    Home: ai ? "Changes to the homepage you're looking at." : "Changes to the homepage you're looking at.",
  };
  const placeholders = {
    "Whole site": "e.g. darker header, rounder buttons, use a serif font",
    Home: "e.g. use a photo-style hero, add a section about our history",
  };

  const changeBox = (key) => {
    const live = ai && (key === "Whole site" || key === "Home");
    const box = h("textarea", { class: "textarea", rows: "2", placeholder: placeholders[key] || `What should the ${key} page have? e.g. our story, opening hours, a photo of the shop`, disabled: !!busy }, state.notes[key] || "");
    const mark = h("span", { class: "dot", hidden: !(state.notes[key] || "").trim() });
    box.addEventListener("input", () => { state.notes[key] = box.value; mark.hidden = !box.value.trim(); save(); });
    const apply = () => { const v = box.value.trim(); if (v) refine(v, key); };
    if (live) box.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) apply(); });
    const removable = !["Whole site", "Home"].includes(key);
    return h("details", { class: "page-box", open: openBoxes.has(key), ontoggle: (e) => { e.target.open ? openBoxes.add(key) : openBoxes.delete(key); } },
      h("summary", {}, h("span", { class: "grow" }, key === "Whole site" ? "Whole site" : `${key} page`), mark),
      box,
      h("div", { class: "row", style: { marginTop: "6px" } },
        live ? h("button", { class: "btn btn-sm", disabled: !!busy, onclick: apply }, "Apply to preview") : h("span", { class: "small muted grow" }, hints[key] || (ai ? "Used when this page is built." : "Saved with the site.")),
        live ? h("span", { class: "small muted grow" }, hints[key]) : null,
        removable ? h("button", { class: "btn btn-sm btn-ghost", title: "Don't make this page", disabled: !!busy, onclick: () => {
          state.brief.pages = state.brief.pages.filter((p) => p !== key); delete state.notes[key]; save(); render();
        } }, "Remove page") : null,
      ),
    );
  };
  const addPage = h("input", { class: "input", placeholder: "+ Add a page (press Enter)", disabled: !!busy, onkeydown: (e) => {
    if (e.key !== "Enter") return;
    const v = e.target.value.trim().slice(0, 40);
    if (v && !pages.some((p) => p.toLowerCase() === v.toLowerCase())) { state.brief.pages = [...state.brief.pages, v]; openBoxes.add(v); save(); render(); }
  } });

  const side = h("aside", { class: "side" },
    h("h2", { style: { fontSize: "18px" } }, "Pick a design"),
    h("p", { class: "small muted", style: { margin: "4px 0 0" } }, "This is a preview of the homepage. Your other pages are built in the same style when you confirm."),
    state.concepts.length > 1 ? h("div", { class: "options" }, state.concepts.map((_, i) => h("button", {
      class: `opt${i === state.current ? " on" : ""}`, disabled: !!busy,
      onclick: () => { state.current = i; save(); render(); },
    }, `Design ${i + 1}`))) : h("div", { style: { height: "14px" } }),

    h("button", { class: "btn btn-primary big", disabled: !!busy || !c, onclick: useHomeDesign }, otherPages().length ? "✓ Use this design →" : "✓ Use this design"),
    h("button", { class: "btn big", style: { marginTop: "10px" }, disabled: !!busy, onclick: newConcept }, "↻ Generate another"),

    h("hr", { class: "sep" }),
    h("label", { style: { fontWeight: 600, display: "block" } }, "Want something changed?"),
    h("p", { class: "field-hint", style: { margin: "2px 0 10px" } }, ai
      ? "Write what you want, page by page. Homepage and whole-site changes can be tried on the preview now; the rest are used when the pages are built."
      : "Write what you want, page by page. Without an AI key they can't be done automatically yet, so they're saved with the site and shown in the editor's AI tab as a to-do list (do them by hand, or with one click once the key is added)."),
    h("div", { class: "page-boxes" }, pages.map(changeBox)),
    addPage,
    c?.requests.length ? h("div", { style: { marginTop: "12px" } },
      h("div", { class: "small", style: { fontWeight: 600 } }, "Done on this design:"),
      h("ul", { class: "changes" }, c.requests.map((r) => h("li", {}, r))),
      c.history.length ? h("button", { class: "btn btn-sm btn-ghost", disabled: !!busy, onclick: () => { c.site = c.history.pop(); c.requests.pop(); save(); render(); } }, "↶ Undo last change") : null,
    ) : null,

    h("hr", { class: "sep" }),
    h("div", { class: "row", style: { gap: "16px" } },
      h("a", { href: "#", class: "small", onclick: (e) => { e.preventDefault(); if (!busy) setStep(1); } }, "← Edit the brief"),
      h("a", { href: "#", class: "small", onclick: (e) => { e.preventDefault(); if (!busy) setStep(2); } }, "← Page descriptions")),
  );

  const label = c ? `Homepage · design ${state.current + 1}${c.requests.length ? ` · ${c.requests.length} change${c.requests.length > 1 ? "s" : ""}` : ""}` : "";
  return h("div", { class: "design" }, side, previewStage(label, c?.site, c?.site.pages[0]));
}

// The preview: a page at its real width, scaled to fit, as in the editor.
function previewStage(label, site, page) {
  const frame = h("div", { class: `frame${device === "mobile" ? " mobile" : ""}` });
  const inner = h("div", { class: "frame-in" });
  const iframe = h("iframe", { id: "preview-frame", title: "Design preview", sandbox: "allow-same-origin" });
  inner.append(iframe);
  frame.append(inner);
  if (busy || !site) frame.append(h("div", { class: "busy", id: "busy" }, h("div", {}, h("div", { class: "spinner" }), h("div", { id: "busy-text", style: { fontWeight: 600 } }, busy || "Loading…"), h("div", { class: "small muted", style: { marginTop: "6px" } }, me.ai.enabled ? "This usually takes under a minute." : ""))));

  const stage = h("main", { class: "stage" },
    h("div", { class: "stage-bar" },
      h("span", { class: "small muted" }, label),
      h("span", { class: "grow" }),
      h("button", { class: `icon-btn${device === "desktop" ? " active" : ""}`, title: "Desktop", onclick: () => { device = "desktop"; render(); } }, "🖥"),
      h("button", { class: `icon-btn${device === "mobile" ? " active" : ""}`, title: "Mobile", onclick: () => { device = "mobile"; render(); } }, "📱"),
    ),
    frame,
  );

  requestAnimationFrame(() => {
    const logical = device === "mobile" ? 390 : 1280;
    const scale = Math.min(1, frame.clientWidth / logical);
    inner.style.width = `${logical}px`;
    inner.style.height = `${frame.clientHeight / scale}px`;
    inner.style.transform = scale < 1 ? `scale(${scale})` : "";
    // Links in the preview don't go anywhere.
    if (site && page) iframe.srcdoc = renderPage(site, page, { base: "/" }).replace("</head>", "<style>a,button{pointer-events:none}</style></head>");
  });
  return stage;
}

window.addEventListener("resize", () => { if (state.step >= 3) render(); });

// ------------------------------------------------------------------- start --

api("/me").then((m) => { me = m; demoBanner(m); }).catch(() => {}).finally(() => {
  // A refresh in the middle of generating: show what we have.
  if (state.step >= 3 && !state.concepts.length) state.step = 2;
  render();
});
