// Claude provider. Only needs to turn (system, prompt) into text; the site
// logic lives in ./index.js so other providers can be added the same way.

import Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "./usage.js";

// Prompt caching: the instructions (system prompt) are the same on every call,
// and parts of a prompt marked { cache: true } (e.g. the approved design that
// every "design this page" call shares) are reused across calls for 5 minutes.
// Cached tokens cost a fraction of the normal input price.
const CACHED = { type: "ephemeral" };

export function createAnthropicProvider({ model, effort } = {}) {
  const client = new Anthropic();
  return {
    name: "claude",
    model,
    // images: optional [{ mediaType, data (base64) }] shown to the model before the prompt.
    // prompt: a string, or parts [{ text, cache? }] where the cached parts come first.
    // kind: what the call is for, for the usage log ("concept", "edit"…).
    async complete({ system, prompt, images = [], model: callModel, effort: callEffort, onProgress, kind = "other" }) {
      const parts = typeof prompt === "string" ? [{ text: prompt }] : prompt;
      const content = [
        ...images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } })),
        ...parts.filter((p) => p.text).map((p) => ({ type: "text", text: p.text, ...(p.cache ? { cache_control: CACHED } : {}) })),
      ];
      const stream = client.beta.messages.stream({
        model: callModel || model,
        max_tokens: 64000,
        system: [{ type: "text", text: system, cache_control: CACHED }],
        messages: [{ role: "user", content }],
        output_config: { effort: callEffort || effort },
        // If a request is declined by a safety classifier, let the API retry
        // it on Anthropic's recommended fallback model instead of failing.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      let chars = 0;
      let text = "";
      stream.on("text", (delta) => {
        chars += delta.length;
        text += delta;
        // `text` is for callers that preview the answer as it's written; it isn't sent to the browser.
        onProgress?.({ chars, text });
      });
      const message = await stream.finalMessage();
      await recordUsage({ kind, model: message.model || callModel || model, usage: message.usage });
      if (message.stop_reason === "refusal") {
        throw new Error("The AI declined this request. Try rephrasing it.");
      }
      if (message.stop_reason === "max_tokens") {
        throw new Error("The AI's answer was too long and got cut off. Try a smaller change, or split the request.");
      }
      return message.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
    },
  };
}
