// Visitor statistics for sites the builder hosts, counted on the server as
// pages are served: no cookies, no tracking code, nothing stored about a
// person. Each day a visitor is a hash of (daily secret, site, IP, browser),
// kept in memory for that day only, so visitors can't be followed across
// days or sites. Bots and the owner's own previews aren't counted.
//
// Stored per site and month: data/sites/<id>/stats/<YYYY-MM>.json
//   { days: { "2026-11-03": { views, visitors, pages: {path: n}, refs: {domain: n}, devices: {mobile, desktop, tablet} } } }

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|java\/|go-http|axios|node-fetch/i;
const today = () => new Date().toISOString().slice(0, 10);

export function createStats({ siteDir }) {
  const pending = new Map(); // siteId → { day → counts }
  const seen = new Map(); // day → Set of visitor hashes
  let secret = { day: "", key: null };

  const visitorId = (siteId, ip, ua) => {
    const day = today();
    if (secret.day !== day) { secret = { day, key: crypto.randomBytes(16) }; seen.clear(); }
    return crypto.createHmac("sha256", secret.key).update(`${siteId}|${ip}|${ua}`).digest("base64url").slice(0, 16);
  };

  /** Counts one page view. `path` is the page's path on the site ("/", "/about/"). */
  function record({ siteId, path: pagePath, ip, ua = "", referer = "", host = "" }) {
    if (!ua || BOT.test(ua)) return;
    const day = today();
    const site = pending.get(siteId) || pending.set(siteId, {}).get(siteId);
    const d = (site[day] ||= { views: 0, visitors: 0, pages: {}, refs: {}, devices: {} });
    d.views++;
    const id = visitorId(siteId, ip, ua);
    const daySeen = seen.get(day) || seen.set(day, new Set()).get(day);
    if (!daySeen.has(id)) { daySeen.add(id); d.visitors++; }
    const p = String(pagePath || "/").slice(0, 120);
    d.pages[p] = (d.pages[p] || 0) + 1;
    try {
      const ref = referer && new URL(referer).hostname.replace(/^www\./, "");
      if (ref && ref !== host.replace(/^www\./, "")) d.refs[ref] = (d.refs[ref] || 0) + 1;
    } catch { /* not a URL */ }
    const device = /iPad|Tablet/i.test(ua) ? "tablet" : /Mobi|Android|iPhone/i.test(ua) ? "mobile" : "desktop";
    d.devices[device] = (d.devices[device] || 0) + 1;
  }

  const file = (siteId, month) => path.join(siteDir(siteId), "stats", `${month}.json`);
  async function readMonth(siteId, month) {
    try { return JSON.parse(await fs.readFile(file(siteId, month), "utf8")); } catch { return { days: {} }; }
  }

  // Adds what's been counted to the files (every minute, and on shutdown).
  async function flush() {
    const batch = [...pending.entries()];
    pending.clear();
    for (const [siteId, days] of batch) {
      const byMonth = {};
      for (const [day, counts] of Object.entries(days)) (byMonth[day.slice(0, 7)] ||= {})[day] = counts;
      for (const [month, monthDays] of Object.entries(byMonth)) {
        try {
          const data = await readMonth(siteId, month);
          for (const [day, c] of Object.entries(monthDays)) {
            const d = (data.days[day] ||= { views: 0, visitors: 0, pages: {}, refs: {}, devices: {} });
            d.views += c.views;
            d.visitors += c.visitors;
            for (const k of ["pages", "refs", "devices"]) for (const [key, n] of Object.entries(c[k])) d[k][key] = (d[k][key] || 0) + n;
            // Keep the lists short.
            for (const k of ["pages", "refs"]) d[k] = Object.fromEntries(Object.entries(d[k]).sort((a, b) => b[1] - a[1]).slice(0, 50));
          }
          await fs.mkdir(path.dirname(file(siteId, month)), { recursive: true });
          await fs.writeFile(file(siteId, month), JSON.stringify(data));
        } catch (err) { if (err.code !== "ENOENT") console.warn("Stats not saved:", err.message); }
      }
    }
  }

  /** Totals and a day-by-day list for the last `days` days (including what's not flushed yet). */
  async function summary(siteId, { days = 30, end = new Date() } = {}) {
    const list = [];
    for (let i = days - 1; i >= 0; i--) list.push(new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10));
    const months = [...new Set(list.map((d) => d.slice(0, 7)))];
    const data = Object.assign({}, ...(await Promise.all(months.map((m) => readMonth(siteId, m)))).map((x) => x.days));
    const live = pending.get(siteId) || {};
    const total = { views: 0, visitors: 0, pages: {}, refs: {}, devices: {} };
    const daily = list.map((day) => {
      const a = data[day] || { views: 0, visitors: 0, pages: {}, refs: {}, devices: {} };
      const b = live[day] || { views: 0, visitors: 0, pages: {}, refs: {}, devices: {} };
      const views = a.views + b.views, visitors = a.visitors + b.visitors;
      total.views += views;
      total.visitors += visitors;
      for (const src of [a, b]) for (const k of ["pages", "refs", "devices"]) for (const [key, n] of Object.entries(src[k] || {})) total[k][key] = (total[k][key] || 0) + n;
      return { day, views, visitors };
    });
    const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
    return { daily, views: total.views, visitors: total.visitors, pages: top(total.pages, 10), refs: top(total.refs, 10), devices: total.devices };
  }

  const timer = setInterval(() => flush().catch(() => {}), 60_000);
  timer.unref();
  return { record, flush, summary };
}
