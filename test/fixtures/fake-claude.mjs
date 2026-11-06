#!/usr/bin/env node
// Stands in for the `claude` program in tests: starts the MCP servers from
// --mcp-config like Claude Code does, asks the permission tool about a Bash
// command, calls one of Jarvis's tools, and prints stream-json events.
import { spawn } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";

const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(args) + "\n");

const prompt = fs.readFileSync(0, "utf8");
const config = JSON.parse(fs.readFileSync(flag("--mcp-config"), "utf8")).mcpServers.jarvis;
const mcp = spawn(config.command, config.args, { env: { ...process.env, ...config.env }, stdio: ["pipe", "pipe", "inherit"] });
const waiting = new Map();
let nextId = 1;
readline.createInterface({ input: mcp.stdout }).on("line", (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
const rpc = (method, params) => new Promise((resolve) => { const id = nextId++; waiting.set(id, resolve); mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const out = (e) => process.stdout.write(JSON.stringify({ session_id: "sess-123", parent_tool_use_id: null, ...e }) + "\n");
const say = (text) => out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });

await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "1" } });
const { result: list } = await rpc("tools/list", {});
out({ type: "system", subtype: "init", tools: list.tools.map((t) => `mcp__jarvis__${t.name}`) });
say(`You said: ${prompt.trim()}. `);

const bash = { command: "echo hi", description: "Say hi" };
out({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu_1", name: "Bash", input: bash }] } });
const perm = await rpc("tools/call", { name: "approve", arguments: { tool_name: "Bash", input: bash, tool_use_id: "tu_1" } });
const decision = JSON.parse(perm.result.content[0].text);
out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_1", is_error: decision.behavior !== "allow", content: "hi" }] } });

out({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu_2", name: "mcp__jarvis__remember", input: { fact: "Likes tea" } }] } });
const r = await rpc("tools/call", { name: "remember", arguments: { fact: "Likes tea" } });
out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_2", content: r.result.content } ] } });

say(decision.behavior === "allow" ? "Ran it." : "Skipped it.");
out({ type: "result", subtype: "success", is_error: false, result: "done" });
mcp.kill();
