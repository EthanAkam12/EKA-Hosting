import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStats } from "../server/stats.js";

const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148";
const PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130";

test("visits are counted without cookies: visitors, pages, where from, devices; bots ignored", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eka-stats-"));
  const stats = createStats({ siteDir: (id) => path.join(dir, id) });
  stats.record({ siteId: "s1", path: "/", ip: "1.1.1.1", ua: PHONE, referer: "https://www.google.com/search?q=x", host: "cafe.test" });
  stats.record({ siteId: "s1", path: "/menu/", ip: "1.1.1.1", ua: PHONE, referer: "https://cafe.test/", host: "cafe.test" });
  stats.record({ siteId: "s1", path: "/", ip: "2.2.2.2", ua: PC });
  stats.record({ siteId: "s1", path: "/", ip: "3.3.3.3", ua: "Googlebot/2.1" });
  stats.record({ siteId: "s1", path: "/", ip: "4.4.4.4", ua: "" });
  stats.record({ siteId: "s2", path: "/", ip: "1.1.1.1", ua: PHONE });

  const before = await stats.summary("s1", { days: 7 });
  assert.deepEqual([before.views, before.visitors], [3, 2], "counted before saving too");
  await stats.flush();
  stats.record({ siteId: "s1", path: "/menu/", ip: "5.5.5.5", ua: PC });
  const s = await stats.summary("s1", { days: 7 });
  assert.deepEqual([s.views, s.visitors], [4, 3]);
  assert.deepEqual(s.pages[0], ["/", 2]);
  assert.deepEqual(s.refs, [["google.com", 1]], "visits within the site aren't 'came from'");
  assert.deepEqual(s.devices, { mobile: 2, desktop: 2 });
  assert.equal(s.daily.length, 7);
  assert.equal(s.daily.at(-1).views, 4);
  assert.equal((await stats.summary("s2", { days: 7 })).visitors, 1, "sites counted separately");
  const saved = await fs.readFile(path.join(dir, "s1", "stats", `${new Date().toISOString().slice(0, 7)}.json`), "utf8");
  assert.doesNotMatch(saved, /1\.1\.1\.1|iPhone/, "nothing about the person is stored");
  await fs.rm(dir, { recursive: true });
});
