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
    // The customer account that used it (for plan allowances and billing).
    account: ctx.user?.role === "user" ? ctx.user.id : undefined,
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    cacheRead: usage.cache_read_input_tokens || 0,
    cacheWrite: usage.cache_creation_input_tokens || 0,
    cost: Math.round(estimateCost(model, usage) * 1e5) / 1e5,
  };
  if (entry.account) addToMonth(entry.account, entry.at, entry.cost);
  await fs.appendFile(file, JSON.stringify(entry) + "\n").catch((err) => console.warn("Couldn't record AI usage:", err.message));
}

// Each customer's AI cost this calendar month, kept in memory (loaded from the
// log at start-up) so checking an allowance doesn't re-read the log.
let monthKey = "";
let monthTotals = new Map();
const keyOf = (iso) => String(iso).slice(0, 7);
function addToMonth(account, at, cost) {
  const key = keyOf(at);
  if (key !== monthKey) { if (key < monthKey) return; monthKey = key; monthTotals = new Map(); }
  monthTotals.set(account, (monthTotals.get(account) || 0) + (cost || 0));
}

export async function loadMonthTotals() {
  monthKey = keyOf(new Date().toISOString());
  monthTotals = new Map();
  let lines = [];
  try { lines = (await fs.readFile(file, "utf8")).split("\n"); } catch { return; }
  for (const line of lines) {
    if (!line.includes('"account"') || !line.includes(`"at":"${monthKey}`)) continue;
    try { const e = JSON.parse(line); addToMonth(e.account, e.at, e.cost); } catch { /* skip */ }
  }
}

/** US$ of AI a customer has used this calendar month. */
export function accountCostThisMonth(account) {
  if (keyOf(new Date().toISOString()) !== monthKey) { monthKey = keyOf(new Date().toISOString()); monthTotals = new Map(); }
  return monthTotals.get(account) || 0;
}

/** Per-customer totals for one month ("2026-11"), for billing. */
export async function accountUsage(month) {
  let lines = [];
  try { lines = (await fs.readFile(file, "utf8")).split("\n").filter(Boolean); } catch { /* none */ }
  const out = {};
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e.account || keyOf(e.at) !== month) continue;
    const a = (out[e.account] ||= { calls: 0, cost: 0 });
    a.calls++;
    a.cost += e.cost || 0;
  }
  return out;
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
