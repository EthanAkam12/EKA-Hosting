// Jarvis's brain when it runs through Claude Code (the `claude` program)
// instead of the API. Claude Code is logged in to the user's Claude account,
// so this uses their Claude plan's usage, with no API key.
//
// Each request runs `claude -p` with the user's words on stdin and reads its
// stream of events. Follow-up requests resume the same Claude Code session, so
// the conversation carries on. Jarvis's own PC tools reach Claude Code through
// mcp-relay.js, and Claude Code's permission prompts come back to Jarvis through
// its "approve" tool, where they become Approve / Deny cards.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getTool } from "./tools.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IS_WINDOWS = process.platform === "win32";

// Finds the claude program. Returns { file, shell } or null.
export function findClaude(command = process.env.JARVIS_CLAUDE_PATH || "claude") {
  if (IS_WINDOWS && !path.isAbsolute(command)) {
    const r = spawnSync("where", [command], { encoding: "utf8", windowsHide: true });
    const hits = (r.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const exe = hits.find((h) => /\.exe$/i.test(h));
    const cmd = hits.find((h) => /\.(cmd|bat)$/i.test(h));
    if (exe) return { file: exe, shell: false };
    if (cmd) return { file: cmd, shell: true };
    // Just installed: the installer's folder may not be on PATH until a restart.
    const installed = path.join(os.homedir(), ".local", "bin", "claude.exe");
    return existsSync(installed) ? { file: installed, shell: false } : null;
  }
  const shell = IS_WINDOWS && /\.(cmd|bat)$/i.test(command);
  for (const candidate of [command, path.join(os.homedir(), ".local", "bin", "claude")]) {
    const r = spawnSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true, shell });
    if (r.status === 0) return { file: candidate, shell };
    if (candidate !== "claude") break; // a path the user chose: don't look elsewhere
  }
  return null;
}

function persona({ callMe, userName, memoryFacts }) {
  const platform = { win32: "Windows", darwin: "macOS", linux: "Linux" }[process.platform] || process.platform;
  return `# You are JARVIS

In this session you are JARVIS, the user's personal assistant, reached through a voice interface on their own computer, in the spirit of Tony Stark's butler AI: calm, capable, quietly witty, loyal, and a step ahead. You are not working on a coding project unless the user asks for one; you are helping them with whatever they need on and off their computer.

Address the user as "${callMe}"${userName ? ` (their name is ${userName})` : ""}.

How you talk:
- Your replies are read aloud, so write the way you'd speak: short, natural sentences, no markdown, no headings, no bullet lists, no code blocks unless the user asks to see code or a list. One to three sentences is typical.
- Give the answer or the result, not a narration of your process. A dry remark now and then is welcome; don't overdo it.
- If a request is ambiguous and getting it wrong would matter, ask one short question in your reply. Otherwise just do it.

Using the computer (${platform}, home folder ${os.homedir()}):
- Jarvis's tools (named mcp__jarvis__…) control the PC: open apps, sites, files and folders; take a screenshot to see the screen; type and press keys; control volume and music; system status; clipboard; reminders; and long-term memory (remember / forget).${IS_WINDOWS ? "\n- For shell work on Windows, use mcp__jarvis__run_command, which runs PowerShell." : ""}
- Prefer a dedicated Jarvis tool over a shell command when one fits.
- Commands and file changes are shown to the user to approve. If they deny one, accept it and don't try it another way.
- Before anything destructive or hard to undo (deleting files, shutting down, uninstalling, sending something on the user's behalf), say exactly what will happen.
- Use remember when the user tells you something worth knowing next time.

What you remember about the user from earlier conversations:
${memoryFacts.length ? memoryFacts.map((f) => `- ${f}`).join("\n") : "(nothing yet)"}
`;
}

// A short label for the tool chips and approval cards.
export function describeToolCall(name, input = {}) {
  const jarvis = name.startsWith("mcp__jarvis__") ? getTool(name.slice("mcp__jarvis__".length)) : null;
  if (jarvis) return { summary: jarvis.summary ? jarvis.summary(input) : jarvis.name, detail: jarvis.detail?.(input) || "" };
  const file = input.file_path || input.path || input.notebook_path || "";
  switch (name) {
    case "Bash":
    case "PowerShell":
      return { summary: input.description || "Run a command", detail: input.command || "" };
    case "Write":
      return { summary: `Write ${file}`, detail: String(input.content || "").slice(0, 2000) };
    case "Edit":
    case "MultiEdit":
      return { summary: `Edit ${file}`, detail: input.old_string !== undefined ? `- ${input.old_string}\n+ ${input.new_string}`.slice(0, 2000) : "" };
    case "Read":
      return { summary: `Read ${path.basename(file)}`, detail: file };
    case "Glob":
    case "Grep":
      return { summary: `Search files for ${input.pattern}`, detail: "" };
    case "WebSearch":
      return { summary: `Search the web: ${input.query}`, detail: "" };
    case "WebFetch":
      return { summary: `Read ${input.url}`, detail: input.url || "" };
    default:
      return { summary: name.replace(/^mcp__\w+?__/, "").replace(/_/g, " "), detail: JSON.stringify(input, null, 2).slice(0, 2000) };
  }
}

export function createClaudeCodeBrain({ claude, dataDir, jarvisUrl, internalToken, callMe, userName, model, effort, memory }) {
  let sessionId = null;
  let child = null;
  let running = false;
  let stopped = false;

  async function writeConfig() {
    await fs.mkdir(dataDir, { recursive: true });
    const mcpFile = path.join(dataDir, "claude-mcp.json");
    await fs.writeFile(
      mcpFile,
      JSON.stringify({
        mcpServers: {
          jarvis: {
            type: "stdio",
            alwaysLoad: true, // offer Jarvis's tools straight away, no lookup step
            command: process.execPath,
            args: [path.join(HERE, "mcp-relay.js")],
            env: { JARVIS_URL: jarvisUrl, JARVIS_INTERNAL_TOKEN: internalToken },
          },
        },
      }),
    );
    const personaFile = path.join(dataDir, "claude-persona.md");
    await fs.writeFile(personaFile, persona({ callMe, userName, memoryFacts: await memory.list() }));
    return { mcpFile, personaFile };
  }

  function args({ mcpFile, personaFile }) {
    const a = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--mcp-config", mcpFile,
      "--strict-mcp-config",
      "--permission-prompt-tool", "mcp__jarvis__approve",
      // These run without asking: reading, searching and Jarvis's own tools
      // (which ask the user themselves when they need to).
      "--allowedTools", "Read", "Glob", "Grep", "WebSearch", "WebFetch", "mcp__jarvis__*",
      "--append-system-prompt-file", personaFile,
      "--add-dir", os.homedir(),
    ];
    if (model) a.push("--model", model);
    if (effort) a.push("--effort", effort);
    if (sessionId) a.push("--resume", sessionId);
    return a;
  }

  function spawnClaude(argv) {
    if (!claude.shell) return spawn(claude.file, argv, { cwd: os.homedir(), windowsHide: true });
    // A .cmd wrapper (npm install) needs the shell; every argument is ours, quoted.
    const quoted = [claude.file, ...argv].map((s) => `"${String(s).replace(/"/g, '""')}"`).join(" ");
    return spawn(quoted, { cwd: os.homedir(), windowsHide: true, shell: true });
  }

  // Approvals reach the user through the server (see /api/internal/call), so
  // only emit is used here.
  async function handle(userText, { emit }) {
    if (running) throw new Error("I'm still working on the last request.");
    running = true;
    stopped = false;
    try {
      await run(userText, emit);
    } finally {
      running = false;
      child = null;
    }
  }

  async function run(userText, emit) {
    const files = await writeConfig();
    emit({ type: "status", state: "thinking" });

    const proc = spawnClaude(args(files));
    child = proc;
    proc.stdin.end(userText);

    let stderr = "";
    let failure = null;
    let gotText = false;
    const chips = new Map(); // tool_use id -> summary
    proc.stderr.on("data", (d) => (stderr += d));

    let buf = "";
    proc.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        onEvent(ev);
      }
    });

    function onEvent(ev) {
      if (ev.session_id && !stopped) sessionId = ev.session_id;
      if (ev.parent_tool_use_id) return; // a helper agent's own work; skip it
      if (ev.type === "stream_event") {
        const e = ev.event;
        if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") {
          gotText = true;
          emit({ type: "delta", text: e.delta.text });
        }
      } else if (ev.type === "assistant") {
        for (const block of ev.message?.content || []) {
          if (block.type === "tool_use" && !chips.has(block.id)) {
            const { summary } = describeToolCall(block.name, block.input);
            chips.set(block.id, summary);
            emit({ type: "tool", id: block.id, summary, status: "running" });
          }
        }
      } else if (ev.type === "user") {
        const content = Array.isArray(ev.message?.content) ? ev.message.content : [];
        for (const block of content) {
          if (block.type === "tool_result" && chips.has(block.tool_use_id)) {
            emit({ type: "tool", id: block.tool_use_id, summary: chips.get(block.tool_use_id), status: block.is_error ? "failed" : "done" });
          }
        }
      } else if (ev.type === "result") {
        if (ev.is_error || (ev.subtype && ev.subtype !== "success")) {
          failure = ev.result || ev.subtype;
        } else if (!gotText && ev.result) {
          emit({ type: "delta", text: ev.result });
        }
      }
    }

    const code = await new Promise((resolve) => {
      proc.on("error", (e) => {
        failure = e.message;
        resolve(null);
      });
      proc.on("close", resolve);
    });
    if (stopped) return;
    if (failure || code !== 0) throw new Error(friendly(failure || stderr.trim() || `Claude Code stopped (code ${code}).`));
  }

  function friendly(text) {
    if (/log ?in|not logged|authenticat|\/login|oauth/i.test(text)) {
      return "Claude Code isn't logged in. Open a terminal, type claude, press Enter and log in with your Claude account, then try again.";
    }
    if (/usage limit|rate limit|limit reached|quota/i.test(text)) {
      return `You've hit your Claude plan's usage limit for now. ${text}`;
    }
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
  }

  function stop() {
    if (!child) return;
    stopped = true;
    if (IS_WINDOWS) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else child.kill("SIGINT");
  }

  return {
    kind: "claude-code",
    handle,
    stop,
    async reset() {
      sessionId = null;
    },
    get busy() {
      return running;
    },
  };
}
