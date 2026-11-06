// The conversation with Claude: sends what the user said, runs the tools
// Claude asks for, and repeats until Claude has a final answer.

import Anthropic from "@anthropic-ai/sdk";
import os from "node:os";
import { getTool, needsConfirmation, toolDefinitions, validateInput } from "./tools.js";

const MAX_STEPS = 30; // tool rounds per request, so a confused loop can't run forever

const SERVER_TOOLS = [
  { type: "web_search_20260209", name: "web_search", max_uses: 5 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5 },
];

function systemPrompt({ callMe, userName, memoryFacts }) {
  const platform = { win32: "Windows", darwin: "macOS", linux: "Linux" }[process.platform] || process.platform;
  return `You are JARVIS, a personal AI assistant running on the user's own computer, in the spirit of Tony Stark's butler AI: calm, capable, quietly witty, loyal, and a step ahead.

Address the user as "${callMe}"${userName ? ` (their name is ${userName})` : ""}.

How you talk:
- Your replies are usually read aloud, so write the way you'd speak: short, natural sentences, no markdown, no bullet lists, no code blocks unless the user asks to see code or a list. One to three sentences is typical.
- Give the answer or the result, not a description of your process. A dry remark is welcome now and then; don't overdo it.
- If a request is ambiguous and getting it wrong would matter, ask one short question. Otherwise just do it.

What you can do:
- You control this computer through your tools: run commands, open apps, sites, files and folders, type and press keys, take screenshots to see the screen, control media and volume, read and write files, use the clipboard, set reminders, search the web, and remember things about the user.
- The computer is ${os.hostname()}, running ${platform}. The user's home folder is ${os.homedir()}. ${process.platform === "win32" ? "Commands run in Windows PowerShell 5.1 (use PowerShell syntax; use winget to install software)." : "Commands run in bash."}
- Prefer a dedicated tool (open, media, system_status…) over run_command when one fits.
- Run commands, file writes and program launches only when the user asked for them or they are clearly needed. The user sees and approves those; if they deny one, accept it and don't retry it another way.
- Before anything destructive or hard to undo (deleting files, shutting down, uninstalling, sending something on the user's behalf), say exactly what will happen.
- After doing something visible, a screenshot is a good way to check it worked when you're unsure.
- Use remember when the user tells you something worth knowing next time (their name, preferences, where things are).

What you remember about the user from earlier conversations:
${memoryFacts.length ? memoryFacts.map((f) => `- ${f}`).join("\n") : "(nothing yet)"}`;
}

export function createBrain({ model, effort, callMe, userName, autoApprove, memory, reminders }) {
  const client = new Anthropic();
  let messages = [];
  let system = null;
  let busy = null; // AbortController of the request in progress

  async function reset() {
    messages = [];
    system = null;
  }

  // emit(event) sends progress to the browser; confirm(request) resolves to true/false.
  async function handle(userText, { emit, confirm }) {
    if (busy) throw new Error("I'm still working on the last request.");
    const abort = new AbortController();
    busy = abort;
    try {
      // The instructions are fixed for a whole conversation so the prompt cache keeps working.
      if (!system) {
        system = systemPrompt({ callMe, userName, memoryFacts: await memory.list() });
      }
      messages.push({ role: "user", content: [{ type: "text", text: `${userText}\n\n(Current time: ${new Date().toString()})` }] });

      for (let step = 0; step < MAX_STEPS; step++) {
        emit({ type: "status", state: "thinking" });
        const stream = client.beta.messages.stream(
          {
            model,
            max_tokens: 64000,
            system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
            tools: [...toolDefinitions(), ...SERVER_TOOLS],
            messages,
            cache_control: { type: "ephemeral" },
            output_config: { effort },
            // If a safety check declines a request, let the API retry it on
            // Anthropic's recommended fallback model instead of failing.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          },
          { signal: abort.signal },
        );
        stream.on("text", (delta) => emit({ type: "delta", text: delta }));
        const message = await stream.finalMessage();

        if (message.stop_reason === "refusal") {
          emit({ type: "delta", text: `\nI'm afraid I can't help with that one, ${callMe}.` });
          // The declined turn isn't kept, so the next request starts clean.
          messages.pop();
          return;
        }
        if (message.stop_reason === "max_tokens") {
          messages.pop();
          throw new Error("That answer ran too long and got cut off. Try asking for something smaller.");
        }

        // Keep the whole reply (thinking, text, tool calls) exactly as it came.
        messages.push({ role: "assistant", content: message.content });

        if (message.stop_reason === "pause_turn") continue; // a long web search; let it carry on
        const calls = message.content.filter((b) => b.type === "tool_use");
        if (message.stop_reason !== "tool_use" || calls.length === 0) return;

        const results = [];
        for (const call of calls) {
          results.push(await runTool(call, { emit, confirm, signal: abort.signal }));
        }
        messages.push({ role: "user", content: results });
        if (abort.signal.aborted) return;
      }
      emit({ type: "delta", text: "\nI've stopped there: that was a lot of steps. Tell me if you'd like me to carry on." });
    } catch (err) {
      if (abort.signal.aborted) return;
      throw err;
    } finally {
      busy = null;
      // A request stopped half-way can leave tool calls without results; answer
      // them so the conversation stays valid for the next message.
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") {
        const open = last.content.filter((b) => b.type === "tool_use");
        if (open.length) {
          messages.push({
            role: "user",
            content: open.map((b) => ({ type: "tool_result", tool_use_id: b.id, content: "Stopped by the user.", is_error: true })),
          });
        }
      }
    }
  }

  async function runTool(call, { emit, confirm, signal }) {
    const tool = getTool(call.name);
    const fail = (text) => ({ type: "tool_result", tool_use_id: call.id, content: text, is_error: true });
    if (!tool) return fail(`There is no tool called ${call.name}.`);
    if (signal.aborted) return fail("Stopped by the user.");
    const problem = validateInput(tool, call.input);
    if (problem) return fail(`Invalid input: ${problem} Try again with the full input.`);

    const summary = tool.summary ? tool.summary(call.input) : call.name;
    if (needsConfirmation(tool, call.input, autoApprove)) {
      emit({ type: "status", state: "waiting" });
      const ok = await confirm({ id: call.id, tool: call.name, summary, detail: tool.detail?.(call.input) || "" });
      if (!ok) {
        emit({ type: "tool", id: call.id, summary, status: "denied" });
        return fail("The user denied this. Don't try it another way unless they ask.");
      }
    }
    emit({ type: "tool", id: call.id, summary, status: "running" });
    try {
      const output = await tool.run(call.input, { memory, reminders });
      emit({ type: "tool", id: call.id, summary, status: "done" });
      return { type: "tool_result", tool_use_id: call.id, content: output };
    } catch (err) {
      emit({ type: "tool", id: call.id, summary, status: "failed" });
      return fail(`Failed: ${err.message}`);
    }
  }

  function stop() {
    busy?.abort();
  }

  return { handle, reset, stop, get busy() { return Boolean(busy); } };
}
