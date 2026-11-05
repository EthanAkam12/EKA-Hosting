// EKA Builder: HQ talks to it through its host API (the same key control
// panels use: HOST_API_KEY in the builder's settings, shown on its Customers page).

export function createBuilder({ url, key, fetchImpl = fetch } = {}) {
  const base = String(url || "").replace(/\/+$/, "");
  const enabled = !!(base && key);

  async function call(method, path, body) {
    if (!enabled) throw new Error("The builder isn't connected yet (BUILDER_URL and BUILDER_API_KEY in hq-settings.txt).");
    let res;
    try {
      res = await fetchImpl(`${base}/api/host${path}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
    } catch (err) { throw new Error(`Couldn't reach the builder (${err.cause?.code || err.message}).`); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Builder: ${data.error || `status ${res.status}`}`);
    return data;
  }

  return {
    enabled,
    url: base,
    overview: () => call("GET", "/hq/overview"),
    site: (id, days = 30) => call("GET", `/hq/sites/${id}?days=${days}`),
    markDone: (id, sid) => call("POST", `/hq/sites/${id}/submissions/${sid}/done`, {}),
    build: (body) => call("POST", "/hq/build", body),
    reviewLink: (id) => call("POST", `/hq/sites/${id}/review`, {}),
    writePost: (id, topic) => call("POST", `/hq/sites/${id}/write-post`, { topic }),
    domains: () => call("GET", "/hq/domains"),
    account: (body) => call("POST", "/accounts", body),
  };
}
