// Claude provider. Only needs to turn (system, prompt) into text; the site
// logic lives in ./index.js so other providers can be added the same way.

import Anthropic from "@anthropic-ai/sdk";

export function createAnthropicProvider({ model, effort } = {}) {
  const client = new Anthropic();
  return {
    name: "claude",
    model,
    async complete({ system, prompt, model: callModel, effort: callEffort, onProgress }) {
      const stream = client.beta.messages.stream({
        model: callModel || model,
        max_tokens: 64000,
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: { effort: callEffort || effort },
        // If a request is declined by a safety classifier, let the API retry
        // it on Anthropic's recommended fallback model instead of failing.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      let chars = 0;
      stream.on("text", (delta) => {
        chars += delta.length;
        onProgress?.({ chars });
      });
      const message = await stream.finalMessage();
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
