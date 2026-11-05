// EKA HQ's office, top-down pixel art. Rooms: Henry's office, the meeting
// room, your office, the open-plan desks and the coffee corner. Staff sit at
// their desks while they work, take finished work to Henry, and Henry brings
// it to your office. When there's nothing to do they're at the coffee machine;
// at the weekly meeting everyone gathers round the table.

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

export const W = 960, H = 600;
const CORRIDOR = 272;
// Open-plan desks (top-left corner of each desk) and the gap beside each column people walk down.
const DESKS = { support: { x: 40, y: 340 }, builder: { x: 250, y: 340 }, marketing: { x: 460, y: 340 }, account: { x: 40, y: 480 }, ops: { x: 460, y: 480 } };
const LANES = [196, 406, 616];
const laneOf = (x) => LANES[x < 200 ? 0 : x < 410 ? 1 : 2];
const HENRY_DESK = { x: 70, y: 120 };
const HENRY_DOOR = 252, MEETING_DOOR = 470, YOU_DOOR = 690;
const YOU_DESK = { x: 760, y: 112 };
const YOU_DROP = { x: 800, y: 214 };
const HENRY_DROP = { x: 140, y: 214 };
const MEETING_SEATS = { support: { x: 420, y: 118, top: true }, builder: { x: 470, y: 118, top: true }, marketing: { x: 520, y: 118, top: true }, account: { x: 440, y: 204 }, ops: { x: 500, y: 204 }, boss: { x: 372, y: 166, head: true } };
const BREAK = { support: { x: 742, y: 372 }, builder: { x: 790, y: 380 }, account: { x: 838, y: 372 }, ops: { x: 760, y: 420 }, marketing: { x: 812, y: 428 } };

const LOOKS = {
  boss: { skin: "#f3d2b3", hair: "#9ca3af", style: "short", suit: true },
  support: { skin: "#f1c7a0", hair: "#3b2416", style: "short" },
  builder: { skin: "#c68a5a", hair: "#111827", style: "bun" },
  account: { skin: "#f5d6bc", hair: "#b45309", style: "long" },
  ops: { skin: "#8d5a3b", hair: "#1f2937", style: "cap" },
  marketing: { skin: "#e8b48e", hair: "#7c2d12", style: "long" },
};

// ---- sprites ------------------------------------------------------------------
function hair(x, y, look) {
  const c = look.hair;
  if (look.style === "cap") return [r(x - 1, y - 2, 16, 5, "#2563eb"), r(x + 10, y + 1, 7, 2, "#1d4ed8")];
  const out = [r(x, y - 2, 14, 5, c), r(x - 1, y, 2, 6, c), r(x + 13, y, 2, 6, c)];
  if (look.style === "long") out.push(r(x - 1, y + 5, 2, 8, c), r(x + 13, y + 5, 2, 8, c));
  if (look.style === "bun") out.push(r(x + 4, y - 6, 6, 5, c));
  return out;
}
const head = (x, y, look) => [r(x, y, 14, 13, look.skin), ...hair(x, y, look), r(x + 3, y + 6, 2, 2, "#1f2937"), r(x + 9, y + 6, 2, 2, "#1f2937"), r(x + 5, y + 10, 4, 1, "#9a3412")];
function torso(x, y, look, colour, w = 18, h = 14) {
  if (!look.suit) return [r(x, y, w, h, colour), r(x + w / 2 - 2, y, 4, 3, "#fff", { opacity: 0.6 })];
  return [r(x, y, w, h, "#334155"), r(x + w / 2 - 3, y, 6, 6, "#f8fafc"), r(x + w / 2 - 1, y + 1, 2, 8, "#b91c1c")];
}
function seated(x, y, look, colour) {
  return s("g", { class: "sit" }, head(x, y, look), torso(x - 2, y + 13, look, colour),
    s("g", { class: "hands" }, r(x - 4, y + 22, 5, 5, look.skin), r(x + 13, y + 22, 5, 5, look.skin)));
}
function standing(x, y, look, colour, { carrying = false, cup = false, step = 0 } = {}) {
  const top = y - 36;
  return s("g", { class: "stand" },
    r(x - 5, y - 9 - (step ? 1 : 0), 4, 9, "#334155"), r(x + 1, y - 9 - (step ? 0 : 1), 4, 9, "#334155"),
    torso(x - 7, top + 13, look, colour, 14, 15),
    r(x - 9, top + 15, 3, 10, look.suit ? "#334155" : colour), r(x + 6, top + 15, 3, 10, look.suit ? "#334155" : colour),
    head(x - 7, top, look),
    carrying ? [r(x + 4, top + 17, 11, 13, "#fff", { stroke: "#94a3b8", "stroke-width": 0.6 }), r(x + 6, top + 20, 7, 1, "#94a3b8"), r(x + 6, top + 23, 7, 1, "#94a3b8"), r(x + 6, top + 26, 5, 1, "#94a3b8")] : null,
    cup ? [r(x + 7, top + 21, 5, 6, "#f8fafc"), r(x + 12, top + 22, 2, 3, "#f8fafc"), s("g", { class: "steam" }, r(x + 8, top + 16, 1, 3, "#e2e8f0"), r(x + 10, top + 14, 1, 3, "#e2e8f0"))] : null,
  );
}
function tag(x, y, label, colour) {
  const w = label.length * 5.2 + 10;
  return s("g", { class: "tag" }, r(x - w / 2, y - 8, w, 11, "#0f0d1a", { rx: 2, opacity: 0.9 }), r(x - w / 2, y + 3, w, 1.5, colour), txt(x, y + 0.5, label, 5, "#fff"));
}
function bubble(x, y, text, fill, ink) {
  const w = Math.max(14, text.length * 6 + 8);
  return s("g", { class: "bubble" }, r(x, y, w, 14, fill, { rx: 3, stroke: "#0f0d1a", "stroke-width": 1 }), r(x + 3, y + 13, 4, 4, fill), txt(x + w / 2, y + 10.5, text, 7, ink));
}
function deskBlock(x, y, w = 112, top = "#c99358", front = "#8a5a2e") {
  return [r(x, y, w, 30, top), r(x, y, w, 3, "#ffffff", { opacity: 0.18 }), r(x + 2, y + 28, w - 4, 2, "#000", { opacity: 0.12 }),
    r(x, y + 30, w, 18, front), r(x + 4, y + 33, w - 8, 1, "#fff", { opacity: 0.12 }), r(x + 2, y + 48, 5, 4, "#3f2814"), r(x + w - 7, y + 48, 5, 4, "#3f2814")];
}
const chair = (x, y, colour) => [r(x - 1, y - 30, 22, 26, "#1f2937", { rx: 3 }), r(x + 1, y - 28, 18, 20, colour, { opacity: 0.35 })];
function monitor(x, y, state) {
  const screen = state === "working" ? "#60a5fa" : state === "off" ? "#111827" : "#64748b";
  return [r(x, y - 22, 34, 22, "#111827"), r(x + 2, y - 20, 30, 17, screen, { class: state === "working" ? "screen on" : "screen" }),
    state === "working" ? [r(x + 5, y - 17, 18, 2, "#dbeafe", { class: "code c1" }), r(x + 5, y - 13, 22, 2, "#dbeafe", { class: "code c2" }), r(x + 5, y - 9, 12, 2, "#dbeafe", { class: "code c3" })] : null,
    r(x + 14, y, 6, 4, "#111827"), r(x + 9, y + 3, 16, 2, "#374151")];
}
const plant = (x, y, k = 1) => [r(x, y, 14 * k, 14 * k, "#b45309"), r(x - 2, y - 2, 14 * k + 4, 4, "#92400e"), r(x + 2, y - 16 * k, 4, 14 * k, "#16a34a"), r(x + 7 * k, y - 20 * k, 4, 18 * k, "#22c55e"), r(x - 3, y - 10 * k, 6, 4, "#15803d"), r(x + 10 * k, y - 13 * k, 6, 4, "#15803d")];

// ---- the building -------------------------------------------------------------------
function building(owner) {
  const out = [];
  // whole floor: wooden planks
  for (let y = 40, row = 0; y < H; y += 12, row++) {
    out.push(r(0, y, W, 12, row % 2 ? "#a36d3c" : "#ad7643"));
    for (let x = (row % 3) * 37; x < W; x += 112) out.push(r(x, y, 1.5, 12, "#8a5a2e"));
    out.push(r(0, y + 11, W, 1, "#946033"));
  }
  // carpets in the rooms
  const carpet = (x, y, w, h, c1, c2) => { out.push(r(x, y, w, h, c1)); for (let i = 0; i < w; i += 8) for (let j = 0; j < h; j += 8) if ((i + j) % 16 === 0) out.push(r(x + i, y + j, 8, 8, c2)); };
  carpet(0, 40, 300, 212, "#24534f", "#285c58");
  carpet(306, 40, 330, 212, "#3b4160", "#40476a");
  carpet(642, 40, 318, 212, "#4c2f6b", "#553476");
  // corridor runner
  out.push(r(0, 256, W, 30, "#7c5530", { opacity: 0.55 }), r(0, 258, W, 2, "#fde68a", { opacity: 0.25 }), r(0, 282, W, 2, "#fde68a", { opacity: 0.25 }));
  // back wall
  out.push(r(0, 0, W, 40, "#2f2a4a"));
  for (let x = 0; x < W; x += 16) out.push(r(x, 0, 1, 40, "#38325a"));
  out.push(r(0, 34, W, 6, "#231f38"));
  // room walls (with doors) and glass
  const wall = (x, y, w, h) => out.push(r(x, y, w, h, "#231f38"), r(x, y, w, Math.min(h, 2), "#4b4470"));
  const glass = (x, y, w, h) => out.push(r(x, y, w, h, "#bae6fd", { opacity: 0.35 }), r(x, y, w, 1, "#e0f2fe", { opacity: 0.6 }));
  wall(300, 40, 6, 212); wall(636, 40, 6, 212);
  // bottom walls with door gaps
  const bottom = (x0, x1, door) => { wall(x0, 248, door - 22 - x0, 6); wall(door + 22, 248, x1 - door - 22, 6); out.push(r(door - 22, 250, 44, 4, "#5b4636")); };
  bottom(0, 300, HENRY_DOOR); bottom(306, 636, MEETING_DOOR); bottom(642, W, YOU_DOOR);
  glass(20, 244, 200, 4); glass(326, 244, 110, 4); glass(510, 244, 110, 4); glass(740, 244, 200, 4);
  // door signs
  out.push(tag(150, 30, "THE BOSS'S OFFICE", "#0f766e"), tag(471, 30, "MEETING ROOM", "#f59e0b"), tag(801, 30, `${(owner || "YOUR").toUpperCase()}${owner ? "'S" : ""} OFFICE`, "#a855f7"));

  // Henry's office: big desk, bookshelf, plant, rug, certificates
  out.push(r(14, 44, 70, 44, "#5b3a1e"), ...[0, 1, 2].map((i) => r(16, 46 + i * 14, 66, 2, "#3f2814")), ...["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316", "#14b8a6", "#e11d48"].map((c, i) => r(19 + i * 8, 49 + (i % 3) * 14, 6, 10, c)));
  out.push(r(212, 50, 26, 20, "#fde68a"), r(215, 53, 20, 14, "#fffbeb"), r(244, 50, 26, 20, "#fde68a"), r(247, 53, 20, 14, "#fffbeb"));
  out.push(...plant(270, 230), r(40, 186, 170, 40, "#b91c1c", { opacity: 0.35, rx: 3 }));
  // meeting room: long table, whiteboard, chairs
  out.push(r(392, 44, 160, 26, "#e5e7eb"), r(392, 68, 160, 3, "#9ca3af"), txt(472, 56, "THIS WEEK", 5, "#0f766e"), r(400, 60, 60, 2, "#2563eb"), r(470, 60, 70, 2, "#db2777"));
  out.push(r(388, 132, 170, 44, "#8a5a2e"), r(390, 134, 166, 38, "#b47e45"), r(392, 136, 162, 2, "#ddb07a"));
  for (const x of [404, 454, 504]) out.push(r(x + 8, 96, 22, 18, "#1f2937", { rx: 3 }), r(x + 8 + (x === 454 ? 0 : 0), 182, 22, 18, "#1f2937", { rx: 3 }));
  out.push(r(560, 148, 18, 22, "#1f2937", { rx: 3 }), r(360, 148, 18, 22, "#0f766e", { rx: 3 }));
  out.push(...[420, 470, 520].map((x) => r(x, 140, 10, 7, "#f8fafc")), r(600, 210, 14, 14, "#b45309"), ...plant(612, 230));
  // your office: desk, in-tray, sofa, window art, lamp
  out.push(r(660, 50, 70, 30, "#1e1a2e"), r(663, 53, 64, 24, "#38bdf8"), r(663, 66, 64, 11, "#0ea5e9"), r(690, 57, 10, 3, "#f0f9ff"));
  out.push(r(860, 160, 80, 30, "#6d28d9", { rx: 4 }), r(864, 150, 72, 14, "#7c3aed", { rx: 4 }), r(860, 152, 8, 36, "#5b21b6"), r(932, 152, 8, 36, "#5b21b6"));
  out.push(...plant(936, 96), r(660, 200, 8, 30, "#374151"), r(654, 194, 20, 8, "#fde68a"));

  // open plan: coffee corner, sofa, server rack, printer, plants, whiteboard
  out.push(r(700, 298, 250, 100, "#7c5530", { opacity: 0.3 }));
  out.push(r(712, 300, 26, 38, "#d1d5db"), r(715, 304, 20, 10, "#1f2937"), r(718, 308, 4, 2, "#ef4444", { class: "led" }), r(719, 322, 12, 9, "#78350f"), txt(725, 348, "COFFEE", 4, "#fff"));
  out.push(r(752, 296, 20, 11, "#bfdbfe"), r(750, 307, 24, 32, "#e5e7eb"), r(754, 314, 6, 4, "#3b82f6"));
  out.push(r(780, 312, 60, 14, "#a16207"), r(784, 304, 10, 8, "#f8fafc"), r(800, 306, 18, 6, "#fbbf24"));
  out.push(r(720, 490, 120, 30, "#0f766e", { rx: 4 }), r(724, 478, 112, 16, "#14b8a6", { rx: 4 }), r(720, 480, 10, 40, "#115e59"), r(830, 480, 10, 40, "#115e59"), r(750, 530, 60, 26, "#a16207", { rx: 3 }));
  out.push(r(880, 450, 34, 80, "#111827"), r(882, 452, 30, 76, "#1f2937"), ...[0, 1, 2, 3, 4, 5, 6].map((i) => [r(886, 456 + i * 10, 22, 7, "#374151"), r(888, 458 + i * 10, 2, 2, i % 2 ? "#22c55e" : "#38bdf8", { class: `led led${i % 3}` })]), txt(897, 542, "SERVERS", 4, "#fff"));
  out.push(r(250, 480, 112, 40, "#e5e7eb"), r(250, 518, 112, 3, "#9ca3af"), txt(306, 494, "GOALS", 5, "#4f46e5"), r(262, 502, 50, 2, "#16a34a"), r(262, 508, 80, 2, "#db2777"), r(262, 514, 30, 2, "#2563eb"));
  out.push(r(640, 300, 26, 18, "#9ca3af"), r(643, 296, 20, 6, "#e5e7eb"), r(644, 308, 18, 2, "#1f2937"));
  out.push(...plant(12, 586), ...plant(934, 586), ...plant(212, 586), ...plant(664, 586));
  return out;
}

// ---- the office -----------------------------------------------------------------------
export function createOffice({ agents, staff: STAFF, owner = "", onPick }) {
  const svg = s("svg", { class: "office", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet", role: "img", "aria-label": "The HQ office" });
  const links = s("g"), fixed = s("g"), stations = s("g"), people = s("g"), walkers = s("g");
  svg.append(s("g", {}, building(owner)), links, fixed, stations, people, walkers);
  const all = ["boss", ...STAFF];
  const state = Object.fromEntries(all.map((a) => [a, { place: null, waiting: 0 }]));
  let latest = null, picked = "";

  const seatOf = (a) => (a === "boss" ? { x: HENRY_DESK.x + 64, y: HENRY_DESK.y + 4 } : { x: DESKS[a].x + 30, y: DESKS[a].y + 4 });
  // Paths: every spot has a way out to the corridor.
  function exitPath(a, place) {
    if (place === "desk") {
      if (a === "boss") { const p = seatOf(a); return [p, { x: p.x, y: 214 }, { x: HENRY_DOOR, y: 232 }, { x: HENRY_DOOR, y: CORRIDOR }]; }
      const p = seatOf(a), lane = laneOf(p.x);
      return [p, { x: p.x, y: DESKS[a].y - 8 }, { x: lane, y: DESKS[a].y - 8 }, { x: lane, y: CORRIDOR }];
    }
    if (place === "break") { const p = BREAK[a]; return [p, { x: p.x, y: 296 }, { x: p.x, y: CORRIDOR }]; }
    if (place === "meeting") {
      const p = MEETING_SEATS[a];
      return p.top ? [p, { x: 376, y: p.y }, { x: 376, y: 222 }, { x: MEETING_DOOR, y: 222 }, { x: MEETING_DOOR, y: CORRIDOR }]
        : [p, { x: p.x, y: 222 }, { x: MEETING_DOOR, y: 222 }, { x: MEETING_DOOR, y: CORRIDOR }];
    }
    if (place === "you") return [YOU_DROP, { x: YOU_DOOR, y: 226 }, { x: YOU_DOOR, y: CORRIDOR }];
    if (place === "henry") return [HENRY_DROP, { x: HENRY_DOOR, y: 232 }, { x: HENRY_DOOR, y: CORRIDOR }];
    if (place === "out") return [{ x: 480, y: H + 40 }, { x: 480, y: CORRIDOR }];
    return [{ x: 480, y: CORRIDOR }];
  }
  const route = (a, from, to) => { const out = exitPath(a, from), back = exitPath(a, to).reverse(); return [...out, ...back]; };

  function statusOf(a) {
    const c = latest.counts[a];
    return { on: c.on, working: c.working, doing: c.doing, waiting: c.waiting, alerts: c.alerts, failed: c.failed };
  }
  const meetingOn = () => latest.meeting?.active;
  function wanted(a) {
    const st = statusOf(a);
    if (!st.on) return "out";
    if (meetingOn()) return "meeting";
    if (a === "boss") return "desk";
    return st.working || st.waiting || st.alerts || st.failed ? "desk" : "break";
  }
  function describe(a) {
    const st = statusOf(a);
    if (!st.on) return "switched off";
    if (state[a].place === "meeting") return "in the team meeting";
    const bits = [];
    if (st.doing) bits.push(st.doing.toLowerCase());
    if (st.waiting) bits.push(`${st.waiting} waiting for you`);
    if (st.alerts) bits.push(`${st.alerts} alert${st.alerts === 1 ? "" : "s"}`);
    if (st.failed) bits.push(`${st.failed} didn't work`);
    return bits.join(", ") || (a === "boss" ? "keeping an eye on everything" : "all caught up (coffee break)");
  }
  const clickable = (g, target, label) => {
    g.setAttribute("tabindex", 0); g.setAttribute("role", "button"); g.setAttribute("aria-label", label);
    g.addEventListener("click", () => onPick(target));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(target); } });
    return g;
  };

  function station(a) {
    const d = DESKS[a], ag = agents[a], st = statusOf(a), here = state[a].place === "desk";
    const doing = here && st.doing ? st.doing.toUpperCase() : "";
    return clickable(s("g", { class: `station${here && st.working ? " working" : ""}${picked === a ? " picked" : ""}` },
      s("title", {}, `${ag.name} (${ag.role}): ${describe(a)}`),
      picked === a ? r(d.x - 8, d.y - 52, 128, 116, "#fde68a", { opacity: 0.22, rx: 6 }) : null,
      chair(d.x + 26, d.y + 2, ag.colour),
      here ? seated(d.x + 30, d.y - 24, LOOKS[a], ag.colour) : null,
      deskBlock(d.x, d.y),
      monitor(d.x + 66, d.y + 12, here && st.working ? "working" : st.on ? "idle" : "off"),
      r(d.x + 22, d.y + 14, 26, 7, "#374151"), r(d.x + 24, d.y + 15, 22, 1, "#6b7280"),
      r(d.x + 6, d.y + 10, 8, 8, "#f8fafc"), r(d.x + 14, d.y + 12, 2, 4, "#f8fafc"),
      st.on ? null : [r(d.x + 34, d.y + 6, 26, 12, "#fef3c7"), txt(d.x + 47, d.y + 15, "OUT", 5, "#92400e")],
      tag(d.x + 56, d.y - 40, `${ag.name.toUpperCase()} · ${ag.role.toUpperCase()}`, ag.colour),
      doing ? s("g", {}, r(d.x + 56 - (doing.length * 2.4 + 12), d.y + 55, doing.length * 4.8 + 24, 10, ag.colour, { rx: 2 }), txt(d.x + 56, d.y + 62.5, doing, 4.2, "#fff"), s("g", { class: "dots" }, txt(d.x + 56 + doing.length * 2.4 + 6, d.y + 62.5, "…", 4.2, "#fff"))) : null,
      here && (st.alerts || st.failed) ? bubble(d.x + 48, d.y - 34, "!", "#ef4444", "#fff")
        : here && st.waiting ? bubble(d.x + 48, d.y - 34, "?", "#fff", "#0f0d1a")
          : here && st.working ? bubble(d.x + 48, d.y - 34, "…", "#fff", "#0f0d1a") : null,
    ), a, `${ag.name}, ${ag.role}: ${describe(a)}`);
  }

  function henryRoom() {
    const ag = agents.boss, st = statusOf("boss"), here = state.boss.place === "desk";
    const d = HENRY_DESK;
    const waitingStaff = STAFF.reduce((n, a) => n + latest.counts[a].waiting + latest.counts[a].alerts, 0);
    return clickable(s("g", { class: `station henry${here && st.working ? " working" : ""}` },
      s("title", {}, `Henry (the boss): ${describe("boss")}`),
      chair(d.x + 60, d.y + 2, ag.colour),
      here ? seated(d.x + 64, d.y - 24, LOOKS.boss, ag.colour) : null,
      deskBlock(d.x, d.y, 150, "#7c4a21", "#5b3416"),
      monitor(d.x + 104, d.y + 12, here && st.working ? "working" : "idle"),
      r(d.x + 10, d.y + 8, 26, 16, "#3f2814"), ...Array.from({ length: Math.min(6, waitingStaff) }, (_, i) => r(d.x + 12, d.y + 18 - i * 2, 22, 3, "#fff", { stroke: "#cbd5e1", "stroke-width": 0.5 })),
      r(d.x + 44, d.y + 14, 10, 8, "#f8fafc"), r(d.x + 54, d.y + 16, 2, 4, "#f8fafc"),
      here && st.working ? bubble(d.x + 82, d.y - 34, "…", "#fff", "#0f0d1a") : null,
      tag(d.x + 75, d.y - 40, latest.away && latest.connections?.notify?.on ? "HENRY · I'LL TEXT YOU" : "HENRY · BOSS", ag.colour),
    ), "boss", `Henry, the boss: ${describe("boss")}`);
  }

  function yourOffice() {
    const waiting = latest.open.filter((t) => t.status === "waiting" || t.status === "alert").length;
    const d = YOU_DESK;
    return clickable(s("g", { class: "station you" },
      s("title", {}, waiting ? `${waiting} thing${waiting === 1 ? "" : "s"} for you to check` : "Your office: all clear"),
      chair(d.x + 50, d.y + 2, "#a855f7"),
      deskBlock(d.x, d.y, 140, "#6b4f99", "#4c3575"),
      monitor(d.x + 90, d.y + 12, "idle"),
      r(d.x + 10, d.y + 6, 30, 20, "#78350f"), r(d.x + 12, d.y + 8, 26, 16, "#92400e"),
      ...Array.from({ length: Math.min(waiting, 9) }, (_, i) => r(d.x + 13 + (i % 2), d.y + 20 - i * 2, 24, 3, i % 2 ? "#f1f5f9" : "#fff", { stroke: "#cbd5e1", "stroke-width": 0.5 })),
      txt(d.x + 25, d.y + 36, "IN", 5, "#fde68a"),
      waiting ? bubble(d.x + 22, d.y - 22, String(waiting), "#ef4444", "#fff") : null,
      tag(d.x + 70, d.y + 62, waiting ? `${waiting} TO CHECK · CLICK TO OPEN` : "ALL CLEAR", waiting ? "#ef4444" : "#22c55e"),
    ), "you", waiting ? `Your office: ${waiting} things to check` : "Your office: all clear");
  }

  function meetingRoom() {
    const g = clickable(s("g", { class: "meeting-hit" }, r(306, 40, 330, 208, "transparent")), "meeting", "The meeting room");
    return g;
  }

  // Lines from desks with waiting work to Henry's in-tray.
  function workLines() {
    const out = [];
    for (const a of STAFF) {
      const st = statusOf(a);
      if (!(st.waiting || st.alerts) || state[a].place !== "desk") continue;
      const from = { x: DESKS[a].x + 56, y: DESKS[a].y - 8 };
      const d = `M${from.x},${from.y} L${laneOf(from.x)},${from.y} L${laneOf(from.x)},${CORRIDOR} L${HENRY_DOOR},${CORRIDOR} L${HENRY_DOOR},230 L${HENRY_DESK.x + 24},${HENRY_DESK.y + 52}`;
      const colour = st.alerts ? "#ef4444" : agents[a].colour;
      out.push(s("path", { d, stroke: colour, "stroke-width": 1.5, "stroke-dasharray": "3 4", fill: "none", class: "flow", opacity: 0.8 }));
    }
    const waiting = latest.open.filter((t) => t.status === "waiting" || t.status === "alert").length;
    if (waiting) {
      const d = `M${HENRY_DESK.x + 150},${HENRY_DESK.y + 52} L${HENRY_DOOR},230 L${HENRY_DOOR},${CORRIDOR} L${YOU_DOOR},${CORRIDOR} L${YOU_DOOR},226 L${YOU_DESK.x + 25},${YOU_DESK.y + 52}`;
      out.push(s("path", { d, stroke: "#fde68a", "stroke-width": 2, "stroke-dasharray": "4 4", fill: "none", class: "flow" }));
      out.push(s("g", {}, r(-4, -5, 8, 10, "#fff", { stroke: "#f59e0b", "stroke-width": 1 }), s("animateMotion", { dur: "4s", repeatCount: "indefinite", path: d })));
    }
    return out;
  }

  function drawPeople() {
    const out = [];
    for (const a of all) {
      const p = state[a].place, ag = agents[a];
      if (p === "break") out.push(s("g", { class: "idle" }, standing(BREAK[a].x, BREAK[a].y, LOOKS[a], ag.colour, { cup: true }), tag(BREAK[a].x, BREAK[a].y - 42, ag.name.toUpperCase(), ag.colour)));
      if (p === "meeting") {
        const m = MEETING_SEATS[a];
        const talking = latest.meeting?.writing && a === "boss";
        if (m.top) out.push(s("g", { class: "sit" }, head(m.x - 7, m.y - 22, LOOKS[a]), torso(m.x - 9, m.y - 9, LOOKS[a], ag.colour), tag(m.x, m.y - 30, ag.name.toUpperCase(), ag.colour)));
        else if (m.head) out.push(s("g", {}, head(m.x - 7, m.y - 26, LOOKS[a]), torso(m.x - 9, m.y - 13, LOOKS[a], ag.colour), tag(m.x, m.y - 34, "HENRY", ag.colour), talking ? bubble(m.x + 8, m.y - 56, "…", "#fff", "#0f0d1a") : null));
        else out.push(s("g", {}, head(m.x - 7, m.y - 14, LOOKS[a]), torso(m.x - 9, m.y - 1, LOOKS[a], ag.colour), tag(m.x, m.y + 26, ag.name.toUpperCase(), ag.colour)));
      }
    }
    // chatter in the meeting
    if (meetingOn()) {
      const speaker = STAFF[Math.floor(Date.now() / 3000) % STAFF.length];
      const m = MEETING_SEATS[speaker];
      if (state[speaker].place === "meeting") out.push(bubble(m.x + 6, m.top ? m.y - 52 : m.y - 36, "!", "#fde68a", "#0f0d1a"));
    }
    people.replaceChildren(s("g", {}, out));
  }

  function draw() {
    links.replaceChildren(s("g", {}, workLines()));
    fixed.replaceChildren(henryRoom(), yourOffice(), meetingRoom());
    stations.replaceChildren(...STAFF.map(station));
    drawPeople();
  }

  // ---- walking ----------------------------------------------------------------------
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function walk(a, points, opts = {}) {
    return new Promise((resolve) => {
      if (reduced || !document.contains(svg) || document.hidden) return resolve();
      const g = s("g", { class: "walker" });
      walkers.append(g);
      const segs = [];
      let total = 0;
      for (let i = 1; i < points.length; i++) { const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y); segs.push({ a: points[i - 1], b: points[i], len }); total += len; }
      const speed = 150, start = performance.now();
      const frame = (now) => {
        let dist = Math.min(total, ((now - start) / 1000) * speed);
        let p = points.at(-1);
        for (const sg of segs) { if (dist <= sg.len) { const t = sg.len ? dist / sg.len : 1; p = { x: sg.a.x + (sg.b.x - sg.a.x) * t, y: sg.a.y + (sg.b.y - sg.a.y) * t }; break; } dist -= sg.len; }
        g.replaceChildren(standing(Math.round(p.x), Math.round(p.y), LOOKS[a], agents[a].colour, { ...opts, step: Math.floor(now / 130) % 2 }));
        if (((now - start) / 1000) * speed < total) requestAnimationFrame(frame); else { g.remove(); resolve(); }
      };
      requestAnimationFrame(frame);
    });
  }

  const moving = new Set();
  let henryQueue = 0;
  async function henryDelivers() {
    if (moving.has("boss") || state.boss.place !== "desk") { henryQueue++; return; }
    moving.add("boss");
    try {
      state.boss.place = "walking"; draw();
      await walk("boss", route("boss", "desk", "you"), { carrying: true });
      await new Promise((r) => setTimeout(r, 600));
      await walk("boss", route("boss", "you", "desk"));
    } finally {
      state.boss.place = "desk"; moving.delete("boss"); draw();
      if (henryQueue) { henryQueue = 0; settle("boss"); }
    }
  }

  async function settle(a, first = false) {
    if (moving.has(a)) return;
    const st = statusOf(a);
    const want = wanted(a);
    const cur = state[a];
    const pile = st.waiting + st.alerts;
    const newWork = cur.place === "desk" && want === "desk" && pile > cur.waiting;
    cur.waiting = pile;
    if (first || !cur.place) { cur.place = want; return; }
    if (a === "boss") {
      if (want !== cur.place) {
        moving.add(a);
        const from = cur.place; cur.place = "walking"; draw();
        await walk(a, route(a, from, want)); cur.place = want; moving.delete(a); draw();
      }
      return;
    }
    if (cur.place === want && !newWork) return;
    moving.add(a);
    try {
      if (newWork) {
        // Take the finished work to Henry, then come back; Henry takes it on to you.
        cur.place = "walking"; draw();
        await walk(a, route(a, "desk", "henry"), { carrying: true });
        henryDelivers();
        await walk(a, route(a, "henry", "desk"));
      } else {
        const from = cur.place; cur.place = "walking"; draw();
        await walk(a, route(a, from, want), { cup: want === "break" });
      }
      cur.place = want;
    } finally { moving.delete(a); draw(); settle(a); }
  }

  let first = true;
  let chatter = setInterval(() => { if (latest && meetingOn()) drawPeople(); }, 3000);
  return {
    el: svg,
    update(data, filter) {
      latest = data; picked = filter;
      for (const a of all) settle(a, first);
      first = false;
      draw();
    },
    stop() { clearInterval(chatter); },
  };
}
