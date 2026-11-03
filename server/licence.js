// Licence checks for copies of the builder sold to hosts.
//
// server/licence-config.json names the licence server and its public key
// (written by licence-server/keys.mjs). Without them, licensing is off: the
// builder runs without a key (that's your own copy while you develop).
//
// With them, a host has a 14-day trial, then needs a licence key
// (LICENCE_KEY in settings.txt, or entered on the Customers page). The
// builder checks the key twice a day; answers are signed, so they can't be
// faked. If the licence server can't be reached, the last good answer counts
// for 14 more days.
//
// Without a valid licence, new websites, new customers and AI stop.
// Published websites are NEVER taken offline, and existing ones can still be
// edited and published.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const DAY = 86400_000;
export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 14;
const CHECK_EVERY = 12 * 3600_000;

const newer = (a, b) => {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

export async function createLicence({ dataDir, version, env = process.env, config, fetchImpl = fetch, stats = () => ({}) }) {
  if (!config) {
    try { config = JSON.parse(await fs.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "licence-config.json"), "utf8")); } catch { config = {}; }
  }
  const enabled = !!(config.server && config.publicKey);
  const publicKey = enabled ? crypto.createPublicKey(config.publicKey) : null;
  const stateFile = path.join(dataDir, "licence.json");

  const readText = async (file, make) => {
    try { return (await fs.readFile(file, "utf8")).trim(); } catch {
      const v = make();
      await fs.writeFile(file, v + "\n", { mode: 0o600 });
      return v;
    }
  };
  const serverId = await readText(path.join(dataDir, ".server-id"), () => crypto.randomBytes(12).toString("hex"));
  const firstRun = await readText(path.join(dataDir, ".first-run"), () => new Date().toISOString());

  let state = { key: "", answer: null, lastError: "" };
  try { state = { ...state, ...JSON.parse(await fs.readFile(stateFile, "utf8")) } } catch { /* first run */ }
  if (env.LICENCE_KEY) state.key = env.LICENCE_KEY.trim().toUpperCase();
  const saveState = () => fs.writeFile(stateFile, JSON.stringify(state), { mode: 0o600 }).catch(() => {});

  // A signed answer from the licence server, checked; or null.
  function verified(answer) {
    if (!answer?.payload || !answer?.sig) return null;
    try {
      if (!crypto.verify(null, Buffer.from(answer.payload), publicKey, Buffer.from(answer.sig, "base64"))) return null;
      const p = JSON.parse(Buffer.from(answer.payload, "base64").toString());
      return p.key === state.key && p.serverId === serverId ? p : null;
    } catch { return null; }
  }

  async function check() {
    if (!enabled) return status();
    try {
      const res = await fetchImpl(`${config.server.replace(/\/+$/, "")}/v1/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key, serverId, hostname: os.hostname(), version, stats: stats() }),
        signal: AbortSignal.timeout(20_000),
      });
      const answer = await res.json();
      const p = verified(answer);
      if (!p) throw new Error("The licence server's answer couldn't be verified.");
      // Ignore answers with a clock far off ours (an old answer replayed).
      if (Math.abs(Date.parse(p.checkedAt) - Date.now()) > DAY) throw new Error("The licence server's clock and this server's clock disagree. Check the server's date and time.");
      state.answer = answer;
      state.lastError = "";
    } catch (err) {
      state.lastError = err.name === "TimeoutError" ? "The licence server didn't answer." : err.message;
    }
    await saveState();
    return status();
  }

  /**
   * { enabled, mode: "off" | "trial" | "active" | "grace" | "needed", allowed,
   *   daysLeft, reason, name, expires, key (masked), latest: { version, notes, url } | null, update }
   */
  function status() {
    const base = { enabled, version, serverId, key: state.key ? `${state.key.slice(0, 8)}…${state.key.slice(-4)}` : "", latest: null, update: false, lastError: state.lastError };
    if (!enabled) return { ...base, mode: "off", allowed: true };
    const p = state.key ? verified(state.answer) : null;
    if (p) {
      base.latest = p.latest || null;
      base.update = !!(p.latest?.version && newer(p.latest.version, version));
    }
    if (!state.key) {
      const left = Math.ceil((Date.parse(firstRun) + TRIAL_DAYS * DAY - Date.now()) / DAY);
      return left > 0
        ? { ...base, mode: "trial", allowed: true, daysLeft: left, reason: `Free trial: ${left} day${left === 1 ? "" : "s"} left` }
        : { ...base, mode: "needed", allowed: false, reason: "The free trial has ended" };
    }
    if (!p) return { ...base, mode: "needed", allowed: false, reason: state.lastError ? `The licence key couldn't be checked: ${state.lastError}` : "The licence key hasn't been checked yet" };
    if (!p.valid) return { ...base, mode: "needed", allowed: false, reason: `This licence key ${p.reason}`, name: p.name };
    const age = Date.now() - Date.parse(p.checkedAt);
    if (age > GRACE_DAYS * DAY) return { ...base, mode: "needed", allowed: false, reason: `The licence server hasn't been reachable for ${GRACE_DAYS} days`, name: p.name };
    if (p.expires && p.expires < new Date().toISOString().slice(0, 10)) return { ...base, mode: "needed", allowed: false, reason: `This licence expired on ${p.expires}`, name: p.name };
    return { ...base, mode: age > CHECK_EVERY * 2.5 ? "grace" : "active", allowed: true, name: p.name, expires: p.expires || null };
  }

  async function setKey(key) {
    state.key = String(key || "").trim().toUpperCase().slice(0, 60);
    state.answer = null;
    await saveState();
    return check();
  }

  // Check now and twice a day.
  if (enabled) {
    check();
    setInterval(check, CHECK_EVERY).unref();
  }
  return { status, check, setKey, enabled };
}
