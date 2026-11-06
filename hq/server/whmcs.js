// WHMCS: your billing and hosting system. HQ uses its API to read tickets,
// customers, invoices, orders and revenue, and (only when you approve, or
// when you click it yourself) to reply to tickets, accept orders, email
// customers and suspend or unsuspend hosting.
//
// In WHMCS: Configuration → System Settings → API Credentials → Generate New
// API Credential (give its role these actions: GetTickets, GetTicket,
// AddTicketReply, GetClients, GetClientsDetails, GetClientsProducts,
// GetInvoices, GetOrders, AcceptOrder, GetStats, SendEmail, ModuleSuspend,
// ModuleUnsuspend, GetServers). Also allow this server's IP address under
// Configuration → System Settings → General Settings → Security → API IP Access Restriction.

export function createWhmcs({ url, identifier, secret, accessKey = "", adminUser = "", fetchImpl = fetch } = {}) {
  const base = String(url || "").replace(/\/+$/, "").replace(/\/includes\/api\.php$/, "");
  const enabled = !!(base && identifier && secret);

  async function call(action, params = {}) {
    if (!enabled) throw new Error("WHMCS isn't connected yet (WHMCS_URL, WHMCS_IDENTIFIER and WHMCS_SECRET in hq-settings.txt).");
    const body = new URLSearchParams({ action, identifier, secret, responsetype: "json", ...(accessKey ? { accesskey: accessKey } : {}) });
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") body.set(k, String(v));
    let res;
    try {
      res = await fetchImpl(`${base}/includes/api.php`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(30_000) });
    } catch (err) { throw new Error(`Couldn't reach WHMCS (${err.cause?.code || err.message}).`); }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`WHMCS didn't answer properly (status ${res.status}). Check WHMCS_URL.`); }
    if (data.result !== "success") throw new Error(`WHMCS: ${data.message || "the request failed"}`);
    return data;
  }
  const list = (data, a, b) => data?.[a]?.[b] || [];

  return {
    enabled,
    adminUrl: base ? `${base}/admin` : "",
    call,

    // ---- tickets ----
    async ticketsAwaitingReply() {
      const d = await call("GetTickets", { status: "Awaiting Reply", limitnum: 100 });
      return list(d, "tickets", "ticket");
    },
    async ticket(id) {
      const d = await call("GetTicket", { ticketid: id });
      return {
        id: d.ticketid, tid: d.tid, subject: d.subject, status: d.status, deptname: d.deptname, userid: Number(d.userid) || 0,
        name: d.name, email: d.email, lastreply: d.lastreply,
        replies: list(d, "replies", "reply").map((r) => ({ at: r.date, from: r.admin ? "support" : "customer", name: r.admin || r.name || "", text: String(r.message || "").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "") })),
      };
    },
    reply(ticketId, message) {
      return call("AddTicketReply", { ticketid: ticketId, message, adminusername: adminUser || undefined, markdown: true });
    },

    // ---- customers ----
    async clients({ search = "", offset = 0, limit = 50, status = "" } = {}) {
      const d = await call("GetClients", { search, limitstart: offset, limitnum: limit, status, orderby: "id", order: "desc" });
      return { total: Number(d.totalresults) || 0, clients: list(d, "clients", "client") };
    },
    async client(id) {
      const d = await call("GetClientsDetails", { clientid: id, stats: true });
      return d.client ? { ...d.client, stats: d.stats || {} } : d;
    },
    async products({ clientId, status, offset = 0, limit = 250 } = {}) {
      const d = await call("GetClientsProducts", { clientid: clientId, limitstart: offset, limitnum: limit });
      const rows = list(d, "products", "product");
      return { total: Number(d.totalresults) || rows.length, products: status ? rows.filter((p) => p.status === status) : rows };
    },
    async invoices({ clientId, status, limit = 100 } = {}) {
      const d = await call("GetInvoices", { userid: clientId, status, limitnum: limit, orderby: "duedate", order: "asc" });
      return list(d, "invoices", "invoice");
    },
    async orders({ status = "Pending", limit = 50 } = {}) {
      const d = await call("GetOrders", { status, limitnum: limit });
      return list(d, "orders", "order");
    },
    acceptOrder(orderId) { return call("AcceptOrder", { orderid: orderId, autosetup: true, sendemail: true }); },
    stats() { return call("GetStats"); },
    async productsList() { const d = await call("GetProducts"); return d.products?.product || []; },
    async paymentMethods() { const d = await call("GetPaymentMethods"); return d.paymentmethods?.paymentmethod || []; },
    async tldPricing() { const d = await call("GetTLDPricing", { currencyid: 1 }); return d.pricing || {}; },
    async servers() {
      const d = await call("GetServers", { fetchStatus: true });
      return d.servers || [];
    },
    suspend(serviceId, reason = "") { return call("ModuleSuspend", { serviceid: serviceId, suspendreason: reason }); },
    unsuspend(serviceId) { return call("ModuleUnsuspend", { serviceid: serviceId }); },
    // A one-off email to a customer, sent by WHMCS (logged in their account).
    email(clientId, subject, text) {
      return call("SendEmail", { id: clientId, customtype: "general", customsubject: subject, custommessage: text.replace(/\n/g, "<br>\n") });
    },
  };
}

// A monthly amount for a WHMCS billing cycle (for monthly recurring revenue).
export function monthlyAmount(amount, cycle) {
  const n = Number(amount) || 0;
  const per = { monthly: 1, quarterly: 3, "semi-annually": 6, annually: 12, biennially: 24, triennially: 36 }[String(cycle || "").toLowerCase()];
  return per ? n / per : 0;
}
