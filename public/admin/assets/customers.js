// The administrator's Customers page: customer accounts, the plans they're
// on, and a monthly report for billing.

import { h, api, toast, modal, confirmDialog, timeAgo } from "./ui.js";

const app = document.getElementById("app");
let data = { customers: [], plans: [], mail: false };

const money = (usd) => `$${Number(usd || 0).toFixed(2)}`;

async function load() {
  data = await api("/customers");
  render();
}

function render() {
  app.replaceChildren(
    h("div", { class: "head" },
      h("div", {}, h("h1", {}, "Customers"), h("p", { class: "muted", style: { margin: "4px 0 0" } }, "Each customer logs in with their email and sees only their own websites. Their plan sets how many websites they can have and how much AI they can use each month.")),
      h("button", { class: "btn btn-primary", onclick: addCustomer }, "+ Add customer")),
    customersPanel(),
    plansPanel(),
    billingPanel(),
    hostApiPanel(),
  );
}

// ---- customers ------------------------------------------------------------------

function customersPanel() {
  if (!data.customers.length) {
    return h("div", { class: "panel" }, h("h2", {}, "No customers yet"),
      h("p", { class: "muted", style: { margin: 0 } }, "Add customers here, or let your control panel or billing system add them automatically (see Help → Customers). Until then, everything you make is yours, as the administrator."));
  }
  const planSelect = (c) => h("select", { class: "select", "aria-label": "Plan", onchange: (e) => update(c, { plan: e.target.value }) },
    data.plans.map((p) => h("option", { value: p.id, selected: p.id === c.plan }, p.name)));
  const rows = data.customers.map((c) => {
    const pct = c.aiMonthly ? Math.min(100, Math.round((c.aiUsed / c.aiMonthly) * 100)) : 0;
    return h("tr", { class: c.disabled ? "off" : "" },
      h("td", {}, h("strong", {}, c.name || c.email), c.name ? h("div", { class: "small muted" }, c.email) : null, c.external ? h("div", { class: "small muted" }, `🔗 ${c.external}`) : null),
      h("td", {}, planSelect(c)),
      h("td", {}, String(c.sites)),
      h("td", {}, c.aiMonthly ? [h("span", { class: "bar" }, h("span", { style: { width: `${pct}%` } })), `${money(c.aiUsed)} of ${money(c.aiMonthly)}`] : h("span", { class: "muted" }, "No AI")),
      h("td", { class: "small" }, c.disabled ? h("span", { class: "badge badge-err" }, "Disabled") : c.lastLogin ? timeAgo(c.lastLogin) : h("span", { class: "muted" }, "Never")),
      h("td", {}, h("div", { class: "acts" },
        h("button", { class: "btn btn-sm", disabled: c.disabled, title: "Log in as this customer to help them (you'll be logged out as administrator)", onclick: () => openAs(c) }, "Open as customer"),
        h("button", { class: "btn btn-sm", onclick: () => resetPassword(c) }, "New password"),
        h("button", { class: "btn btn-sm", onclick: () => editCustomer(c) }, "Edit"),
      )));
  });
  return h("div", { class: "panel" },
    h("div", { class: "scroll" }, h("table", { class: "list" },
      h("tr", {}, h("th", {}, "Customer"), h("th", {}, "Plan"), h("th", {}, "Websites"), h("th", {}, "AI this month"), h("th", {}, "Last login"), h("th", {}, "")),
      rows)));
}

async function update(c, patch) {
  try {
    await api(`/customers/${c.id}`, { method: "PATCH", body: patch });
    toast("Saved.");
    load();
  } catch (e) { toast(e.message, { error: true }); load(); }
}

function showPassword(title, email, password) {
  modal({
    title,
    body: h("div", {},
      h("p", { style: { marginTop: 0 } }, `Give these login details to the customer. The password is only shown now.`),
      h("p", {}, "Log in at: ", h("strong", {}, `${location.origin}/admin/login`)),
      h("p", {}, "Email: ", h("strong", {}, email)),
      h("div", { class: "pw" }, password),
      h("button", { class: "btn btn-sm", style: { marginTop: "10px" }, onclick: () => navigator.clipboard?.writeText(`Log in at ${location.origin}/admin/login\nEmail: ${email}\nPassword: ${password}`).then(() => toast("Copied.")) }, "Copy login details")),
  });
}

function addCustomer() {
  const email = h("input", { class: "input", type: "email", placeholder: "customer@theirbusiness.co.uk" });
  const name = h("input", { class: "input", placeholder: "e.g. Smith Antiques" });
  const plan = h("select", { class: "select" }, data.plans.map((p) => h("option", { value: p.id }, `${p.name} (${p.sites} website${p.sites === 1 ? "" : "s"}, ${p.aiMonthly ? `${money(p.aiMonthly)} AI` : "no AI"})`)));
  const pw = h("input", { class: "input", type: "text", autocomplete: "off", placeholder: "Leave empty to make one up" });
  const m = modal({
    title: "Add a customer",
    body: h("div", {},
      h("div", { class: "field" }, h("label", {}, "Email (they log in with this)"), email),
      h("div", { class: "field" }, h("label", {}, "Name or business (optional)"), name),
      h("div", { class: "field" }, h("label", {}, "Plan"), plan),
      h("div", { class: "field" }, h("label", {}, "Password (optional)"), pw, h("div", { class: "field-hint" }, "At least 8 characters. Customers can change it after logging in."))),
    footer: [h("button", { class: "btn", onclick: () => m.close() }, "Cancel"), h("button", { class: "btn btn-primary", onclick: async () => {
      try {
        const res = await api("/customers", { method: "POST", body: { email: email.value, name: name.value, plan: plan.value, password: pw.value } });
        m.close();
        if (res.password) showPassword("Customer added", res.customer.email, res.password);
        else toast("Customer added.");
        load();
      } catch (e) { toast(e.message, { error: true }); }
    } }, "Add customer")],
  });
}

function editCustomer(c) {
  const email = h("input", { class: "input", type: "email", value: c.email });
  const name = h("input", { class: "input", value: c.name });
  const disabled = h("input", { type: "checkbox", checked: c.disabled });
  const m = modal({
    title: `Edit ${c.name || c.email}`,
    body: h("div", {},
      h("div", { class: "field" }, h("label", {}, "Email"), email),
      h("div", { class: "field" }, h("label", {}, "Name or business"), name),
      h("div", { class: "field" }, h("label", { class: "check" }, disabled, "Disabled (can't log in; their live websites stay online)")),
      h("hr", { class: "sep" }),
      h("button", { class: "btn btn-sm btn-danger", onclick: () => { m.close(); removeCustomer(c); } }, "Delete customer…")),
    footer: [h("button", { class: "btn", onclick: () => m.close() }, "Cancel"), h("button", { class: "btn btn-primary", onclick: async () => {
      await update(c, { email: email.value, name: name.value, disabled: disabled.checked });
      m.close();
    } }, "Save")],
  });
}

async function removeCustomer(c) {
  const keep = h("input", { type: "radio", name: "sites", checked: true });
  const del = h("input", { type: "radio", name: "sites" });
  const m = modal({
    title: `Delete ${c.name || c.email}?`,
    body: h("div", {},
      h("p", { style: { marginTop: 0 } }, `They won't be able to log in any more. They have ${c.sites} website${c.sites === 1 ? "" : "s"}:`),
      h("label", { class: "check" }, keep, "Keep their websites (they become yours, and stay online)"),
      h("label", { class: "check" }, del, "Delete their websites too (live sites go offline; can't be undone)")),
    footer: [h("button", { class: "btn", onclick: () => m.close() }, "Cancel"), h("button", { class: "btn btn-danger", onclick: async () => {
      try {
        await api(`/customers/${c.id}?sites=${del.checked ? "delete" : "keep"}`, { method: "DELETE" });
        m.close();
        toast("Customer deleted.");
        load();
      } catch (e) { toast(e.message, { error: true }); }
    } }, "Delete customer")],
  });
}

async function resetPassword(c) {
  if (!(await confirmDialog(`Make a new password for ${c.email}? Their old password stops working and they're logged out everywhere.`, { okText: "Make new password" }))) return;
  try {
    const { password } = await api(`/customers/${c.id}/password`, { method: "POST", body: {} });
    showPassword("New password", c.email, password);
  } catch (e) { toast(e.message, { error: true }); }
}

async function openAs(c) {
  if (!(await confirmDialog(`Log in as ${c.email}? You'll see exactly what they see. You'll be logged out as administrator; log out and back in with your password to return.`, { okText: "Open as customer" }))) return;
  try {
    const { url } = await api(`/customers/${c.id}/login-link`, { method: "POST", body: {} });
    location.href = url;
  } catch (e) { toast(e.message, { error: true }); }
}

// ---- plans ------------------------------------------------------------------------

function plansPanel() {
  const rows = data.plans.map((p) => {
    const name = h("input", { class: "input", value: p.name, "aria-label": "Plan name" });
    const sites = h("input", { class: "input", type: "number", min: "0", value: p.sites, style: { width: "90px" }, "aria-label": "Websites" });
    const aiBox = h("input", { class: "input", type: "number", min: "0", step: "0.5", value: p.aiMonthly, style: { width: "100px" }, "aria-label": "AI allowance" });
    const count = data.customers.filter((c) => c.plan === p.id).length;
    return h("tr", {},
      h("td", {}, name), h("td", {}, sites), h("td", {}, aiBox), h("td", { class: "small muted" }, `${count} customer${count === 1 ? "" : "s"}`),
      h("td", {}, h("div", { class: "acts" },
        h("button", { class: "btn btn-sm", onclick: async () => {
          try { await api(`/plans/${p.id}`, { method: "PATCH", body: { name: name.value, sites: sites.value, aiMonthly: aiBox.value } }); toast("Plan saved."); load(); } catch (e) { toast(e.message, { error: true }); }
        } }, "Save"),
        h("button", { class: "btn btn-sm btn-ghost", onclick: async () => {
          if (!(await confirmDialog(`Delete the ${p.name} plan?`, { okText: "Delete plan", danger: true }))) return;
          try { await api(`/plans/${p.id}`, { method: "DELETE" }); load(); } catch (e) { toast(e.message, { error: true }); }
        } }, "Delete"))));
  });
  return h("div", { class: "panel" },
    h("div", { class: "row", style: { justifyContent: "space-between", flexWrap: "wrap" } },
      h("div", {}, h("h2", {}, "Plans"), h("p", { class: "small muted", style: { margin: 0 } }, "The AI allowance is the AI cost (in US dollars, at Anthropic's prices) a customer can use each calendar month. 0 = no AI. Typical: a new website costs about $0.30–$1, a change a few cents.")),
      h("button", { class: "btn", onclick: async () => { await api("/plans", { method: "POST", body: { name: "New plan", sites: 1, aiMonthly: 1 } }); load(); } }, "+ Add plan")),
    h("div", { class: "scroll", style: { marginTop: "10px" } }, h("table", { class: "list" },
      h("tr", {}, h("th", {}, "Name"), h("th", {}, "Websites"), h("th", {}, "AI per month ($)"), h("th", {}, ""), h("th", {}, "")),
      rows)));
}

// ---- billing ------------------------------------------------------------------------

function billingPanel() {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const month = h("select", { class: "select", style: { width: "auto" } }, months.map((m) => h("option", { value: m }, m)));
  return h("div", { class: "panel" },
    h("h2", {}, "Billing report"),
    h("p", { class: "small muted", style: { marginTop: 0 } }, "A spreadsheet (CSV) with one row per customer: plan, websites, and the AI they used that month, to bill them or check your margins."),
    h("div", { class: "row" }, month, h("button", { class: "btn", onclick: () => { location.href = `/api/billing.csv?month=${month.value}`; } }, "Download report")));
}

// ---- control panels and billing systems -------------------------------------------------

function hostApiPanel() {
  const keyBox = h("div", { class: "pw", style: { display: "none", wordBreak: "break-all" } });
  return h("div", { class: "panel" },
    h("h2", {}, "Connect your control panel or billing system"),
    h("p", { class: "small muted", style: { marginTop: 0 } }, "Customers can open the builder from cPanel or DirectAdmin with one click (no second password), and WHMCS can create, suspend and remove customers as they buy, stop paying or cancel. Each needs the address and key below. Full steps are in Help → Customers; the plugins are in the builder's tools folder."),
    h("div", { class: "field" }, h("label", {}, "Host API address"), h("div", { class: "pw" }, data.hostApi.url)),
    h("div", { class: "field" }, h("label", {}, "Host API key (keep it secret: it can log in as any customer)"), keyBox,
      h("button", { class: "btn btn-sm", onclick: async (e) => {
        const { key } = await api("/host-api-key");
        keyBox.textContent = key;
        keyBox.style.display = "block";
        e.target.remove();
      } }, "Show key"),
      data.hostApi.keyFromSettings ? null : h("div", { class: "field-hint" }, "Made automatically and saved in the data folder (.host-api-key). To choose your own, set HOST_API_KEY in settings.txt.")),
  );
}

document.getElementById("logout").addEventListener("click", async () => {
  await api("/logout", { method: "POST", body: {} });
  location.href = "/admin/login";
});

load().catch((e) => toast(e.message, { error: true }));
