// JARVIS: a voice assistant that can use this computer.
// Start it with start-jarvis-windows.bat (or `npm run jarvis`), then open
// http://localhost:3200 in Chrome or Edge.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import express from "express";
import { createBrain } from "./brain.js";
import { createClaudeCodeBrain, describeToolCall, findClaude } from "./claude-code-brain.js";
import { getTool, needsConfirmation, validateInput } from "./tools.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DATA = process.env.JARVIS_DATA || path.join(ROOT, "jarvis-data");

// Settings: jarvis-settings.txt first, then the builder's settings.txt (so an
// API key that's already there is reused). Real environment variables win.
// An empty value (e.g. ANTHROPIC_API_KEY= left blank) doesn't hide one set later.
for (const name of ["jarvis-settings.txt", "settings.txt", ".env"]) {
  let text;
  try {
    text = readFileSync(path.join(ROOT, name), "utf8");
  } catch {
    continue; // Not there: fine.
  }
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (!process.env[key] && value) process.env[key] = value;
  }
}

const PORT = Number(process.env.JARVIS_PORT) || 3200;
const HOST = process.env.JARVIS_HOST || "127.0.0.1";
const PAGE_URL = `http://localhost:${PORT}`;
const OPEN_WINDOW = process.argv.includes("--open");
const yes = (v) => /^(1|yes|true|on)$/i.test(String(v || "").trim());
const AUTO_APPROVE = yes(process.env.JARVIS_AUTO_APPROVE);

// ---------- memory (facts Jarvis keeps between conversations) ----------

const MEMORY_FILE = path.join(DATA, "memory.json");
const memory = {
  async list() {
    try {
      return JSON.parse(await fs.readFile(MEMORY_FILE, "utf8")).map((m) => m.fact);
    } catch {
      return [];
    }
  },
  async save(facts) {
    await fs.mkdir(DATA, { recursive: true });
    const tmp = `${MEMORY_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(facts.map((fact) => ({ fact })), null, 2));
    await fs.rename(tmp, MEMORY_FILE);
  },
  async add(fact) {
    const facts = await this.list();
    if (!facts.includes(fact)) facts.push(fact);
    await this.save(facts);
  },
  async forget(contains) {
    const facts = await this.list();
    const keep = facts.filter((f) => !f.toLowerCase().includes(contains.toLowerCase()));
    await this.save(keep);
    return facts.length - keep.length;
  },
};

// ---------- reminders and the browser's event channel ----------

const listeners = new Set();
function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of listeners) res.write(line);
}

const reminders = {
  add(minutes, message) {
    const ms = Math.max(1, Math.min(minutes, 60 * 24 * 7) * 60_000);
    const due = new Date(Date.now() + ms);
    setTimeout(() => broadcast({ type: "reminder", message }), ms);
    return due;
  },
};

// ---------- the assistant ----------

// Two ways to reach Claude:
//   claude-code: through the Claude Code program, logged in to your Claude
//                account, so it uses your Claude plan. No API key needed.
//   api:         through the Claude API with an API key (billed per use).
// JARVIS_BRAIN=auto (the default) uses Claude Code when it's installed.
const INTERNAL_TOKEN = crypto.randomBytes(24).toString("hex");
const callMe = process.env.JARVIS_CALL_ME || "sir";
const userName = process.env.JARVIS_USER_NAME || "";
const wanted = (process.env.JARVIS_BRAIN || "auto").toLowerCase();
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const claude = wanted === "api" ? null : findClaude();

let brain;
if (claude) {
  brain = createClaudeCodeBrain({
    claude,
    dataDir: DATA,
    jarvisUrl: `http://127.0.0.1:${PORT}`,
    internalToken: INTERNAL_TOKEN,
    callMe,
    userName,
    model: process.env.JARVIS_MODEL || "",
    effort: process.env.JARVIS_EFFORT || "",
    memory,
  });
  console.log("\n  Using Claude Code with your Claude account (your plan's usage, no API key).");
} else if (wanted !== "claude-code" && hasKey) {
  brain = createBrain({
    model: process.env.JARVIS_MODEL || "claude-opus-5-5",
    effort: process.env.JARVIS_EFFORT || "medium",
    callMe,
    userName,
    autoApprove: AUTO_APPROVE,
    memory,
    reminders,
  });
  brain.kind = "api";
  console.log("\n  Using the Claude API with your API key.");
} else {
  console.log(`
  Jarvis needs Claude Code (uses your Claude subscription) or an API key.

  To use your Claude subscription (Pro or Max):
    1. Open PowerShell and run:   irm https://claude.ai/install.ps1 | iex
       (Mac/Linux: curl -fsSL https://claude.ai/install.sh | bash)
    2. Close it, open a new one, type  claude  and press Enter, and log in.
    3. Start Jarvis again.

  Or paste an API key into jarvis-settings.txt (ANTHROPIC_API_KEY=).
`);
  process.exit(1);
}

const pendingConfirms = new Map(); // tool call id -> resolve(boolean)
let currentTurn = null; // { emit, confirm } of the request in progress

// ---------- web server ----------

const app = express();
app.disable("x-powered-by");

// Only this computer's own Jarvis page may talk to Jarvis. Without these
// checks any website open in the browser could send it commands.
const allowedHosts = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
app.use((req, res, next) => {
  if (!allowedHosts.has(req.headers.host)) return res.status(403).send("Forbidden");
  // Jarvis's own helper (mcp-relay.js) proves itself with a secret made at startup.
  if (req.path.startsWith("/api/internal/")) {
    const token = String(req.headers["x-jarvis-token"] || "");
    const ok = token.length === INTERNAL_TOKEN.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(INTERNAL_TOKEN));
    return ok ? next() : res.status(403).json({ error: "Forbidden" });
  }
  const origin = req.headers.origin;
  if (req.method !== "GET" && (!origin || !allowedHosts.has(origin.replace(/^https?:\/\//, "")))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
});
app.use(express.json({ limit: "1mb", type: "application/json" }));

app.use(express.static(path.join(HERE, "public"), { index: "index.html" }));

app.get("/api/info", (req, res) => {
  res.json({
    callMe: process.env.JARVIS_CALL_ME || "sir",
    wakeWord: (process.env.JARVIS_WAKE_WORD || "jarvis").toLowerCase(),
    voice: process.env.JARVIS_VOICE || "",
    autoApprove: AUTO_APPROVE,
    brain: brain.kind,
  });
});

app.get("/api/events", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(": connected\n\n");
  listeners.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(ping);
    listeners.delete(res);
  });
});

// One request to Jarvis. The answer streams back as one JSON object per line.
app.post("/api/chat", async (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Say something first." });
  if (brain.busy) return res.status(409).json({ error: "I'm still working on the last request." });

  res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });
  const emit = (event) => res.write(`${JSON.stringify(event)}\n`);
  const confirm = (request) =>
    new Promise((resolve) => {
      pendingConfirms.set(request.id, resolve);
      emit({ type: "confirm", ...request });
    });
  // Closing the page part-way stops the request (and denies anything waiting).
  res.on("close", () => {
    if (!res.writableFinished) {
      brain.stop();
      for (const resolve of pendingConfirms.values()) resolve(false);
      pendingConfirms.clear();
    }
  });

  currentTurn = { emit, confirm };
  try {
    await brain.handle(text, { emit, confirm });
  } catch (err) {
    console.error(err);
    emit({ type: "error", message: friendlyError(err) });
  } finally {
    currentTurn = null;
    for (const resolve of pendingConfirms.values()) resolve(false);
    pendingConfirms.clear();
    emit({ type: "done" });
    res.end();
  }
});

// Calls from Claude Code, through mcp-relay.js: a Jarvis tool to run, or a
// permission question ("approve") for one of Claude Code's own tools.
let confirmSeq = 0;
async function askUser(summary, detail, tool) {
  if (AUTO_APPROVE) return true;
  if (!currentTurn) return false;
  currentTurn.emit({ type: "status", state: "waiting" });
  return currentTurn.confirm({ id: `ask_${++confirmSeq}`, tool, summary, detail });
}
const mcpText = (text, isError) => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

app.post("/api/internal/call", async (req, res) => {
  const { name, arguments: input = {} } = req.body || {};
  if (name === "approve") {
    const { summary, detail } = describeToolCall(input.tool_name, input.input);
    const ok = await askUser(summary, detail, input.tool_name);
    const decision = ok
      ? { behavior: "allow", updatedInput: input.input }
      : { behavior: "deny", message: "The user denied this. Don't try it another way unless they ask." };
    return res.json(mcpText(JSON.stringify(decision)));
  }
  const tool = getTool(name);
  if (!tool) return res.json(mcpText(`There is no tool called ${name}.`, true));
  const problem = validateInput(tool, input);
  if (problem) return res.json(mcpText(`Invalid input: ${problem}`, true));
  if (needsConfirmation(tool, input, AUTO_APPROVE)) {
    const ok = await askUser(tool.summary?.(input) || name, tool.detail?.(input) || "", name);
    if (!ok) return res.json(mcpText("The user denied this. Don't try it another way unless they ask.", true));
  }
  try {
    const output = await tool.run(input, { memory, reminders });
    if (typeof output === "string") return res.json(mcpText(output));
    // Images (screenshots) in MCP's shape.
    res.json({
      content: output.map((b) =>
        b.type === "image" ? { type: "image", data: b.source.data, mimeType: b.source.media_type } : { type: "text", text: b.text || "" },
      ),
    });
  } catch (err) {
    res.json(mcpText(`Failed: ${err.message}`, true));
  }
});

app.post("/api/confirm", (req, res) => {
  const { id, approve } = req.body || {};
  const resolve = pendingConfirms.get(id);
  if (!resolve) return res.status(404).json({ error: "Nothing is waiting for that." });
  pendingConfirms.delete(id);
  resolve(approve === true);
  res.json({ ok: true });
});

app.post("/api/stop", (req, res) => {
  brain.stop();
  for (const resolve of pendingConfirms.values()) resolve(false);
  pendingConfirms.clear();
  res.json({ ok: true });
});

app.post("/api/reset", async (req, res) => {
  if (brain.busy) return res.status(409).json({ error: "Stop the current request first." });
  await brain.reset();
  res.json({ ok: true });
});

app.get("/api/memory", async (req, res) => res.json({ facts: await memory.list() }));
app.post("/api/memory/forget", async (req, res) => {
  const facts = await memory.list();
  const index = Number(req.body?.index);
  if (!Number.isInteger(index) || index < 0 || index >= facts.length) return res.status(400).json({ error: "No such memory." });
  facts.splice(index, 1);
  await memory.save(facts);
  res.json({ facts });
});

function friendlyError(err) {
  const status = err?.status;
  if (status === 401) return "My API key was refused. Check ANTHROPIC_API_KEY in jarvis-settings.txt.";
  if (status === 429) return "I'm being rate limited. Give it a moment and try again.";
  if (status === 529 || status >= 500) return "Claude's servers are busy right now. Try again in a moment.";
  if (err?.code === "ENOTFOUND" || err?.code === "ECONNREFUSED") return "I can't reach the internet right now.";
  return err?.message || "Something went wrong.";
}

// Opens Jarvis in its own window (Edge or Chrome "app" window on Windows).
function openWindow() {
  if (process.platform === "win32") {
    const script = `$u='${PAGE_URL}'
foreach ($b in @('msedge','chrome')) { try { Start-Process $b "--app=$u" -ErrorAction Stop; exit } catch {} }
Start-Process $u`;
    spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script], { windowsHide: true, detached: true, stdio: "ignore" }).unref();
  } else {
    spawn(process.platform === "darwin" ? "open" : "xdg-open", [PAGE_URL], { detached: true, stdio: "ignore" }).unref();
  }
}

const server = app.listen(PORT, HOST, () => {
  console.log(`  JARVIS is online at ${PAGE_URL}`);
  console.log("  Open it in Chrome or Edge and allow the microphone.\n");
  if (OPEN_WINDOW) openWindow();
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    // Already running (e.g. started with Windows): just show it.
    console.log(`  Jarvis is already running at ${PAGE_URL}.`);
    if (OPEN_WINDOW) openWindow();
    setTimeout(() => process.exit(0), 1500);
    return;
  }
  throw err;
});
