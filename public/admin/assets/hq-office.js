// EKA HQ's office: a top-down pixel-art room where the AI staff sit at their
// desks while they work, wander to the coffee corner when there's nothing to
// do, and walk their work over to your desk when it needs approving.

const SVG = "http://www.w3.org/2000/svg";
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v);
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const r = (x, y, w, h, fill, extra = {}) => s("rect", { x, y, width: w, height: h, fill, ...extra });
const FONT = "'Press Start 2P', ui-monospace, Menlo, Consolas, monospace";
const txt = (x, y, text, size, fill, extra = {}) => s("text", { x, y, "font-size": size, fill, "font-family": FONT, "text-anchor": "middle", ...extra }, text);

const W = 640, H = 360;
const AISLE = 196;
const DESKS = {
  support: { x: 56, y: 104 },
  builder: { x: 420, y: 104 },
  account: { x: 56, y: 252 },
  marketing: { x: 238, y: 272 },
  ops: { x: 420, y: 252 },
};
const YOU = { x: 232, y: 112, w: 150 };
const DROP = { x: 307, y: 186 }; // where staff stand to hand you their work
const BREAK = [{ x: 562, y: 160 }, { x: 600, y: 156 }, { x: 566, y: 202 }, { x: 604, y: 206 }, { x: 620, y: 178 }];
const LOOKS = {
  support: { skin: "#f1c7a0", hair: "#3b2416", style: "short" },
  builder: { skin: "#c68a5a", hair: "#111827", style: "bun" },
  account: { skin: "#f5d6bc", hair: "#b45309", style: "long" },
  ops: { skin: "#8d5a3b", hair: "#1f2937", style: "cap" },
  marketing: { skin: "#e8b48e", hair: "#7c2d12", style: "long" },
};
const ACTIVITY = { reply: "DRAFTING A REPLY", build: "BUILDING A WEBSITE", checkin: "WRITING CHECK-INS", social: "WRITING POSTS", blog: "WRITING A BLOG POST", lead: "ANSWERING AN ENQUIRY" };

// ---- sprites ------------------------------------------------------------------

function hair(x, y, look) {
  const c = look.hair;
  if (look.style === "cap") return [r(x - 1, y - 2, 16, 5, "#2563eb"), r(x + 10, y + 1, 7, 2, "#1d4ed8")];
  const out = [r(x, y - 2, 14, 5, c), r(x - 1, y, 2, 6, c), r(x + 13, y, 2, 6, c)];
  if (look.style === "long") out.push(r(x - 1, y + 5, 2, 8, c), r(x + 13, y + 5, 2, 8, c));
  if (look.style === "bun") out.push(r(x + 4, y - 6, 6, 5, c));
  return out;
}
function head(x, y, look) {
  return [r(x, y, 14, 13, look.skin), ...hair(x, y, look), r(x + 3, y + 6, 2, 2, "#1f2937"), r(x + 9, y + 6, 2, 2, "#1f2937"), r(x + 5, y + 10, 4, 1, "#9a3412")];
}
// Sitting at a desk: x, y = top-left of the head.
function seated(x, y, look, colour) {
  return s("g", { class: "sit" },
    head(x, y, look),
    r(x - 2, y + 13, 18, 14, colour), r(x + 5, y + 13, 4, 3, "#fff", { opacity: 0.6 }),
    s("g", { class: "hands" }, r(x - 4, y + 22, 5, 5, look.skin), r(x + 13, y + 22, 5, 5, look.skin)),
  );
}
// Standing: x, y = between the feet.
function standing(x, y, look, colour, { carrying = false, cup = false } = {}) {
  const top = y - 36;
  return s("g", { class: "stand" },
    s("g", { class: "legs" }, r(x - 5, y - 9, 4, 9, "#334155", { class: "leg-a" }), r(x + 1, y - 9, 4, 9, "#334155", { class: "leg-b" })),
    r(x - 7, top + 13, 14, 15, colour), r(x - 2, top + 13, 4, 3, "#fff", { opacity: 0.6 }),
    r(x - 9, top + 15, 3, 10, colour), r(x + 6, top + 15, 3, 10, colour),
    head(x - 7, top, look),
    carrying ? [r(x + 4, top + 18, 10, 12, "#f8fafc"), r(x + 6, top + 21, 6, 1, "#94a3b8"), r(x + 6, top + 24, 6, 1, "#94a3b8")] : null,
    cup ? [r(x + 7, top + 21, 5, 6, "#f8fafc"), r(x + 12, top + 22, 2, 3, "#f8fafc"), s("g", { class: "steam" }, r(x + 8, top + 16, 1, 3, "#e2e8f0"), r(x + 10, top + 14, 1, 3, "#e2e8f0"))] : null,
  );
}

function tag(x, y, label, colour) {
  const w = label.length * 5.2 + 10;
  return s("g", {}, r(x - w / 2, y - 8, w, 11, "#0f0d1a", { rx: 2, opacity: 0.88 }), r(x - w / 2, y + 3, w, 1.5, colour), txt(x, y + 0.5, label, 5, "#fff"));
}
function bubble(x, y, text, fill, ink) {
  const w = Math.max(14, text.length * 6 + 8);
  return s("g", { class: "bubble" }, r(x, y, w, 14, fill, { rx: 3, stroke: "#0f0d1a", "stroke-width": 1 }), r(x + 3, y + 13, 4, 4, fill), txt(x + w / 2, y + 10.5, text, 7, ink));
}

// ---- the room ------------------------------------------------------------------

function room() {
  const out = [];
  // floor planks
  for (let y = 56, row = 0; y < H; y += 12, row++) {
    out.push(r(0, y, W, 12, row % 2 ? "#a36d3c" : "#ad7643"));
    for (let x = (row % 3) * 37; x < W; x += 112) out.push(r(x, y, 1.5, 12, "#8a5a2e"));
    out.push(r(0, y + 11, W, 1, "#946033"));
  }
  // wall
  out.push(r(0, 0, W, 50, "#2f2a4a"));
  for (let x = 0; x < W; x += 16) out.push(r(x, 0, 1, 50, "#38325a"));
  out.push(r(0, 44, W, 6, "#231f38"), r(0, 50, W, 6, "#5b4636"));
  const win = (x) => [r(x, 6, 58, 32, "#231f38"), r(x + 3, 9, 52, 26, "#7dd3fc"), r(x + 3, 24, 52, 11, "#38bdf8"), r(x + 28, 9, 2, 26, "#231f38"), r(x + 3, 21, 52, 2, "#231f38"), r(x + 8, 12, 10, 3, "#f0f9ff"), r(x + 36, 27, 14, 4, "#bae6fd")];
  out.push(...win(14), ...win(498));
  // title sign
  out.push(r(236, 6, 168, 30, "#0f0d1a", { rx: 2 }), r(239, 9, 162, 24, "#4f46e5"), r(239, 29, 162, 4, "#4338ca"), txt(320, 26, "EKA HQ", 12, "#fff", { class: "sign" }));
  // whiteboard, clock, posters, bookshelf
  out.push(r(98, 10, 58, 30, "#e5e7eb"), r(98, 38, 58, 3, "#9ca3af"), txt(127, 21, "GOALS", 5, "#4f46e5"), r(104, 26, 30, 2, "#16a34a"), r(104, 31, 42, 2, "#db2777"));
  out.push(r(172, 14, 18, 18, "#f8fafc", { rx: 9 }), r(180, 17, 2, 7, "#1f2937"), r(180, 23, 6, 2, "#1f2937"));
  out.push(r(420, 10, 22, 28, "#f59e0b"), r(424, 14, 14, 10, "#fde68a"), r(448, 12, 22, 26, "#16a34a"), r(452, 16, 14, 4, "#bbf7d0"));
  out.push(r(570, 8, 56, 40, "#5b3a1e"), ...[0, 1, 2].map((i) => r(572, 10 + i * 13, 52, 2, "#3f2814")), ...["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316"].map((c, i) => r(575 + i * 8, 13 + (i % 2) * 13, 6, 10, c)));
  // rug under your desk
  out.push(r(214, 96, 186, 108, "#3730a3", { rx: 4 }), r(220, 102, 174, 96, "#4f46e5", { rx: 3, opacity: 0.55 }));
  // coffee corner
  out.push(r(548, 60, 86, 70, "#7c5530", { opacity: 0.35 }));
  out.push(r(556, 62, 24, 34, "#d1d5db"), r(559, 66, 18, 10, "#1f2937"), r(562, 70, 4, 2, "#ef4444", { class: "led" }), r(563, 82, 10, 8, "#78350f"), txt(568, 104, "COFFEE", 4, "#fff"));
  out.push(r(596, 58, 18, 10, "#bfdbfe"), r(594, 68, 22, 30, "#e5e7eb"), r(598, 74, 6, 4, "#3b82f6"));
  out.push(r(620, 70, 12, 18, "#b45309"), r(618, 58, 6, 14, "#16a34a"), r(626, 54, 6, 18, "#22c55e"));
  // plants
  const plant = (x, y) => [r(x, y, 14, 14, "#b45309"), r(x - 2, y - 2, 18, 4, "#92400e"), r(x + 2, y - 16, 4, 14, "#16a34a"), r(x + 7, y - 20, 4, 18, "#22c55e"), r(x - 3, y - 10, 6, 4, "#15803d"), r(x + 10, y - 13, 6, 4, "#15803d")];
  out.push(...plant(10, 336), ...plant(616, 336), ...plant(196, 78));
  // printer by your desk
  out.push(r(400, 120, 24, 16, "#9ca3af"), r(403, 116, 18, 5, "#e5e7eb"), r(404, 126, 16, 2, "#1f2937"));
  // Otto's server rack
  out.push(r(560, 220, 30, 64, "#111827"), r(562, 222, 26, 60, "#1f2937"), ...[0, 1, 2, 3, 4, 5].map((i) => [r(565, 226 + i * 9, 20, 6, "#374151"), r(567, 228 + i * 9, 2, 2, i % 2 ? "#22c55e" : "#38bdf8", { class: `led led${i % 3}` })]));
  return out;
}

function deskBlock(x, y, w = 112) {
  return [
    r(x, y, w, 30, "#c99358"), r(x, y, w, 3, "#ddb07a"), r(x + 2, y + 28, w - 4, 2, "#b47e45"),
    r(x, y + 30, w, 18, "#8a5a2e"), r(x + 4, y + 33, w - 8, 1, "#a06a38"),
    r(x + 2, y + 48, 5, 4, "#5b3a1e"), r(x + w - 7, y + 48, 5, 4, "#5b3a1e"),
  ];
}
function chair(x, y, colour) {
  return [r(x - 1, y - 30, 22, 26, "#1f2937", { rx: 3 }), r(x + 1, y - 28, 18, 20, colour, { opacity: 0.35 })];
}
function monitor(x, y, state) {
  const screen = state === "working" ? "#60a5fa" : state === "off" ? "#111827" : "#64748b";
  return [r(x, y - 22, 34, 22, "#111827"), r(x + 2, y - 20, 30, 17, screen, { class: state === "working" ? "screen on" : "screen" }),
    state === "working" ? [r(x + 5, y - 17, 18, 2, "#dbeafe", { class: "code c1" }), r(x + 5, y - 13, 22, 2, "#dbeafe", { class: "code c2" }), r(x + 5, y - 9, 12, 2, "#dbeafe", { class: "code c3" })] : null,
    r(x + 14, y, 6, 4, "#111827"), r(x + 9, y + 3, 16, 2, "#374151")];
}

// ---- the office -----------------------------------------------------------------

export function createOffice({ agents, onPick }) {
  const ids = Object.keys(DESKS);
  const svg = s("svg", { class: "office", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "The HQ office" });
  const links = s("g", { class: "links" });
  const stations = s("g");
  const walkers = s("g");
  const youLayer = s("g");
  svg.append(s("g", {}, room()), links, youLayer, stations, walkers);

  const state = Object.fromEntries(ids.map((a) => [a, { place: null, busy: false, waiting: 0 }]));
  let latest = null;
  let picked = "";

  const seatOf = (a) => ({ x: DESKS[a].x + 30, y: DESKS[a].y + 4 });
  const breakOf = (a) => BREAK[ids.indexOf(a)];

  function statusOf(a) {
    const c = latest.counts[a];
    const work = latest.open.filter((t) => t.agent === a && t.status === "working");
    const activity = work.length ? ACTIVITY[work[0].kind] || "WORKING" : a === "ops" && c.working ? "RUNNING CHECKS" : "";
    return { on: c.on, working: c.working, waiting: c.waiting, alerts: c.alerts, failed: latest.open.filter((t) => t.agent === a && t.status === "failed").length, activity };
  }
  // Where someone should be: at their desk while there's work, in the coffee corner when there isn't.
  const wantedPlace = (st) => (!st.on ? "out" : st.working || st.waiting || st.alerts || st.failed ? "desk" : "break");

  function station(a) {
    const d = DESKS[a];
    const ag = agents[a];
    const st = statusOf(a);
    const here = state[a].place === "desk";
    const g = s("g", { class: `station${here && st.working ? " working" : ""}${picked === a ? " picked" : ""}`, tabindex: 0, role: "button", "aria-label": `${ag.name}, ${ag.role}: ${describe(st)}` },
      s("title", {}, `${ag.name} (${ag.role}): ${describe(st)}`),
      picked === a ? r(d.x - 8, d.y - 52, 128, 112, "#fde68a", { opacity: 0.22, rx: 6 }) : null,
      chair(d.x + 26, d.y + 2, ag.colour),
      here ? seated(d.x + 30, d.y - 24, LOOKS[a], ag.colour) : null,
      deskBlock(d.x, d.y),
      monitor(d.x + 66, d.y + 12, here && st.working ? "working" : st.on ? "idle" : "off"),
      r(d.x + 22, d.y + 14, 26, 7, "#374151"), r(d.x + 24, d.y + 15, 22, 1, "#6b7280"), // keyboard
      r(d.x + 6, d.y + 10, 8, 8, "#f8fafc"), r(d.x + 14, d.y + 12, 2, 4, "#f8fafc"), // mug
      r(d.x + 100, d.y + 8, 8, 12, "#f8fafc", { opacity: 0.9 }),
      st.on ? null : [r(d.x + 34, d.y + 6, 26, 12, "#fef3c7"), txt(d.x + 47, d.y + 15, "OUT", 5, "#92400e")],
      tag(d.x + 56, d.y - 40, `${ag.name.toUpperCase()} · ${ag.role.toUpperCase()}`, ag.colour),
      here && st.activity ? s("g", { class: "activity" }, r(d.x + 56 - (st.activity.length * 2.6 + 10), d.y + 54, st.activity.length * 5.2 + 20, 10, ag.colour, { rx: 2 }), txt(d.x + 56, d.y + 61.5, `${st.activity}`, 4.5, "#fff"), s("g", { class: "dots" }, txt(d.x + 56 + st.activity.length * 2.6 + 6, d.y + 61.5, "…", 4.5, "#fff"))) : null,
      here && (st.alerts || st.failed) ? bubble(d.x + 48, d.y - 34, "!", "#ef4444", "#fff")
        : here && st.waiting ? bubble(d.x + 48, d.y - 34, "?", "#fff", "#0f0d1a")
          : here && st.working ? bubble(d.x + 48, d.y - 34, "…", "#fff", "#0f0d1a") : null,
    );
    const pick = () => onPick(a);
    g.addEventListener("click", pick);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    return g;
  }

  function describe(st) {
    if (!st.on) return "switched off";
    const bits = [];
    if (st.activity) bits.push(st.activity.toLowerCase());
    if (st.waiting) bits.push(`${st.waiting} waiting for you`);
    if (st.alerts) bits.push(`${st.alerts} alert${st.alerts === 1 ? "" : "s"}`);
    if (st.failed) bits.push(`${st.failed} didn't work`);
    return bits.join(", ") || "all caught up (on a coffee break)";
  }

  function yourDesk() {
    const waiting = latest.open.filter((t) => t.status === "waiting" || t.status === "alert").length;
    const pile = Math.min(waiting, 8);
    return [
      chair(YOU.x + 64, YOU.y + 2, "#4f46e5"),
      deskBlock(YOU.x, YOU.y, YOU.w),
      monitor(YOU.x + 58, YOU.y + 12, "idle"),
      r(YOU.x + 10, YOU.y + 6, 30, 20, "#78350f"), r(YOU.x + 12, YOU.y + 8, 26, 16, "#92400e"),
      ...Array.from({ length: pile }, (_, i) => r(YOU.x + 13 + (i % 2), YOU.y + 20 - i * 2, 24, 3, i % 2 ? "#f1f5f9" : "#fff", { stroke: "#cbd5e1", "stroke-width": 0.5 })),
      r(YOU.x + 112, YOU.y + 10, 26, 14, "#fde68a"), txt(YOU.x + 125, YOU.y + 19, "IN", 5, "#92400e"),
      tag(YOU.x + YOU.w / 2, YOU.y - 20, waiting ? `YOUR DESK · ${waiting} TO CHECK` : "YOUR DESK · ALL CLEAR", waiting ? "#ef4444" : "#22c55e"),
    ];
  }

  // Dotted lines carrying work from each desk to yours.
  function workLines() {
    const out = [];
    for (const a of ids) {
      const st = statusOf(a);
      if (!(st.waiting || st.alerts) || state[a].place !== "desk") continue;
      const from = { x: DESKS[a].x + 56, y: DESKS[a].y + (DESKS[a].y > YOU.y ? -6 : 50) };
      const to = { x: YOU.x + YOU.w / 2 + (from.x < YOU.x ? -50 : from.x > YOU.x + YOU.w ? 50 : 0), y: from.y > YOU.y + 40 ? YOU.y + 54 : YOU.y + 24 };
      const d = `M${from.x},${from.y} L${to.x},${to.y}`;
      const colour = st.alerts ? "#ef4444" : agents[a].colour;
      out.push(s("path", { d, stroke: "#0f0d1a", "stroke-width": 4, opacity: 0.25, fill: "none" }), s("path", { d, stroke: colour, "stroke-width": 2, "stroke-dasharray": "4 4", fill: "none", class: "flow" }));
      out.push(s("g", {}, r(-4, -5, 8, 10, "#fff", { stroke: colour, "stroke-width": 1 }), s("animateMotion", { dur: "2.4s", repeatCount: "indefinite", path: d })));
    }
    return out;
  }

  // ---- walking --------------------------------------------------------------------
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function route(from, to) {
    if (Math.abs(from.y - to.y) < 4) return [from, to];
    return [from, { x: from.x, y: AISLE }, { x: to.x, y: AISLE }, to];
  }
  function walk(a, points, opts = {}) {
    return new Promise((resolve) => {
      if (reduced || !document.contains(svg)) return resolve();
      const g = s("g", { class: "walker" });
      walkers.append(g);
      const segs = [];
      let total = 0;
      for (let i = 1; i < points.length; i++) { const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y); segs.push({ a: points[i - 1], b: points[i], len }); total += len; }
      const speed = 90; // px per second
      const start = performance.now();
      const frame = (now) => {
        let dist = Math.min(total, ((now - start) / 1000) * speed);
        let p = points.at(-1);
        for (const sg of segs) { if (dist <= sg.len) { const t = sg.len ? dist / sg.len : 1; p = { x: sg.a.x + (sg.b.x - sg.a.x) * t, y: sg.a.y + (sg.b.y - sg.a.y) * t }; break; } dist -= sg.len; }
        const step = Math.floor(now / 140) % 2;
        g.replaceChildren(standing(Math.round(p.x), Math.round(p.y), LOOKS[a], agents[a].colour, opts));
        g.querySelector(".leg-a")?.setAttribute("y", Math.round(p.y) - 9 - step);
        g.querySelector(".leg-b")?.setAttribute("y", Math.round(p.y) - 9 - (1 - step));
        if ((now - start) / 1000 * speed < total) requestAnimationFrame(frame);
        else { g.remove(); resolve(); }
      };
      requestAnimationFrame(frame);
    });
  }

  function drawBreak() {
    for (const el of walkers.querySelectorAll(".idle")) el.remove();
    for (const a of ids) if (state[a].place === "break") {
      const p = breakOf(a);
      walkers.append(s("g", { class: "idle", "aria-hidden": "true" }, standing(p.x, p.y, LOOKS[a], agents[a].colour, { cup: true }), tag(p.x, p.y - 42, agents[a].name.toUpperCase(), agents[a].colour)));
    }
  }

  function draw() {
    youLayer.replaceChildren(s("g", {}, yourDesk()));
    links.replaceChildren(s("g", {}, workLines()));
    stations.replaceChildren(...ids.map(station));
    drawBreak();
  }

  const moving = new Set();
  async function settle(a, first) {
    if (moving.has(a)) return;
    const st = statusOf(a);
    const want = wantedPlace(st);
    const cur = state[a];
    const newWork = cur.place === "desk" && want === "desk" && st.waiting + st.alerts > cur.waiting;
    cur.waiting = st.waiting + st.alerts;
    if (first || cur.place === want && !newWork) { cur.place = want; return; }
    moving.add(a);
    try {
      if (newWork) {
        // Take the finished work over to your desk, then come back.
        cur.place = "walking"; draw();
        await walk(a, route(seatOf(a), DROP), { carrying: true });
        await walk(a, route(DROP, seatOf(a)));
      } else {
        const prev = cur.place;
        const offstage = (p) => ({ x: p.x, y: H + 40 });
        const from = prev === "break" ? breakOf(a) : prev === "out" ? offstage(seatOf(a)) : seatOf(a);
        const to = want === "break" ? breakOf(a) : want === "out" ? offstage(from) : seatOf(a);
        cur.place = "walking"; draw();
        await walk(a, route(from, to), { cup: want === "break" });
      }
      cur.place = want;
    } finally {
      moving.delete(a);
      draw();
      settle(a, false); // things may have moved on while walking
    }
  }

  let first = true;
  return {
    el: svg,
    update(data, filter) {
      latest = data;
      picked = filter;
      for (const a of ids) settle(a, first);
      first = false;
      draw();
    },
  };
}
