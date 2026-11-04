// EKA HQ: the office where your AI staff work, and the queue of things they
// bring you to approve.
import { h, api, toast, timeAgo, confirmDialog } from "./ui.js";
import { SITE_DESIGNS } from "/admin/shared/site-designs.js";

const app = document.getElementById("app");
const ORDER = ["support", "builder", "account", "ops", "marketing"];
const LOOKS = {
  support: { skin: "#f1c7a0", hair: "#3b2416" },
  builder: { skin: "#c68a5a", hair: "#111827" },
  account: { skin: "#f5d6bc", hair: "#b45309" },
  ops: { skin: "#8d5a3b", hair: "#1f2937" },
  marketing: { skin: "#e8b48e", hair: "#7c2d12" },
};
let data = null;
let filter = "";
let timer = null;
const cards = new Map(); // task id → { stamp, el }
const SVG = "http://www.w3.org/2000/svg";

function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const r = (x, y, w, hgt, fill, extra = {}) => s("rect", { x, y, width: w, height: hgt, fill, ...extra });

// ---- the office ------------------------------------------------------------

function deskStatus(a) {
  const c = data.counts[a];
  if (!c.on) return { cls: "off", bubble: "OFF", fill: "#6b7280", ink: "#fff" };
  if (c.alerts) return { cls: c.working ? "working" : "", bubble: `${c.alerts}!`, fill: "#dc2626", ink: "#fff" };
  if (c.waiting) return { cls: c.working ? "working" : "", bubble: `${c.waiting}`, fill: "#facc15", ink: "#1f2937" };
  if (c.working) return { cls: "working", bubble: "...", fill: "#fff", ink: "#1f2937" };
  return { cls: "", bubble: "z", fill: "#e5e7eb", ink: "#6b7280" };
}

function desk(a, i) {
  const x = 14 + i * 78;
  const ag = data.agents[a];
  const look = LOOKS[a];
  const st = deskStatus(a);
  const px = x + 12; // the person
  const g = s("g", { class: `desk ${st.cls}${filter === a ? " picked" : ""}`, tabindex: 0, role: "button", "aria-label": `${ag.name}, ${ag.role}: ${describe(a)}` },
    s("title", {}, `${ag.name} (${ag.role}): ${describe(a)}`),
    // chair
    r(px - 2, 64, 24, 24, "#374151"), r(px, 66, 20, 20, "#4b5563"),
    // person
    s("g", { class: "person" },
      r(px + 3, 50, 14, 14, look.skin), // head
      r(px + 3, 48, 14, 5, look.hair), r(px + 2, 50, 2, 7, look.hair), r(px + 16, 50, 2, 7, look.hair),
      r(px + 6, 56, 2, 2, "#1f2937"), r(px + 12, 56, 2, 2, "#1f2937"), r(px + 8, 60, 4, 1, "#9a3412"),
      r(px + 1, 64, 18, 16, ag.colour), r(px + 8, 64, 4, 3, "#fff", { opacity: 0.7 }),
    ),
    s("g", { class: "hands" }, r(px - 1, 79, 5, 4, look.skin), r(px + 16, 79, 5, 4, look.skin)),
    // desk
    r(x, 82, 66, 5, "#b7824a"), r(x, 87, 66, 16, "#8a5a2e"), r(x + 2, 89, 62, 1, "#a06a38"),
    r(x + 2, 103, 4, 12, "#6b4422"), r(x + 60, 103, 4, 12, "#6b4422"),
    // computer, mug and papers
    r(x + 38, 64, 24, 16, "#1f2937"), r(x + 40, 66, 20, 12, st.cls === "off" ? "#1f2937" : "#94a3b8", { class: "screen" }),
    r(x + 48, 80, 4, 2, "#1f2937"), r(x + 44, 81, 12, 1, "#374151"),
    r(x + 4, 78, 7, 4, "#f8fafc"), r(x + 30, 77, 5, 5, "#e11d48"), r(x + 35, 78, 1, 3, "#e11d48"),
    // name plate
    r(x + 9, 118, 48, 13, "#f5f0e1", { class: "plate", rx: 1 }),
    s("text", { x: x + 33, y: 128, "text-anchor": "middle", "font-size": 8, fill: "#3b2f20" }, ag.name.toUpperCase()),
    // speech bubble
    s("g", { class: "bubble" },
      r(px - 4, 28, 28, 14, st.fill, { rx: 2 }), r(px + 6, 42, 4, 3, st.fill),
      s("text", { x: px + 10, y: 38.5, "text-anchor": "middle", "font-size": 9, fill: st.ink }, st.bubble),
    ),
  );
  const pick = () => { filter = filter === a ? "" : a; render(); };
  g.addEventListener("click", pick);
  g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
  return g;
}

function describe(a) {
  const c = data.counts[a];
  if (!c.on) return "switched off";
  const bits = [];
  if (c.working) bits.push("working on something");
  if (c.waiting) bits.push(`${c.waiting} waiting for you`);
  if (c.alerts) bits.push(`${c.alerts} alert${c.alerts === 1 ? "" : "s"}`);
  return bits.join(", ") || "all caught up";
}

function office() {
  const wall = [r(0, 0, 400, 70, "#3d3560"), ...Array.from({ length: 20 }, (_, i) => r(i * 20, 0, 1, 70, "#463d6e")), r(0, 66, 400, 4, "#2b2540")];
  const floor = [];
  for (let y = 70; y < 140; y += 10) for (let x = 0; x < 400; x += 10) floor.push(r(x, y, 10, 10, (x + y) % 20 ? "#6e5a43" : "#7a654c"));
  const win = (x) => [r(x, 8, 46, 30, "#2a2342"), r(x + 2, 10, 42, 26, "#7dd3fc"), r(x + 2, 26, 42, 10, "#38bdf8"), r(x + 22, 10, 2, 26, "#2a2342"), r(x + 2, 22, 42, 2, "#2a2342"), r(x + 6, 14, 8, 3, "#f0f9ff")];
  const plant = (x) => [r(x, 46, 12, 14, "#b45309"), r(x - 2, 44, 16, 3, "#92400e"), r(x + 2, 32, 4, 12, "#16a34a"), r(x + 6, 28, 4, 16, "#22c55e"), r(x - 2, 36, 5, 4, "#15803d"), r(x + 9, 34, 5, 4, "#15803d")];
  const sign = [r(166, 10, 68, 20, "#1e1a2e"), r(168, 12, 64, 16, "#4f46e5"), s("text", { x: 200, y: 24, "text-anchor": "middle", "font-size": 10, fill: "#fff" }, "EKA HQ")];
  const clock = [r(260, 12, 14, 14, "#f8fafc", { rx: 7 }), r(266, 14, 2, 6, "#1f2937"), r(266, 19, 5, 2, "#1f2937")];
  return s("svg", { class: "office", viewBox: "0 0 400 140", role: "img", "aria-label": "The HQ office" },
    wall, win(30), win(310), sign, clock, plant(110), plant(374), floor,
    ORDER.map(desk),
  );
}

// ---- the queue ---------------------------------------------------------------

const EMAIL_KINDS = new Set(["build", "checkin", "lead"]);
const stamp = (t) => `${t.status}|${t.updatedAt}|${data.mail}`;

function taskCard(t) {
  const ag = data.agents[t.agent];
  const draft = t.draft || {};
  const to = EMAIL_KINDS.has(t.kind) ? h("input", { class: "input", value: draft.to || "", placeholder: "Their email address", "aria-label": "Send to" }) : null;
  const subject = t.status === "waiting" && (EMAIL_KINDS.has(t.kind) || t.agent === "support") ? h("input", { class: "input", value: draft.subject || "", "aria-label": "Subject" }) : null;
  const text = t.status === "waiting" && t.kind !== "blog" && t.draft ? h("textarea", { class: "textarea", "aria-label": "Message" }, draft.text || "") : null;
  const current = () => ({ ...(to ? { to: to.value } : {}), ...(subject ? { subject: subject.value } : {}), ...(text ? { text: text.value } : {}) });
  const act = async (path, body, okMsg) => {
    try {
      const out = await api(`/hq/tasks/${t.id}/${path}`, { method: "POST", body: body || {} });
      if (okMsg) toast(okMsg);
      if (out.hq) apply(out.hq);
      else await refresh();
    } catch (err) { toast(err.message, { error: true }); }
  };
  const btn = (label, onclick, cls = "") => h("button", { class: `btn btn-sm ${cls}`, onclick }, label);
  const acts = [];
  if (t.status === "waiting") {
    if (t.agent === "support") acts.push(btn(data.mail ? "Send reply" : "Post reply", () => act("approve", { draft: current() }, "Reply sent.")));
    else if (EMAIL_KINDS.has(t.kind)) {
      if (data.mail) acts.push(btn("Send email", () => act("approve", { draft: current() }, "Sent."), "btn-primary"));
      acts.push(btn(data.mail ? "I sent it myself" : "Copy and mark sent", async () => {
        if (!data.mail) await navigator.clipboard?.writeText(`${subject?.value || ""}\n\n${text?.value || ""}`).catch(() => {});
        act("approve", { draft: current(), manual: true }, data.mail ? "Marked as sent." : "Copied. Paste it into your email to send it.");
      }));
    } else if (t.kind === "blog") acts.push(btn("Add to my website as a draft", () => act("approve", {}, "Added as a draft post."), "btn-primary"));
    else if (t.kind === "social") {
      acts.push(btn("Copy", async () => { try { await navigator.clipboard.writeText(text.value); toast("Copied."); } catch { text.select(); } }));
      acts.push(btn("Mark as posted", () => act("approve", { draft: current() }), "btn-primary"));
    }
    if (text || subject || to) acts.push(btn("Save changes", () => act("draft", { draft: current() }, "Saved.")));
    if (t.agent === "support" && acts[0]) acts[0].classList.add("btn-primary");
  }
  if (t.status === "alert") acts.push(btn("Mark as sorted", () => act("approve", {}), "btn-primary"));
  if (t.status === "failed") acts.push(btn("Try again", () => act("retry", {}, "Trying again…"), "btn-primary"));
  if (["waiting", "alert", "failed"].includes(t.status)) acts.push(btn("Dismiss", async () => { if (await confirmDialog("Dismiss this? Nothing will be sent.", { okText: "Dismiss" })) act("dismiss"); }, "btn-ghost"));

  const links = [];
  if (t.data?.review) links.push(h("a", { href: t.data.review, target: "_blank", rel: "noopener" }, "Open the review link"));
  if (t.data?.editor || (t.data?.siteId && t.kind === "build")) links.push(h("a", { href: t.data.editor || `/admin/sites/${t.data.siteId}` }, "Open in the editor"));
  if (t.data?.link) links.push(h("a", { href: t.data.link, ...(/^https?:/.test(t.data.link) ? { target: "_blank", rel: "noopener" } : {}) }, "Go there"));
  if (t.kind === "checkin" && t.data?.siteId) links.push(h("a", { href: `/admin/sites/${t.data.siteId}` }, "Open the website"));

  return h("article", { class: `task ${t.status}`, style: `--c:${ag.colour}` },
    h("div", { class: "task-head" },
      h("span", { class: "avatar", "aria-hidden": "true" }, ag.name[0]),
      h("div", { style: { flex: 1, minWidth: 0 } },
        h("div", { class: "task-title" }, t.title),
        h("div", { class: "task-meta" }, `${ag.name} · ${ag.role} · ${timeAgo(t.updatedAt)}`, " ", statusBadge(t)),
        t.summary ? h("p", { class: "task-summary" }, t.summary) : null,
      ),
    ),
    to || subject || text ? h("div", { class: "task-draft" }, to, subject, text) : null,
    links.length ? h("div", { class: "task-links" }, links) : null,
    acts.length ? h("div", { class: "task-acts" }, acts) : null,
  );
}

function statusBadge(t) {
  if (t.status === "working") return h("span", { class: "badge badge-busy" }, h("span", { class: "spinner", style: { width: "10px", height: "10px", borderWidth: "2px" } }), "Working");
  if (t.status === "alert") return h("span", { class: "badge badge-err" }, "Alert");
  if (t.status === "failed") return h("span", { class: "badge badge-err" }, "Didn't work");
  if (t.status === "waiting") return h("span", { class: "badge badge-warn" }, t.data?.needsHuman ? "Needs a person" : "Needs you");
  return h("span", { class: "badge" }, t.status === "done" ? "Done" : "Dismissed");
}

function queue() {
  const list = data.open.filter((t) => !filter || t.agent === filter);
  const seen = new Set();
  const els = list.map((t) => {
    seen.add(t.id);
    const old = cards.get(t.id);
    // Keep a card someone is typing in.
    if (old && (old.stamp === stamp(t) || old.el.contains(document.activeElement))) return old.el;
    const el = taskCard(t);
    cards.set(t.id, { stamp: stamp(t), el });
    return el;
  });
  for (const id of cards.keys()) if (!seen.has(id)) cards.delete(id);
  const chips = h("div", { class: "filters" },
    h("button", { class: `chip${filter ? "" : " on"}`, onclick: () => { filter = ""; render(); } }, `Everything (${data.open.length})`),
    ORDER.map((a) => {
      const n = data.open.filter((t) => t.agent === a).length;
      return h("button", { class: `chip${filter === a ? " on" : ""}`, onclick: () => { filter = a; render(); } }, `${data.agents[a].name} (${n})`);
    }),
  );
  return h("section", { class: "panel" },
    h("h2", {}, "Needs you"),
    chips,
    els.length ? els : h("div", { class: "empty-q" }, h("strong", {}, "All caught up"), filter ? `Nothing from ${data.agents[filter].name} right now.` : "When your staff need you to check something, it appears here."),
  );
}

// ---- the side: new job, run now, settings, activity ---------------------------------

let side = null;
function sidePanels() {
  if (side) { side.querySelector("#recent").replaceWith(recent()); return side; }
  side = h("div", {}, missionForm(), runNow(), settingsPanel(), recent());
  return side;
}

function missionForm() {
  const f = (name, label, attrs = {}) => h("label", { class: "field" }, h("span", {}, label), h(attrs.tag || "input", { class: attrs.tag ? "textarea" : "input", name, ...attrs, tag: undefined }));
  const design = h("select", { class: "select", name: "design" }, h("option", { value: "auto" }, "Choose one for me"), SITE_DESIGNS.map((d) => h("option", { value: d.id }, d.name)));
  const customer = h("select", { class: "select", name: "customerId" }, h("option", { value: "" }, "Nobody yet (I'll move it later)"), data.customers.map((c) => h("option", { value: c.id }, c.name ? `${c.name} (${c.email})` : c.email)));
  const form = h("form", { class: "form-grid", onsubmit: async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    const go = form.querySelector("button");
    go.disabled = true;
    try {
      await api("/hq/missions", { method: "POST", body });
      toast(`${data.agents.builder.name} is on it. It'll appear in "Needs you" when it's ready.`);
      form.reset();
      await refresh();
    } catch (err) { toast(err.message, { error: true }); } finally { go.disabled = false; }
  } },
  f("name", "Business name", { required: true, maxlength: 120, placeholder: "e.g. Rosie's Bakery" }),
  f("description", "What they do", { tag: "textarea", rows: 3, maxlength: 6000, placeholder: "What they sell or offer, where, who for, anything special" }),
  h("div", { class: "two" }, f("phone", "Phone", { maxlength: 60 }), f("email", "Their email", { type: "email", maxlength: 200 })),
  f("address", "Address", { maxlength: 300 }),
  h("label", { class: "field" }, h("span", {}, "Design"), design),
  h("label", { class: "field" }, h("span", {}, "Whose website"), customer),
  f("sendTo", "Send the review link to", { type: "email", maxlength: 200, placeholder: "Their email (if different)" }),
  h("button", { class: "btn btn-primary", type: "submit" }, `Ask ${data.agents.builder.name} to build it`),
  );
  return h("section", { class: "panel" }, h("h2", {}, "Build a website for a customer"), h("p", { class: "muted small", style: { margin: "0 0 10px" } }, data.ai ? "Bea builds the whole site from a ready-made design, writes every page for the business, then brings you a review link to check before it goes to the customer." : "AI is off, so Bea builds it from the design's template text. You can edit it before sending."), form);
}

function runNow() {
  const run = async (a, label, b) => {
    b.disabled = true;
    try {
      const out = await api(`/hq/run/${a}`, { method: "POST", body: {} });
      toast(label);
      if (out.hq) apply(out.hq); else setTimeout(refresh, 800);
    } catch (err) { toast(err.message, { error: true }); } finally { b.disabled = false; }
  };
  const item = (a, text, done) => {
    const b = h("button", { class: "btn btn-sm", onclick: () => run(a, done, b) }, "Run now");
    return h("div", { class: "agent-row" }, h("span", { class: "avatar", style: `--c:${data.agents[a].colour}` }, data.agents[a].name[0]), h("div", { class: "who" }, text), b);
  };
  return h("section", { class: "panel" }, h("h2", {}, "Run now"),
    h("p", { class: "muted small", style: { margin: "0 0 6px" } }, "They also do this by themselves: checks every hour, check-ins in the first week of each month, marketing every Monday."),
    item("ops", h("span", {}, "Check everything", h("small", {}, "Backups, disk space, licence, email, failed builds, unanswered messages, domains")), "Checked."),
    item("account", h("span", {}, "Write this month's check-ins", h("small", {}, "One email per customer with a live website (each only once a month)")), "Writing the check-ins…"),
    item("marketing", h("span", {}, "Write this week's marketing", h("small", {}, "Social posts, a blog post and replies to enquiries on your own website")), "Writing…"),
  );
}

function settingsPanel() {
  const save = async (patch) => {
    try { const out = await api("/hq/settings", { method: "POST", body: patch }); data.settings = out.settings; toast("Saved."); refresh(); } catch (err) { toast(err.message, { error: true }); }
  };
  const rows = ORDER.map((a) => {
    const ag = data.agents[a];
    const box = h("input", { type: "checkbox", checked: data.settings[a].on, onchange: () => save({ [a]: { on: box.checked } }), "aria-label": `${ag.name} at work` });
    return h("div", { class: "agent-row" }, h("span", { class: "avatar", style: `--c:${ag.colour}` }, ag.name[0]), h("div", { class: "who" }, `${ag.name}`, h("small", {}, ag.role)), h("label", { class: "check" }, box, "At work"));
  });
  const auto = h("input", { type: "checkbox", checked: data.settings.support.autoSend, onchange: () => save({ support: { autoSend: auto.checked } }) });
  const site = h("select", { class: "select", onchange: () => save({ marketing: { siteId: site.value } }) }, h("option", { value: "" }, "None"), data.sites.map((x) => h("option", { value: x.id, selected: x.id === data.settings.marketing.siteId }, x.name)));
  const about = h("textarea", { class: "textarea", rows: 3, maxlength: 400, placeholder: "e.g. EKA Hosting: UK web hosting, an AI website builder and done-for-you websites for small businesses", onchange: () => save({ marketing: { about: about.value } }) }, data.settings.marketing.about || "");
  return h("section", { class: "panel" }, h("h2", {}, "Your staff"), rows,
    h("label", { class: "check", style: { marginTop: "10px" } }, auto, "Send replies Sam is sure about without asking me"),
    h("p", { class: "muted small", style: { margin: "4px 0 12px" } }, "Off is safest. Anything about money, refunds or a customer's account always comes to you."),
    h("label", { class: "field" }, h("span", {}, "Your own website (Mia writes blog posts for it and follows up its enquiries)"), site),
    h("label", { class: "field" }, h("span", {}, "About your business (for Mia)"), about),
  );
}

function recent() {
  return h("section", { class: "panel", id: "recent" }, h("h2", {}, "Recently"),
    data.recent.length ? h("ul", { class: "recent" }, data.recent.map((t) => h("li", {}, h("strong", { style: { color: data.agents[t.agent].colour } }, data.agents[t.agent].name), ` ${t.status === "done" ? "✓" : "✕"} ${t.title} `, h("span", { class: "muted" }, `· ${t.summary || ""} · ${timeAgo(t.updatedAt)}`))))
      : h("p", { class: "muted small", style: { margin: 0 } }, "Nothing yet."),
  );
}

// ---- page ------------------------------------------------------------------------

function notices() {
  const out = [];
  if (!data.ai) out.push(h("div", { class: "notice", style: { marginBottom: "12px" } }, h("strong", {}, "AI is off. "), "Your staff still check things and fill in templates, but they can't write replies, posts or websites for you. Set ANTHROPIC_API_KEY to turn AI on."));
  if (!data.mail) out.push(h("div", { class: "notice", style: { marginBottom: "12px" } }, h("strong", {}, "Email isn't set up. "), "Approved emails can't be sent from here, so copy them into your own email instead. Add SMTP settings in settings.txt to send them with one click."));
  return out;
}

function waitingTotal() { return data.open.filter((t) => t.status === "waiting" || t.status === "alert").length; }

let shell = null;
const typing = (box) => box.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

function render() {
  const n = waitingTotal();
  document.title = `${n ? `(${n}) ` : ""}HQ · EKA Hosting`;
  if (!shell) {
    shell = { notices: h("div"), office: h("section", { class: "panel office-wrap" }), queue: h("div"), side: h("div") };
    app.replaceChildren(
      h("div", { class: "head" }, h("div", {}, h("h1", {}, "EKA HQ"), h("p", { class: "muted", style: { margin: 0 } }, "Your AI staff do the groundwork. Nothing reaches a customer until you approve it."))),
      shell.notices, shell.office, h("div", { class: "cols" }, shell.queue, shell.side),
    );
  }
  shell.notices.replaceChildren(...notices());
  const working = ORDER.filter((a) => data.counts[a].working).map((a) => data.agents[a].name);
  shell.office.replaceChildren(office(),
    h("div", { class: "office-bar" },
      h("span", { class: "grow" }, n ? `${n} thing${n === 1 ? "" : "s"} waiting for you` : "Nothing waiting for you", working.length ? ` · ${working.join(", ")} working` : "", data.openTickets ? ` · ${data.openTickets} open customer message${data.openTickets === 1 ? "" : "s"}` : ""),
      filter ? h("button", { class: "btn btn-sm", onclick: () => { filter = ""; render(); } }, `Showing ${data.agents[filter].name}'s work · show all`) : h("span", { class: "small" }, "Click a desk to see that person's work"),
    ),
  );
  // Don't pull the page out from under someone who's typing.
  if (!typing(shell.queue)) shell.queue.replaceChildren(queue());
  if (!shell.side.firstChild) shell.side.append(sidePanels());
  else if (!typing(shell.side)) sidePanels();
}

function apply(overview) {
  Object.assign(data, overview);
  render();
  schedule();
}

async function refresh() {
  try { apply(await api("/hq")); } catch (err) { toast(err.message, { error: true }); schedule(); }
}

function schedule() {
  clearTimeout(timer);
  const busy = ORDER.some((a) => data.counts[a].working);
  timer = setTimeout(refresh, busy ? 3000 : 15000);
}

document.getElementById("logout").addEventListener("click", async () => {
  await api("/logout", { method: "POST", body: {} });
  location.href = "/admin/login";
});

data = await api("/hq");
render();
schedule();
