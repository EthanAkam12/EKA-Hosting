// What Jarvis can do on this computer. Each tool has a definition that is sent
// to Claude and a run() that does the work here, on the user's PC.
//
// Tools marked `confirm` (running commands, writing files, starting programs)
// wait for the user to click Approve in the Jarvis window first, unless
// JARVIS_AUTO_APPROVE=yes is set in jarvis-settings.txt.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const IS_WINDOWS = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const MAX_OUTPUT = 20_000; // characters of command output sent back to Claude
const MAX_READ = 100_000; // characters of a file sent back to Claude

// ---------- helpers ----------

function clip(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (cut off: ${text.length - max} more characters)`;
}

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Runs a program and collects its output. Never throws for a non-zero exit;
// the exit code goes back to Claude so it can decide what to do.
export function runProcess(file, args, { timeoutMs = 60_000, input, cwd } = {}) {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let settled = false;
    const child = spawn(file, args, { cwd: cwd || os.homedir(), windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      finish(null, `Stopped after ${Math.round(timeoutMs / 1000)} seconds.`);
    }, timeoutMs);
    function finish(code, note) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: out, stderr: err, note });
    }
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => finish(null, e.message));
    child.on("close", (code) => finish(code));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

// PowerShell scripts are passed base64-encoded (UTF-16LE), so quotes and
// special characters in them never need escaping.
function powershell(script, opts) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return runProcess("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], opts);
}

// A PowerShell single-quoted string literal.
function psString(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function formatResult({ code, stdout, stderr, note }) {
  const parts = [];
  if (note) parts.push(note);
  parts.push(`Exit code: ${code ?? "none"}`);
  if (stdout.trim()) parts.push(`Output:\n${stdout.trim()}`);
  if (stderr.trim()) parts.push(`Errors:\n${stderr.trim()}`);
  return clip(parts.join("\n"), MAX_OUTPUT);
}

function windowsOnly(what) {
  if (!IS_WINDOWS) throw new Error(`${what} only works on Windows for now. Use run_command instead.`);
}

// ---------- the tools ----------

const RISKY_OPEN = /\.(exe|bat|cmd|ps1|vbs|js|msi|scr|com|lnk|reg|sh|app)$/i;

export const TOOLS = [
  {
    name: "run_command",
    confirm: true,
    description:
      `Run a shell command on the user's computer and get its output. On Windows this is PowerShell; on Mac/Linux it is bash. ` +
      `Use it for anything the other tools don't cover: managing files and folders, starting or stopping programs, ` +
      `checking network or disk, changing settings, git, installing software (winget), shutting down or restarting, and so on. ` +
      `Commands time out after 60 seconds, so start long-running programs in the background (Start-Process on Windows). ` +
      `The user is shown the command and must approve it before it runs.`,
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command or short script to run." },
        why: { type: "string", description: "One short sentence for the user saying what this does." },
      },
      required: ["command", "why"],
    },
    summary: (i) => i.why,
    detail: (i) => i.command,
    async run({ command }) {
      const result = IS_WINDOWS
        ? await powershell(`$ProgressPreference='SilentlyContinue'\n${command}`)
        : await runProcess("bash", ["-lc", command]);
      return formatResult(result);
    },
  },
  {
    name: "open",
    description:
      "Open a website, file, folder or program the way double-clicking it would. " +
      "Accepts a URL (https://…), a path, or a program name Windows knows (notepad, calc, spotify:, ms-settings:, explorer, chrome, code).",
    input_schema: {
      type: "object",
      properties: { target: { type: "string", description: "URL, path, or program name." } },
      required: ["target"],
    },
    // Opening a script or program file runs it, so that needs approval.
    confirm: (i) => {
      const target = String(i.target).trim();
      return !/^https?:\/\//i.test(target) && RISKY_OPEN.test(target);
    },
    summary: (i) => `Open ${i.target}`,
    detail: (i) => i.target,
    async run({ target }) {
      target = expandHome(target.trim());
      const result = IS_WINDOWS
        ? await powershell(`Start-Process ${psString(target)}`, { timeoutMs: 15_000 })
        : await runProcess(IS_MAC ? "open" : "xdg-open", [target], { timeoutMs: 15_000 });
      if (result.code !== 0) return formatResult(result);
      return `Opened ${target}.`;
    },
  },
  {
    name: "screenshot",
    description:
      "Take a screenshot of the user's screen and look at it. Use it when the user asks what's on screen, " +
      "to read an error message they're seeing, or to check that something worked.",
    input_schema: { type: "object", properties: {} },
    summary: () => "Look at the screen",
    async run() {
      const file = path.join(os.tmpdir(), `jarvis-screen-${Date.now()}.jpg`);
      try {
        if (IS_WINDOWS) {
          // Capture every monitor, shrink to at most 1600px wide, save as JPEG.
          const r = await powershell(
            `Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$scale = [Math]::Min(1, 1600 / $b.Width)
$w = [int]($b.Width * $scale); $h = [int]($b.Height * $scale)
$small = New-Object System.Drawing.Bitmap $bmp, $w, $h
$small.Save(${psString(file)}, [System.Drawing.Imaging.ImageFormat]::Jpeg)`,
            { timeoutMs: 20_000 },
          );
          if (r.code !== 0) throw new Error(formatResult(r));
        } else if (IS_MAC) {
          const r = await runProcess("screencapture", ["-x", "-t", "jpg", file]);
          if (r.code !== 0) throw new Error(formatResult(r));
        } else {
          const r = await runProcess("bash", ["-lc", `gnome-screenshot -f '${file}' || import -window root '${file}' || scrot '${file}'`]);
          if (r.code !== 0) throw new Error(formatResult(r));
        }
        const data = (await fs.readFile(file)).toString("base64");
        return [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }];
      } finally {
        fs.rm(file, { force: true }).catch(() => {});
      }
    },
  },
  {
    name: "type_text",
    description:
      "Type text into whatever window is active, as if on the keyboard. Open or focus the right window first. " +
      "Windows only.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    summary: (i) => `Type “${clip(i.text, 60)}”`,
    async run({ text }) {
      windowsOnly("Typing");
      // SendKeys treats + ^ % ~ ( ) { } [ ] as special; wrap each in braces.
      const escaped = text.replace(/[+^%~(){}[\]]/g, "{$&}").replace(/\r?\n/g, "{ENTER}");
      const r = await powershell(`Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.SendKeys]::SendWait(${psString(escaped)})`);
      return r.code === 0 ? "Typed it." : formatResult(r);
    },
  },
  {
    name: "press_keys",
    description:
      "Press a keyboard shortcut in the active window, using .NET SendKeys codes: ^ is Ctrl, % is Alt, + is Shift, " +
      "{ENTER} {TAB} {ESC} {F5} {LEFT} etc. Examples: '^s' saves, '%{F4}' closes the window, '^+{ESC}' opens Task Manager. " +
      "For the Windows key use run_command instead. Windows only.",
    input_schema: {
      type: "object",
      properties: { keys: { type: "string" } },
      required: ["keys"],
    },
    summary: (i) => `Press ${i.keys}`,
    async run({ keys }) {
      windowsOnly("Key presses");
      const r = await powershell(`Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.SendKeys]::SendWait(${psString(keys)})`);
      return r.code === 0 ? `Pressed ${keys}.` : formatResult(r);
    },
  },
  {
    name: "media",
    description: "Control volume and music/video playback: volume_up, volume_down, mute, play_pause, next, previous.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["volume_up", "volume_down", "mute", "play_pause", "next", "previous"] },
        times: { type: "integer", description: "How many presses, for volume (each is 2%). Default 5." },
      },
      required: ["action"],
    },
    summary: (i) => `Media: ${i.action.replace("_", " ")}`,
    async run({ action, times = 5 }) {
      const n = action.startsWith("volume_") ? Math.max(1, Math.min(50, times)) : 1;
      if (IS_WINDOWS) {
        const key = { volume_up: 175, volume_down: 174, mute: 173, play_pause: 179, next: 176, previous: 177 }[action];
        const r = await powershell(`$w = New-Object -ComObject WScript.Shell\n1..${n} | ForEach-Object { $w.SendKeys([char]${key}) }`);
        return r.code === 0 ? "Done." : formatResult(r);
      }
      if (IS_MAC) {
        const script = {
          volume_up: `set volume output volume ((output volume of (get volume settings)) + ${2 * n})`,
          volume_down: `set volume output volume ((output volume of (get volume settings)) - ${2 * n})`,
          mute: "set volume output muted (not (output muted of (get volume settings)))",
          play_pause: 'tell application "Music" to playpause',
          next: 'tell application "Music" to next track',
          previous: 'tell application "Music" to previous track',
        }[action];
        return formatResult(await runProcess("osascript", ["-e", script]));
      }
      const cmd = {
        volume_up: `pactl set-sink-volume @DEFAULT_SINK@ +${2 * n}%`,
        volume_down: `pactl set-sink-volume @DEFAULT_SINK@ -${2 * n}%`,
        mute: "pactl set-sink-mute @DEFAULT_SINK@ toggle",
        play_pause: "playerctl play-pause",
        next: "playerctl next",
        previous: "playerctl previous",
      }[action];
      return formatResult(await runProcess("bash", ["-lc", cmd]));
    },
  },
  {
    name: "system_status",
    description: "Get the computer's status: date and time, CPU use, memory, battery, disk space, uptime and computer name.",
    input_schema: { type: "object", properties: {} },
    summary: () => "Check the system",
    async run() {
      const sample = () => os.cpus().map((c) => c.times);
      const a = sample();
      await new Promise((r) => setTimeout(r, 300));
      const b = sample();
      let idle = 0;
      let total = 0;
      b.forEach((t, i) => {
        const d = Object.fromEntries(Object.keys(t).map((k) => [k, t[k] - a[i][k]]));
        idle += d.idle;
        total += Object.values(d).reduce((x, y) => x + y, 0);
      });
      const gb = (n) => `${(n / 1024 ** 3).toFixed(1)} GB`;
      const lines = [
        `Time: ${new Date().toString()}`,
        `Computer: ${os.hostname()} (${os.type()} ${os.release()}, ${os.cpus().length} CPU threads)`,
        `CPU use: ${total ? Math.round(100 * (1 - idle / total)) : "?"}%`,
        `Memory: ${gb(os.totalmem() - os.freemem())} used of ${gb(os.totalmem())}`,
        `Up for: ${Math.round(os.uptime() / 3600)} hours`,
      ];
      if (IS_WINDOWS) {
        const r = await powershell(
          `$b = Get-CimInstance Win32_Battery | Select-Object -First 1
if ($b) { "Battery: $($b.EstimatedChargeRemaining)% $(if ($b.BatteryStatus -eq 2) {'(charging)'} else {''})" }
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { "Disk $($_.DeviceID) $([math]::Round($_.FreeSpace/1GB,1)) GB free of $([math]::Round($_.Size/1GB,1)) GB" }`,
          { timeoutMs: 15_000 },
        );
        if (r.stdout.trim()) lines.push(r.stdout.trim());
      } else {
        const r = await runProcess("bash", ["-lc", IS_MAC ? "pmset -g batt | tail -1; df -h / | tail -1" : "df -h / | tail -1"]);
        if (r.stdout.trim()) lines.push(r.stdout.trim());
      }
      return lines.join("\n");
    },
  },
  {
    name: "list_folder",
    description: "List what's in a folder (names, sizes, dates). ~ means the user's home folder, e.g. ~/Desktop or ~/Downloads.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    summary: (i) => `Look in ${i.path}`,
    async run({ path: p }) {
      const dir = path.resolve(expandHome(p));
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const rows = await Promise.all(
        entries.slice(0, 500).map(async (e) => {
          const full = path.join(dir, e.name);
          const st = await fs.stat(full).catch(() => null);
          if (e.isDirectory()) return `[folder] ${e.name}`;
          return `${e.name}  ${st ? `${Math.ceil(st.size / 1024)} KB, ${st.mtime.toISOString().slice(0, 16).replace("T", " ")}` : ""}`;
        }),
      );
      const more = entries.length > 500 ? `\n… and ${entries.length - 500} more` : "";
      return `${dir}\n${rows.join("\n") || "(empty)"}${more}`;
    },
  },
  {
    name: "read_file",
    description: "Read a text file (notes, code, logs, CSV…). ~ means the user's home folder.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    summary: (i) => `Read ${path.basename(i.path)}`,
    async run({ path: p }) {
      const text = await fs.readFile(path.resolve(expandHome(p)), "utf8");
      return clip(text, MAX_READ);
    },
  },
  {
    name: "write_file",
    confirm: true,
    description: "Create or overwrite a text file. ~ means the user's home folder. The user approves it first.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    summary: (i) => `Write ${i.path}`,
    detail: (i) => clip(i.content, 2000),
    async run({ path: p, content }) {
      const file = path.resolve(expandHome(p));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content, "utf8");
      return `Saved ${file} (${content.length} characters).`;
    },
  },
  {
    name: "clipboard",
    description: "Read what's on the clipboard, or put text on it.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "set"] },
        text: { type: "string", description: "For set: the text to copy." },
      },
      required: ["action"],
    },
    summary: (i) => (i.action === "get" ? "Read the clipboard" : "Copy to the clipboard"),
    async run({ action, text = "" }) {
      if (IS_WINDOWS) {
        const r = action === "get" ? await powershell("Get-Clipboard -Raw") : await powershell(`Set-Clipboard -Value ${psString(text)}`);
        return action === "get" ? clip(r.stdout || "(the clipboard is empty)", MAX_READ) : r.code === 0 ? "Copied." : formatResult(r);
      }
      if (IS_MAC) {
        const r = action === "get" ? await runProcess("pbpaste", []) : await runProcess("pbcopy", [], { input: text });
        return action === "get" ? clip(r.stdout || "(the clipboard is empty)", MAX_READ) : "Copied.";
      }
      const r = action === "get" ? await runProcess("bash", ["-lc", "xclip -o -selection clipboard"]) : await runProcess("bash", ["-lc", "xclip -selection clipboard"], { input: text });
      return action === "get" ? clip(r.stdout || "(the clipboard is empty)", MAX_READ) : "Copied.";
    },
  },
  {
    name: "remember",
    description:
      "Save something to long-term memory so you know it in future conversations: the user's name and preferences, " +
      "where their projects live, people they mention, how they like things done. Keep each fact short.",
    input_schema: {
      type: "object",
      properties: { fact: { type: "string" } },
      required: ["fact"],
    },
    summary: (i) => `Remember: ${i.fact}`,
    async run({ fact }, ctx) {
      await ctx.memory.add(fact);
      return "Saved to memory.";
    },
  },
  {
    name: "forget",
    description: "Remove facts from long-term memory that contain the given words (case doesn't matter).",
    input_schema: {
      type: "object",
      properties: { contains: { type: "string" } },
      required: ["contains"],
    },
    summary: (i) => `Forget “${i.contains}”`,
    async run({ contains }, ctx) {
      const n = await ctx.memory.forget(contains);
      return n ? `Removed ${n} fact(s).` : "Nothing in memory matched.";
    },
  },
  {
    name: "set_reminder",
    description: "Set a timer or reminder. When it's due, Jarvis says the message out loud and shows a notification.",
    input_schema: {
      type: "object",
      properties: {
        minutes: { type: "number", description: "Minutes from now (can be a fraction, e.g. 0.5)." },
        message: { type: "string", description: "What to say when it's due." },
      },
      required: ["minutes", "message"],
    },
    summary: (i) => `Reminder in ${i.minutes} min: ${i.message}`,
    async run({ minutes, message }, ctx) {
      const due = ctx.reminders.add(minutes, message);
      return `Reminder set for ${due.toLocaleTimeString()}.`;
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function getTool(name) {
  return BY_NAME.get(name);
}

export function needsConfirmation(tool, input, autoApprove) {
  if (autoApprove) return false;
  return typeof tool.confirm === "function" ? Boolean(tool.confirm(input)) : Boolean(tool.confirm);
}

// Tool inputs stream in as they are written, so the API doesn't check them
// against the schema; check the required fields and their types here.
export function validateInput(tool, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "The tool input was not an object.";
  const { properties = {}, required = [] } = tool.input_schema;
  for (const key of required) {
    if (input[key] === undefined || input[key] === null) return `Missing "${key}".`;
  }
  for (const [key, value] of Object.entries(input)) {
    const spec = properties[key];
    if (!spec) continue;
    const ok =
      spec.type === "string" ? typeof value === "string"
      : spec.type === "integer" ? Number.isInteger(value)
      : spec.type === "number" ? typeof value === "number" && Number.isFinite(value)
      : true;
    if (!ok) return `"${key}" should be a ${spec.type}.`;
    if (spec.enum && !spec.enum.includes(value)) return `"${key}" should be one of: ${spec.enum.join(", ")}.`;
  }
  return null;
}

// The tool list as sent to Claude (without our local fields).
export function toolDefinitions() {
  return TOOLS.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
    eager_input_streaming: true,
  }));
}
