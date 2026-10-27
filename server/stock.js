// Stock photos from Pexels (free for commercial use; a free API key from
// pexels.com/api goes in PEXELS_API_KEY). Used in two places:
//   - the image picker's "Stock photos" search, and
//   - new designs: empty picture spots are filled with photos that match the
//     business, instead of placeholder artwork.
// Without a key, everything falls back to the placeholder artwork.

import { saveUpload } from "./media.js";

const API = (process.env.PEXELS_API_URL || "https://api.pexels.com/v1").replace(/\/$/, "");
// Only photos from Pexels' own image servers are ever downloaded.
// (PEXELS_IMAGE_ORIGIN exists for testing against a stand-in server.)
const IMAGE_ORIGIN = (process.env.PEXELS_IMAGE_ORIGIN || "https://images.pexels.com").replace(/\/$/, "");
const PHOTO_HOSTS = new RegExp(`^${IMAGE_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`);

export function createStock({ apiKey = process.env.PEXELS_API_KEY, fetchImpl = fetch, photoHosts = PHOTO_HOSTS } = {}) {
  const cache = new Map(); // query → { at, photos }

  async function search(query, { orientation, perPage = 24, page = 1 } = {}) {
    if (!apiKey) throw new Error("Stock photos aren't set up. Add a free Pexels API key (PEXELS_API_KEY) in the settings.");
    const q = String(query || "").trim().slice(0, 100);
    if (!q) return [];
    const params = new URLSearchParams({ query: q, per_page: String(perPage), page: String(page) });
    if (["landscape", "portrait", "square"].includes(orientation)) params.set("orientation", orientation);
    const key = params.toString();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 3600_000) return hit.photos;
    const res = await fetchImpl(`${API}/search?${key}`, { headers: { Authorization: apiKey } });
    if (res.status === 429) throw new Error("Too many stock photo searches this hour. Try again shortly.");
    if (!res.ok) throw new Error(`Stock photo search failed (${res.status}). Check the Pexels API key.`);
    const data = await res.json();
    const photos = (data.photos || []).map((p) => ({
      id: p.id,
      alt: p.alt || "",
      width: p.width,
      height: p.height,
      thumb: p.src?.medium,
      large: p.src?.large2x || p.src?.large || p.src?.original,
      photographer: p.photographer,
      photographerUrl: p.photographer_url,
      pageUrl: p.url,
    })).filter((p) => p.thumb && p.large);
    cache.set(key, { at: Date.now(), photos });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return photos;
  }

  // Downloads a photo into a site's (or the wizard's) media folder, resized and
  // converted to WebP like any upload. Returns its URL.
  async function download(url, { dir, urlPrefix, name = "stock" }) {
    if (!photoHosts.test(String(url))) throw new Error("That isn't a Pexels photo.");
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Couldn't download the photo (${res.status}).`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return saveUpload({ dir, urlPrefix, buffer, filename: name });
  }

  return { enabled: !!apiKey, search, download };
}

// A short photo search for the business when the design doesn't give one:
// the start of the description, e.g. "Antique shop by the sea selling clocks".
export function keywordsFromBrief(brief = {}) {
  const text = String(brief.description || brief.name || "").split(/[.,;:\n]/)[0];
  return text.split(/\s+/).filter(Boolean).slice(0, 7).join(" ");
}

/**
 * Fills empty picture spots (image blocks, empty galleries, image section
 * backgrounds) with stock photos that suit them: an image's own alt text if
 * it describes a photo, otherwise the business's photo keywords. Each photo
 * is used once per site. Spots that can't be filled are left empty, for
 * fillPlaceholders() to cover. Returns how many photos were added.
 */
export async function fillStockPhotos(site, { stock, dir, urlPrefix, keywords, avoid = "" }) {
  if (!stock?.enabled) return 0;
  const base = String(site.business?.keywords || keywords || site.business?.type || site.name).slice(0, 100);
  // Photos already on the site (or on its other pages, passed as `avoid`) aren't used again.
  const used = new Set([...`${JSON.stringify(site)} ${avoid}`.matchAll(/pexels-(\d+)-/g)].map((m) => Number(m[1])));
  const slots = [];
  for (const page of site.pages) {
    for (const section of page.sections) {
      if (section.props.background === "image" && !section.props.image) {
        slots.push({ query: base, orientation: "landscape", set: (url) => { section.props.image = url; } });
      }
      for (const column of section.columns) {
        for (const block of column.blocks) {
          if (block.type === "image" && !block.props.src) {
            const alt = block.props.alt?.trim();
            const ratio = block.props.ratio;
            slots.push({
              query: alt && alt.split(/\s+/).length >= 2 ? alt : base,
              orientation: ratio === "3:4" ? "portrait" : ratio === "1:1" ? "square" : "landscape",
              set: (url, photo) => { block.props.src = url; if (!alt) block.props.alt = photo.alt; },
            });
          }
          if (block.type === "gallery" && !block.props.images.some((i) => i.src)) {
            block.props.images = [];
            for (let i = 0; i < 6; i++) slots.push({ query: base, orientation: "square", set: (url, photo) => block.props.images.push({ src: url, alt: photo.alt }) });
          }
        }
      }
    }
  }
  let added = 0;
  // Four downloads at a time.
  const queue = slots.slice();
  async function worker() {
    for (let slot = queue.shift(); slot; slot = queue.shift()) {
      try {
        let photos = await stock.search(slot.query, { orientation: slot.orientation });
        if (!photos.some((p) => !used.has(p.id)) && slot.query !== base) photos = await stock.search(base, { orientation: slot.orientation });
        // A random pick from the best unused matches, so separately designed pages rarely repeat.
        const fresh = photos.filter((p) => !used.has(p.id)).slice(0, 8);
        const photo = fresh[Math.floor(Math.random() * fresh.length)];
        if (!photo) continue;
        used.add(photo.id);
        slot.set(await stock.download(photo.large, { dir, urlPrefix, name: `pexels-${photo.id}` }), photo);
        added++;
      } catch (err) {
        console.warn("Stock photo skipped:", err.message);
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return added;
}
