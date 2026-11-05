// Providers that speak the common "chat completions" format: Google Gemini
// (which has a free tier), Groq (free tier), OpenRouter, OpenAI, and AI
// running on your own computer with Ollama or LM Studio (free, but needs a
// powerful machine). Only turns (system, prompt) into text, like ./anthropic.js.
//
//   AI_PROVIDER=gemini   AI_API_KEY=...            (key from aistudio.google.com)
//   AI_PROVIDER=groq     AI_API_KEY=...            (key from console.groq.com)
//   AI_PROVIDER=ollama                             (Ollama running on this computer)
//   AI_PROVIDER=openai-compatible AI_BASE_URL=... AI_API_KEY=... AI_MODEL=...

import { recordUsage, setModelPrice } from "./usage.js";

export const PRESETS = {
  gemini: { baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash", editModel: "gemini-2.5-flash" },
  groq: { baseURL: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", editModel: "llama-3.3-70b-versatile" },
  ollama: { baseURL: "http://localhost:11434/v1", model: "qwen2.5:14b", editModel: "qwen2.5:14b" },
  openrouter: { baseURL: "https://openrouter.ai/api/v1", model: "", editModel: "" },
  openai: { baseURL: "https://api.openai.com/v1", model: "", editModel: "" },
  "openai-compatible": { baseURL: "", model: "", editModel: "" },
};

export function createOpenAiCompatibleProvider({ kind, env = process.env, fetchImpl = fetch } = {}) {
  const preset = PRESETS[kind] || PRESETS["openai-compatible"];
  const baseURL = (env.AI_BASE_URL || preset.baseURL).replace(/\/+$/, "");
  const model = env.AI_MODEL || preset.model;
  const key = env.AI_API_KEY || "";
  if (!baseURL) throw new Error(`AI_PROVIDER=${kind} needs AI_BASE_URL in the settings.`);
  if (!model) throw new Error(`AI_PROVIDER=${kind} needs AI_MODEL in the settings.`);
  if (!key && kind !== "ollama") throw new Error(`AI_PROVIDER=${kind} needs AI_API_KEY in the settings.`);
  // Free tiers cost nothing; set AI_PRICE_INPUT / AI_PRICE_OUTPUT (US$ per million tokens) for paid ones.
  for (const m of new Set([model, env.AI_EDIT_MODEL || preset.editModel || model])) setModelPrice(m, Number(env.AI_PRICE_INPUT) || 0, Number(env.AI_PRICE_OUTPUT) || 0);

  return {
    name: kind,
    model,
    editModel: env.AI_EDIT_MODEL || preset.editModel || model,
    async complete({ system, prompt, model: callModel, onProgress, kind: what = "other" }) {
      const parts = typeof prompt === "string" ? [{ text: prompt }] : prompt;
      const res = await fetchImpl(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({
          model: callModel || model,
          messages: [{ role: "system", content: system }, { role: "user", content: parts.filter((p) => p.text).map((p) => p.text).join("\n\n") }],
          max_tokens: Number(env.AI_MAX_TOKENS) || 16000,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(10 * 60_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error?.message || data.error || `status ${res.status}`;
        if (res.status === 429) throw new Error(`The AI service says you've hit its limit for now (${msg}). Free plans allow a set number of requests per minute and per day; try again later.`);
        throw new Error(`The AI service returned an error: ${msg}`);
      }
      const text = data.choices?.[0]?.message?.content || "";
      onProgress?.({ chars: text.length, text });
      await recordUsage({ kind: what, model: data.model || callModel || model, usage: { input_tokens: data.usage?.prompt_tokens || 0, output_tokens: data.usage?.completion_tokens || 0 } });
      if (data.choices?.[0]?.finish_reason === "length") throw new Error("The AI's answer was too long and got cut off. Try a smaller change, or split the request.");
      return text;
    },
  };
}
