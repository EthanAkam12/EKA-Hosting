import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenAiCompatibleProvider } from "../server/ai/openai-compatible.js";

test("chat-completions providers: request shape, answer, limits", async () => {
  let sent;
  const fetchImpl = async (url, opts) => { sent = { url, opts, body: JSON.parse(opts.body) }; return new Response(JSON.stringify({ model: "gemini-2.5-flash", choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 }); };
  const p = createOpenAiCompatibleProvider({ kind: "gemini", env: { AI_API_KEY: "k" }, fetchImpl });
  assert.equal(await p.complete({ system: "S", prompt: [{ text: "A", cache: true }, { text: "B" }] }), "{\"ok\":true}");
  assert.match(sent.url, /generativelanguage\.googleapis\.com\/v1beta\/openai\/chat\/completions$/);
  assert.equal(sent.opts.headers.Authorization, "Bearer k");
  assert.deepEqual(sent.body.messages, [{ role: "system", content: "S" }, { role: "user", content: "A\n\nB" }]);
  const limited = createOpenAiCompatibleProvider({ kind: "groq", env: { AI_API_KEY: "k" }, fetchImpl: async () => new Response(JSON.stringify({ error: { message: "Rate limit" } }), { status: 429 }) });
  await assert.rejects(limited.complete({ system: "S", prompt: "x" }), /limit/);
  assert.throws(() => createOpenAiCompatibleProvider({ kind: "groq", env: {} }), /AI_API_KEY/);
  assert.equal(createOpenAiCompatibleProvider({ kind: "ollama", env: {} }).model, "qwen2.5:14b");
});
