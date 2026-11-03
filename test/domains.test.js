import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDomains } from "../server/domains.js";

const fakeDns = (records) => {
  const look = (type) => async (name) => { const r = records[`${type} ${name}`]; if (!r) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }); return r; };
  return { resolve4: look("A"), resolve6: look("AAAA"), resolveCname: look("CNAME") };
};

test("domain helper: right, missing and wrong records, and whether https serves this site", async () => {
  const dnsImpl = fakeDns({
    "A ekahosting.com": ["203.0.113.5"],
    "A cafe.co.uk": ["203.0.113.5"], "CNAME www.cafe.co.uk": ["harbour-cafe.ekahosting.com."], "A www.cafe.co.uk": ["203.0.113.5"],
    "A old.co.uk": ["198.51.100.9"],
  });
  const fetchImpl = async (url) => ({ headers: new Map([["x-eka-site", url.includes("cafe") ? "site1" : "other"]]) });
  const r = await checkDomains({ domains: ["cafe.co.uk", "old.co.uk", "new.co.uk"], siteId: "site1", slug: "harbour-cafe", baseDomain: "ekahosting.com", serverIp: "", fetchImpl, dnsImpl });
  assert.deepEqual(r.ips, ["203.0.113.5"], "the server's address comes from the main domain");
  assert.equal(r.target, "harbour-cafe.ekahosting.com");
  const [cafe, old, fresh] = r.domains;
  assert.deepEqual([cafe.apex.state, cafe.www.state, cafe.https], ["ok", "ok", "ok"]);
  assert.deepEqual([old.apex.state, old.apex.a], ["elsewhere", ["198.51.100.9"]]);
  assert.equal(old.https, "waiting");
  assert.deepEqual([fresh.apex.state, fresh.www.state], ["missing", "missing"]);
  const fixed = await checkDomains({ domains: ["x.com"], siteId: "s", slug: "x", baseDomain: "", serverIp: "192.0.2.1, 192.0.2.2", fetchImpl, dnsImpl });
  assert.deepEqual(fixed.ips, ["192.0.2.1", "192.0.2.2"], "SERVER_IP wins");
});
