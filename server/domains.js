// The domain connection helper: what DNS records a customer's domain needs to
// point at this server, and whether it does yet (and serves the site over HTTPS).

import dns from "node:dns/promises";

const resolve = async (fn, name) => { try { return await fn(name); } catch { return []; } };

/** This server's public IP addresses: SERVER_IP, else what the base domain resolves to. */
export async function serverAddresses({ serverIp = "", baseDomain = "", dnsImpl = dns } = {}) {
  const set = serverIp.split(/[\s,]+/).filter(Boolean);
  if (set.length) return set;
  if (!baseDomain) return [];
  return [...(await resolve(dnsImpl.resolve4, baseDomain)), ...(await resolve(dnsImpl.resolve6, baseDomain))];
}

/** How one name (e.g. "www.cafe.co.uk") points now, and whether that's right. */
async function checkName(name, { ips, target, dnsImpl }) {
  const cname = (await resolve(dnsImpl.resolveCname, name))[0]?.replace(/\.$/, "") || "";
  const a = [...(await resolve(dnsImpl.resolve4, name)), ...(await resolve(dnsImpl.resolve6, name))];
  const ok = (cname && target && (cname === target || cname.endsWith(`.${target.split(".").slice(1).join(".")}`)))
    || (a.length > 0 && ips.length > 0 && a.every((x) => ips.includes(x)));
  return { name, cname, a, ok: !!ok, state: !a.length && !cname ? "missing" : ok ? "ok" : ips.length ? "elsewhere" : "unknown" };
}

/** Whether https://domain answers with this site (the builder marks its pages with X-EKA-Site). */
async function checkHttps(domain, siteId, fetchImpl) {
  try {
    const res = await fetchImpl(`https://${domain}/`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000) });
    return res.headers.get("x-eka-site") === siteId ? "ok" : "other";
  } catch { return "fail"; }
}

export async function checkDomains({ domains, siteId, slug, baseDomain, serverIp, fetchImpl = fetch, dnsImpl = dns }) {
  const ips = await serverAddresses({ serverIp, baseDomain, dnsImpl });
  const target = baseDomain ? `${slug}.${baseDomain}` : "";
  const out = [];
  for (const domain of domains) {
    const [apex, www] = await Promise.all([checkName(domain, { ips, target: "", dnsImpl }), checkName(`www.${domain}`, { ips, target, dnsImpl })]);
    out.push({ domain, apex, www, https: apex.ok || www.ok ? await checkHttps(apex.ok ? domain : `www.${domain}`, siteId, fetchImpl) : "waiting" });
  }
  return { ips, target, domains: out };
}
