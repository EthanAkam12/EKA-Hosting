// Jarvis: tool checks, the page's protection against other websites, and a
// whole request (Claude asks for a command, the user approves, the answer
// comes back) against a stand-in for the Claude API.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getTool, needsConfirmation, validateInput, toolDefinitions } from "../jarvis/tools.js";

test("tool inputs are checked against their schema", () => {
  const run = getTool("run_command");
  assert.equal(validateInput(run, { command: "dir", why: "list" }), null);
  assert.match(validateInput(run, { command: "dir" }), /why/);
  assert.match(validateInput(run, { command: 5, why: "x" }), /string/);
  assert.match(validateInput(getTool("media"), { action: "explode" }), /one of/);
  assert.match(validateInput(run, null), /object/);
});

test("risky tools need approval unless auto-approve is on", () => {
  assert.equal(needsConfirmation(getTool("run_command"), {}, false), true);
  assert.equal(needsConfirmation(getTool("run_command"), {}, true), false);
  assert.equal(needsConfirmation(getTool("write_file"), {}, false), true);
  assert.equal(needsConfirmation(getTool("open"), { target: "https://example.com" }, false), false);
  assert.equal(needsConfirmation(getTool("open"), { target: "C:\\Users\\me\\setup.EXE" }, false), true);
  assert.equal(needsConfirmation(getTool("screenshot"), {}, false), false);
});

test("tool definitions sent to Claude carry no local fields", () => {
  for (const def of toolDefinitions()) {
    assert.deepEqual(Object.keys(def).sort(), ["description", "eager_input_streaming", "input_schema", "name"]);
  }
});

// ---------- a stand-in Claude API ----------

function sse(res, events) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  res.end();
}
function start(id) {
  return ["message_start", { message: { id, type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } }];
}

function fakeClaude() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const json = JSON.parse(body);
      requests.push(json);
      const last = json.messages[json.messages.length - 1];
      const isToolResult = Array.isArray(last.content) && last.content[0]?.type === "tool_result";
      if (!isToolResult) {
        const input = JSON.stringify({ command: "echo hello-from-jarvis", why: "Say hello" });
        sse(res, [
          start("msg_1"),
          ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }],
          ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "Right away. " } }],
          ["content_block_stop", { index: 0 }],
          ["content_block_start", { index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "run_command", input: {} } }],
          ["content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: input.slice(0, 10) } }],
          ["content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: input.slice(10) } }],
          ["content_block_stop", { index: 1 }],
          ["message_delta", { delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } }],
          ["message_stop", {}],
        ]);
      } else {
        sse(res, [
          start("msg_2"),
          ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }],
          ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "Done, sir." } }],
          ["content_block_stop", { index: 0 }],
          ["message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }],
          ["message_stop", {}],
        ]);
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, requests, port: server.address().port })));
}

async function startJarvis(env) {
  const child = spawn(process.execPath, ["jarvis/server.js"], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Jarvis didn't start:\n${out}`)), 10_000);
    const on = (d) => {
      out += d;
      if (out.includes("online")) { clearTimeout(t); resolve(); }
    };
    child.stdout.on("data", on);
    child.stderr.on("data", on);
  });
  return child;
}

test("a whole request: tool call, approval, result, answer", { skip: process.platform === "win32" }, async (t) => {
  const claude = await fakeClaude();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-test-"));
  const port = 32000 + Math.floor(Math.random() * 1000);
  const jarvis = await startJarvis({
    ANTHROPIC_API_KEY: "sk-ant-test",
    JARVIS_BRAIN: "api",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${claude.port}`,
    JARVIS_PORT: String(port),
    JARVIS_DATA: dataDir,
    JARVIS_AUTO_APPROVE: "no",
  });
  t.after(async () => {
    jarvis.kill();
    claude.server.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const origin = `http://localhost:${port}`;

  // Other websites can't send Jarvis anything.
  let res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: '{"text":"hi"}' });
  assert.equal(res.status, 403);
  res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"text":"hi"}' });
  assert.equal(res.status, 403);

  res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ text: "say hello in the terminal" }) });
  assert.equal(res.status, 200);
  const events = [];
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const ev = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      events.push(ev);
      if (ev.type === "confirm") {
        assert.equal(ev.detail, "echo hello-from-jarvis");
        const ok = await fetch(`${base}/api/confirm`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ id: ev.id, approve: true }) });
        assert.equal(ok.status, 200);
      }
    }
  }

  const text = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
  assert.equal(text, "Right away. Done, sir.");
  assert.ok(events.some((e) => e.type === "tool" && e.status === "done"));
  assert.equal(events.at(-1).type, "done");

  // The command really ran, and its output went back to Claude.
  assert.equal(claude.requests.length, 2);
  const toolResult = claude.requests[1].messages.at(-1).content[0];
  assert.equal(toolResult.type, "tool_result");
  assert.match(toolResult.content, /hello-from-jarvis/);
  // The reply was kept whole (text + tool call) in the history.
  assert.deepEqual(claude.requests[1].messages[1].content.map((b) => b.type), ["text", "tool_use"]);
});

// ---------- through Claude Code (the user's Claude plan, no API key) ----------

async function chat(base, origin, text, approve) {
  const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ text }) });
  assert.equal(res.status, 200);
  const events = [];
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const ev = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      events.push(ev);
      if (ev.type === "confirm") {
        await fetch(`${base}/api/confirm`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ id: ev.id, approve }) });
      }
    }
  }
  return events;
}

test("Claude Code: permission prompts become approval cards, Jarvis tools work, the conversation resumes", { skip: process.platform === "win32" }, async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-cc-"));
  const logFile = path.join(dataDir, "claude-args.log");
  const port = 33000 + Math.floor(Math.random() * 1000);
  const jarvis = await startJarvis({
    ANTHROPIC_API_KEY: "",
    JARVIS_BRAIN: "claude-code",
    JARVIS_CLAUDE_PATH: path.resolve("test/fixtures/fake-claude.mjs"),
    FAKE_CLAUDE_LOG: logFile,
    JARVIS_PORT: String(port),
    JARVIS_DATA: dataDir,
    JARVIS_AUTO_APPROVE: "no",
  });
  t.after(async () => {
    jarvis.kill();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const origin = `http://localhost:${port}`;

  // The helper's private door is shut to everyone else.
  const denied = await fetch(`${base}/api/internal/call`, { method: "POST", headers: { "Content-Type": "application/json", "X-Jarvis-Token": "guess" }, body: '{"name":"system_status"}' });
  assert.equal(denied.status, 403);

  const info = await (await fetch(`${base}/api/info`)).json();
  assert.equal(info.brain, "claude-code");

  let events = await chat(base, origin, "hello there", true);
  const confirm = events.find((e) => e.type === "confirm");
  assert.equal(confirm.summary, "Say hi");
  assert.equal(confirm.detail, "echo hi");
  assert.equal(events.filter((e) => e.type === "delta").map((e) => e.text).join(""), "You said: hello there. Ran it.");
  assert.ok(events.some((e) => e.type === "tool" && e.summary === "Remember: Likes tea" && e.status === "done"));
  assert.equal(events.at(-1).type, "done");
  const memoryFile = JSON.parse(await fs.readFile(path.join(dataDir, "memory.json"), "utf8"));
  assert.deepEqual(memoryFile, [{ fact: "Likes tea" }]);

  events = await chat(base, origin, "again", false);
  assert.match(events.filter((e) => e.type === "delta").map((e) => e.text).join(""), /Skipped it\.$/);

  const runs = (await fs.readFile(logFile, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(runs.length, 2);
  assert.ok(!runs[0].includes("--resume"));
  assert.equal(runs[1][runs[1].indexOf("--resume") + 1], "sess-123");
  assert.equal(runs[0][runs[0].indexOf("--permission-prompt-tool") + 1], "mcp__jarvis__approve");
  // What Jarvis knows about the user is passed along to Claude Code.
  const personaFile = runs[1][runs[1].indexOf("--append-system-prompt-file") + 1];
  assert.match(await fs.readFile(personaFile, "utf8"), /Likes tea/);
});
