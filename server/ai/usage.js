// AI usage tracking: every call's tokens and estimated cost go into
// DATA_DIR/ai-usage.jsonl, tagged with what it was for and which website.
//
// Routes set the context once (usageContext.run({ siteId, user }, ...)) and
// everything the AI does inside it, including background jobs, is tagged.

import fs from "node:fs/promises";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

export const usageContext = new AsyncLocalStorage();

// US$ per million tokens: [input, output, cache read]. Cache writes (5-minute)
// cost 1.25x input. Unknown models are priced as Opus.
const PRICES = {
  "claude-opus-5-5": [4, 20, 0.2],
  "claude-opus-5": [5, 25, 0.5],
  "claude-sonnet-5-5": [2, 10, 0.2],
  "claude-sonnet-5": [2, 10, 0.2],
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
  "claude-fable-5-1": [10, 50, 0.25],
};

export function estimateCost(model, usage = {}) {
  const [inp, out, read] = PRICES[model] || PRICES["claude-opus-5-5"];
  const m = 1e6;
  return (usage.input_tokens || 0) * inp / m
    + (usage.cache_creation_input_tokens || 0) * inp * 1.25 / m
    + (usage.cache_read_input_tokens || 0) * read / m
    + (usage.output_tokens || 0) * out / m;
}

let file = null;
export function initUsageLog(dataDir) {
  file = path.join(dataDir, "ai-usage.jsonl");
}

export async function recordUsage({ kind, model, usage }) {
  if (!file || !usage) return;
  const ctx = usageContext.getStore() || {};
  const entry = {
    at: new Date().toISOString(),
    kind,
    model,
    siteId: ctx.siteId || null,
    wizard: ctx.wizard || undefined,
    demo: ctx.user?.role === "demo" ? ctx.user.id : undefined,
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    cacheRead: usage.cache_read_input_tokens || 0,
    cacheWrite: usage.cache_creation_input_tokens || 0,
    cost: Math.round(estimateCost(model, usage) * 1e5) / 1e5,
  };
  await fs.appendFile(file, JSON.stringify(entry) + "\n").catch((err) => console.warn("Couldn't record AI usage:", err.message));
}

// Totals for a period, by kind of job and by website.
// `wizards` maps a wizard run's id to the site it became.
export async function usageSummary({ since, wizards = {} } = {}) {
  let lines = [];
  try { lines = (await fs.readFile(file, "utf8")).split("\n").filter(Boolean); } catch { /* no usage yet */ }
  const from = since ? Date.parse(since) : 0;
  const total = { calls: 0, cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const byKind = {}, bySite = {};
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (Date.parse(e.at) < from) continue;
    const site = e.demo ? "(demo visitors)" : e.siteId || wizards[e.wizard] || "(not saved yet)";
    for (const [bucket, key] of [[byKind, e.kind], [bySite, site]]) {
      const b = (bucket[key] ||= { calls: 0, cost: 0 });
      b.calls++;
      b.cost += e.cost;
    }
    total.calls++;
    for (const k of ["cost", "input", "output", "cacheRead", "cacheWrite"]) total[k] += e[k] || 0;
  }
  return { total, byKind, bySite };
}
