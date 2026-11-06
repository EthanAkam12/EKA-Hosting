// A tiny MCP server that Claude Code starts for Jarvis. It offers Jarvis's PC
// tools (screenshots, volume, typing, reminders, memory…) to Claude Code and
// passes each call on to the running Jarvis server, which does the work and
// shows the Approve / Deny card when one is needed.
//
// It also provides the "approve" tool that Claude Code asks before running a
// command or changing a file (--permission-prompt-tool mcp__jarvis__approve).
//
// MCP over stdio: one JSON-RPC message per line on stdin/stdout.

import readline from "node:readline";
import { TOOLS } from "./tools.js";

const JARVIS_URL = process.env.JARVIS_URL;
const TOKEN = process.env.JARVIS_INTERNAL_TOKEN;

const toolList = [
  ...TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })),
  {
    name: "approve",
    description: "Used by Jarvis itself to ask the user for permission. Don't call it directly.",
    inputSchema: {
      type: "object",
      properties: { tool_name: { type: "string" }, input: { type: "object" }, tool_use_id: { type: "string" } },
      required: ["tool_name", "input"],
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

async function callJarvis(name, args) {
  const res = await fetch(`${JARVIS_URL}/api/internal/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Jarvis-Token": TOKEN },
    body: JSON.stringify({ name, arguments: args || {} }),
  });
  if (!res.ok) throw new Error(`Jarvis answered ${res.status}`);
  return res.json(); // { content: [...], isError? } in MCP's shape
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // a notification, e.g. notifications/initialized
  try {
    if (method === "initialize") {
      return send({
        id,
        result: {
          protocolVersion: params?.protocolVersion || "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "jarvis", version: "1.0.0" },
        },
      });
    }
    if (method === "ping") return send({ id, result: {} });
    if (method === "tools/list") return send({ id, result: { tools: toolList } });
    if (method === "tools/call") {
      return send({ id, result: await callJarvis(params.name, params.arguments) });
    }
    send({ id, error: { code: -32601, message: `Unknown method ${method}` } });
  } catch (err) {
    if (method === "tools/call") {
      send({ id, result: { content: [{ type: "text", text: `Failed: ${err.message}` }], isError: true } });
    } else {
      send({ id, error: { code: -32603, message: err.message } });
    }
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  handle(msg);
});
