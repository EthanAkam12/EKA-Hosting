// Image library: upload (button or drag-and-drop), pick, delete, or paste a URL.

import { h, api, modal, toast, confirmDialog } from "../ui.js";

export function openMediaPicker(siteId, onPick) {
  const grid = h("div", { class: "media-grid" });
  const status = h("span", { class: "small muted" });
  const fileInput = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif,image/avif", multiple: true, hidden: true, onchange: (e) => upload([...e.target.files]) });
  const zone = h("div", { class: "dropzone" },
    h("div", {}, "Drag photos here, or ", h("button", { class: "btn btn-sm", type: "button", onclick: () => fileInput.click() }, "Upload images")),
    h("div", { class: "small", style: { marginTop: "6px" } }, "Photos are automatically resized and compressed so the site stays fast."),
    status,
    fileInput,
  );
  const urlInput = h("input", { class: "input", placeholder: "…or paste an image URL (https://…)" });

  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("over");
    upload([...e.dataTransfer.files].filter((f) => f.type.startsWith("image/")));
  });

  const m = modal({
    title: "Images",
    wide: true,
    body: h("div", {}, zone, grid, h("div", { class: "row", style: { marginTop: "16px" } }, urlInput, h("button", { class: "btn", type: "button", onclick: () => {
      const v = urlInput.value.trim();
      if (!/^https:\/\//i.test(v)) return toast("Use a full https:// image link.", { error: true });
      onPick(v);
      m.close();
    } }, "Use URL"))),
  });

  async function refresh() {
    const { media: all } = await api(`/sites/${siteId}/media`);
    const media = all.filter((u) => !/\.(mp4|webm)$/i.test(u)); // videos are chosen in the video field
    grid.replaceChildren(
      ...(media.length ? media.map(item) : [h("p", { class: "muted", style: { gridColumn: "1/-1" } }, "No images yet. Upload some above.")]),
    );
  }

  function item(url) {
    const file = url.split("/").pop();
    const small = url.replace(/-o\.webp$/, "-o-sm.webp");
    return h("div", { class: "media-item", role: "button", tabindex: "0", title: "Use this image", onclick: () => { onPick(url); m.close(); }, onkeydown: (e) => { if (e.key === "Enter") { onPick(url); m.close(); } } },
      h("img", { src: small, alt: "", loading: "lazy", onerror: (e) => { if (e.target.src !== new URL(url, location.href).href) e.target.src = url; } }),
      h("button", { class: "del", title: "Delete image", "aria-label": "Delete image", onclick: async (e) => {
        e.stopPropagation();
        if (!(await confirmDialog("Delete this image? Any page still using it will show a gap.", { okText: "Delete", danger: true }))) return;
        await api(`/sites/${siteId}/media/${encodeURIComponent(file)}`, { method: "DELETE" });
        refresh();
      } }, "✕"),
    );
  }

  async function upload(files) {
    if (!files.length) return;
    let last = null;
    for (let i = 0; i < files.length; i++) {
      status.textContent = ` Uploading ${i + 1} of ${files.length}…`;
      try {
        const res = await api(`/sites/${siteId}/media`, { method: "POST", raw: true, body: files[i], headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(files[i].name) } });
        last = res.url;
      } catch (e) {
        toast(`${files[i].name}: ${e.message}`, { error: true });
      }
    }
    status.textContent = "";
    await refresh();
    if (files.length === 1 && last) { onPick(last); m.close(); }
  }

  refresh().catch((e) => toast(e.message, { error: true }));
}
