// Builds property-panel controls from the field definitions in shared/schema.js.

import { h } from "../ui.js";

let uidCounter = 0;
const nextId = () => `f${++uidCounter}`;

// ctx: { pickImage(callback), links: [{ value, label }] }
export function fieldControl(field, value, onChange, ctx) {
  const id = nextId();
  const label = field.label ? h("label", { for: id }, field.label) : null;
  const wrap = (control, hint) => h("div", { class: "field" }, label, control, hint ? h("div", { class: "field-hint" }, hint) : null);

  switch (field.type) {
    case "text":
      return wrap(h("input", { id, class: "input", value: value ?? "", oninput: (e) => onChange(e.target.value) }));

    case "textarea":
      return wrap(h("textarea", { id, class: "textarea", rows: "4", oninput: (e) => onChange(e.target.value) }, value ?? ""));

    case "richtext":
      return wrap(
        h("textarea", { id, class: "textarea code", rows: "6", oninput: (e) => onChange(e.target.value) }, value ?? ""),
        "Tip: double-click the text on the page to edit it directly, with bold, italic and links.",
      );

    case "code":
      return wrap(
        h("textarea", { id, class: "textarea code", rows: "12", spellcheck: "false", oninput: (e) => onChange(e.target.value) }, value ?? ""),
        "Rendered exactly as written on the live site. Scripts only run on the published site.",
      );

    case "number":
      return wrap(h("input", { id, class: "input", type: "number", value: value ?? 0, oninput: (e) => e.target.value !== "" && onChange(Number(e.target.value)) }));

    case "checkbox":
      return h("div", { class: "field" }, h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!value, onchange: (e) => onChange(e.target.checked, { rebuild: true }) }), field.label));

    case "select": {
      const sel = h("select", { id, class: "select", onchange: (e) => {
        const opt = field.options[e.target.selectedIndex];
        onChange(opt, { rebuild: true });
      } }, field.options.map((o, i) => h("option", { value: String(o), selected: String(o) === String(value) }, field.labels?.[i] ?? capitalize(String(o)))));
      return wrap(sel);
    }

    case "url": {
      const listId = `${id}-list`;
      return wrap(
        h("div", {},
          h("input", { id, class: "input", value: value ?? "", list: listId, placeholder: "/page, #section, https://…, tel:…", oninput: (e) => onChange(e.target.value) }),
          h("datalist", { id: listId }, (ctx.links || []).map((l) => h("option", { value: l.value }, l.label))),
        ),
      );
    }

    case "color": {
      const swatch = h("input", { type: "color", value: value || "#000000", "aria-label": field.label });
      const text = h("input", { id, class: "input", value: value || "", maxlength: "7" });
      swatch.addEventListener("input", () => { text.value = swatch.value; onChange(swatch.value); });
      text.addEventListener("input", () => {
        if (/^#[0-9a-f]{6}$/i.test(text.value)) { swatch.value = text.value; onChange(text.value); }
      });
      return wrap(h("div", { class: "color-row" }, swatch, text));
    }

    case "image": {
      const thumb = h("div", { class: "img-thumb", role: "button", tabindex: "0", title: "Choose image" });
      const paint = (v) => {
        thumb.style.backgroundImage = v ? `url("${String(v).replace(/"/g, "%22")}")` : "";
        thumb.textContent = v ? "" : "Click to choose an image";
      };
      paint(value);
      const choose = () => ctx.pickImage((url) => { paint(url); onChange(url, { rebuild: true }); });
      thumb.addEventListener("click", choose);
      thumb.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } });
      return wrap(h("div", { class: "img-field" },
        thumb,
        h("div", { class: "row" },
          h("button", { class: "btn btn-sm grow", type: "button", onclick: choose }, value ? "Replace" : "Choose image"),
          value ? h("button", { class: "btn btn-sm btn-danger", type: "button", onclick: () => { paint(""); onChange("", { rebuild: true }); } }, "Remove") : null,
        ),
      ));
    }

    case "lines":
      return wrap(
        h("textarea", { id, class: "textarea", rows: String(Math.max(3, (value || []).length + 1)), oninput: (e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean)) }, (value || []).join("\n")),
        "One item per line.",
      );

    case "list":
      return listControl(field, value || [], onChange, ctx);

    default:
      return wrap(h("input", { id, class: "input", value: value ?? "", oninput: (e) => onChange(e.target.value) }));
  }
}

// Repeatable groups (buttons, FAQ items, stats…). Keeps which items are
// expanded across re-renders by index.
const openState = new WeakMap();

function listControl(field, items, onChange, ctx) {
  const container = h("div", { class: "field" }, h("span", { class: "field-label" }, field.label));
  const listEl = h("div", { class: "list-items" });
  const open = openState.get(field) || new Set([0]);
  openState.set(field, open);

  const update = (next, opts) => onChange(next, opts);

  items.forEach((item, i) => {
    const title = String(item[field.itemLabel] || "").trim() || `Item ${i + 1}`;
    const body = h("div", { class: "list-item-body", hidden: !open.has(i) },
      field.itemFields.map((f) => fieldControl(f, item[f.key], (v, opts) => {
        const next = items.map((it) => ({ ...it }));
        next[i][f.key] = v;
        update(next, opts);
      }, ctx)),
    );
    const move = (d) => {
      const j = i + d;
      if (j < 0 || j >= items.length) return;
      const next = items.slice();
      [next[i], next[j]] = [next[j], next[i]];
      open.delete(i); open.add(j);
      update(next, { rebuild: true });
    };
    listEl.append(h("div", { class: "list-item" },
      h("div", { class: "list-item-head", onclick: () => { body.hidden = !body.hidden; body.hidden ? open.delete(i) : open.add(i); } },
        h("span", { class: "t" }, title),
        h("button", { class: "icon-btn", type: "button", title: "Move up", disabled: i === 0, onclick: (e) => { e.stopPropagation(); move(-1); } }, "↑"),
        h("button", { class: "icon-btn", type: "button", title: "Move down", disabled: i === items.length - 1, onclick: (e) => { e.stopPropagation(); move(1); } }, "↓"),
        h("button", { class: "icon-btn", type: "button", title: "Remove", onclick: (e) => { e.stopPropagation(); open.delete(i); update(items.filter((_, j) => j !== i), { rebuild: true }); } }, "✕"),
      ),
      body,
    ));
  });

  container.append(listEl, h("button", { class: "btn btn-sm", type: "button", style: { marginTop: "8px" }, onclick: () => { open.add(items.length); update([...items, field.itemDefaults()], { rebuild: true }); } }, "+ Add"));
  return container;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
