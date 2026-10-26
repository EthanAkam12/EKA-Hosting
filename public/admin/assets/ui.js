// Tiny DOM + API helpers shared by the dashboard and the editor.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export async function api(path, { method = "GET", body, headers = {}, raw = false } = {}) {
  const opts = { method, headers: { "X-EKA-Request": "1", ...headers } };
  if (body !== undefined) {
    if (raw) opts.body = body;
    else {
      opts.body = JSON.stringify(body);
      opts.headers["Content-Type"] = "application/json";
    }
  }
  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401) {
    location.href = "/admin/login";
    throw new Error("Please log in.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Polls a background job until it finishes. onProgress gets the job object.
export async function waitForJob(jobId, onProgress) {
  for (;;) {
    const job = await api(`/jobs/${jobId}`);
    onProgress?.(job);
    if (job.status === "done") return job.result;
    if (job.status === "error") throw new Error(job.error || "Something went wrong.");
    await new Promise((r) => setTimeout(r, 1200));
  }
}

let toastBox;
export function toast(message, { error = false, ms = 3200 } = {}) {
  if (!toastBox) document.body.append((toastBox = h("div", { class: "toasts", role: "status", "aria-live": "polite" })));
  const t = h("div", { class: `toast${error ? " toast-err" : ""}` }, message);
  toastBox.append(t);
  setTimeout(() => t.remove(), error ? ms * 2 : ms);
}

export function modal({ title, body, footer = [], wide = false, onClose }) {
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const backdrop = h("div", { class: "modal-backdrop", onmousedown: (e) => { if (e.target === backdrop) close(); } },
    h("div", { class: `modal${wide ? " modal-wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "modal-head" }, h("h2", {}, title), h("button", { class: "icon-btn", "aria-label": "Close", onclick: close }, "✕")),
      h("div", { class: "modal-body" }, body),
      footer.length ? h("div", { class: "modal-foot" }, footer) : null,
    ),
  );
  document.body.append(backdrop);
  document.addEventListener("keydown", onKey);
  setTimeout(() => backdrop.querySelector("input, textarea, select, button.btn-primary")?.focus(), 0);
  return { close, el: backdrop };
}

export function confirmDialog(message, { okText = "OK", danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
    const m = modal({
      title: "Please confirm",
      body: h("p", { style: { margin: 0 } }, message),
      footer: [
        h("button", { class: "btn", onclick: () => finish(false) }, "Cancel"),
        h("button", { class: `btn ${danger ? "btn-danger" : "btn-primary"}`, onclick: () => finish(true) }, okText),
      ],
      onClose: () => { if (!done) { done = true; resolve(false); } },
    });
  });
}

export function timeAgo(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

// Strip shown at the top of every admin page in demo mode.
export function demoBanner(me) {
  if (!me?.demo) return;
  const ai = me.demo.aiLeft === null ? "" : ` You have ${me.demo.aiLeft} AI actions left.`;
  document.body.prepend(h("div", { class: "demo-bar" },
    h("strong", {}, "Demo · "),
    `Try anything: your websites are private to you and deleted after ${me.demo.hours} hours. Publishing is switched off.${ai} `,
    h("a", { href: "/help", target: "_blank", rel: "noopener" }, "How it works"),
  ));
}
