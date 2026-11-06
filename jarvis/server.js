// JARVIS: a voice assistant that can use this computer.
// Start it with start-jarvis-windows.bat (or `npm run jarvis`), then open
// http://localhost:3200 in Chrome or Edge.

import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import express from "express";
import { createBrain } from "./brain.js";

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
const yes = (v) => /^(1|yes|true|on)$/i.test(String(v || "").trim());

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.log("\n  Jarvis needs a Claude API key. Open jarvis-settings.txt in Notepad,");
  console.log("  paste your key after ANTHROPIC_API_KEY= (it starts with sk-ant-), save,");
  console.log("  then start Jarvis again. Keys come from https://platform.claude.com\n");
  process.exit(1);
}

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

const brain = createBrain({
  model: process.env.JARVIS_MODEL || "claude-opus-5-5",
  effort: process.env.JARVIS_EFFORT || "medium",
  callMe: process.env.JARVIS_CALL_ME || "sir",
  userName: process.env.JARVIS_USER_NAME || "",
  autoApprove: yes(process.env.JARVIS_AUTO_APPROVE),
  memory,
  reminders,
});

const pendingConfirms = new Map(); // tool call id -> resolve(boolean)

// ---------- web server ----------

const app = express();
app.disable("x-powered-by");

// Only this computer's own Jarvis page may talk to Jarvis. Without these
// checks any website open in the browser could send it commands.
const allowedHosts = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
app.use((req, res, next) => {
  if (!allowedHosts.has(req.headers.host)) return res.status(403).send("Forbidden");
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
    autoApprove: yes(process.env.JARVIS_AUTO_APPROVE),
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

  try {
    await brain.handle(text, { emit, confirm });
  } catch (err) {
    console.error(err);
    emit({ type: "error", message: friendlyError(err) });
  } finally {
    for (const resolve of pendingConfirms.values()) resolve(false);
    pendingConfirms.clear();
    emit({ type: "done" });
    res.end();
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

app.listen(PORT, HOST, () => {
  console.log(`\n  JARVIS is online at http://localhost:${PORT}`);
  console.log("  Open it in Chrome or Edge and allow the microphone.\n");
});
