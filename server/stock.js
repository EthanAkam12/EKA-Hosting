// Stock photos, free for commercial use, from Pexels or Pixabay (whichever
// has a key in the settings: PEXELS_API_KEY or PIXABAY_API_KEY). Used in two
// places:
//   - the image picker's "Stock photos" search, and
//   - new designs: empty picture spots are filled with photos that match the
//     business, instead of placeholder artwork.
// Photos are downloaded into the site (both services ask for that rather than
// linking to their servers). Without a key, the placeholder artwork is used.

import { saveUpload } from "./media.js";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Each service: how to search, how to read a result, and the only image
// servers photos may be downloaded from. (The *_API_URL / *_IMAGE_ORIGIN
// settings exist for testing against stand-in servers.)
const PROVIDERS = {
  pexels: {
    name: "Pexels",
    site: "https://www.pexels.com",
    api: (process.env.PEXELS_API_URL || "https://api.pexels.com/v1").replace(/\/$/, ""),
    hosts: new RegExp(`^${escape((process.env.PEXELS_IMAGE_ORIGIN || "https://images.pexels.com").replace(/\/$/, ""))}/`),
    request(api, key, q, { orientation, perPage, page }) {
      const params = new URLSearchParams({ query: q, per_page: String(perPage), page: String(page) });
      if (["landscape", "portrait", "square"].includes(orientation)) params.set("orientation", orientation);
      return { url: `${api}/search?${params}`, headers: { Authorization: key } };
    },
    photos: (data) => (data.photos || []).map((p) => ({
      id: p.id, alt: p.alt || "", width: p.width, height: p.height,
      thumb: p.src?.medium, large: p.src?.large2x || p.src?.large || p.src?.original,
      photographer: p.photographer, photographerUrl: p.photographer_url, pageUrl: p.url,
    })),
  },
  pixabay: {
    name: "Pixabay",
    site: "https://pixabay.com",
    api: (process.env.PIXABAY_API_URL || "https://pixabay.com/api").replace(/\/$/, ""),
    hosts: process.env.PIXABAY_IMAGE_ORIGIN ? new RegExp(`^${escape(process.env.PIXABAY_IMAGE_ORIGIN.replace(/\/$/, ""))}/`) : /^https:\/\/(cdn\.)?pixabay\.com\//,
    request(api, key, q, { orientation, perPage, page }) {
      const params = new URLSearchParams({ key, q, image_type: "photo", safesearch: "true", per_page: String(Math.max(3, perPage)), page: String(page) });
      if (orientation === "landscape") params.set("orientation", "horizontal");
      if (orientation === "portrait") params.set("orientation", "vertical");
      return { url: `${api}/?${params}`, headers: {} };
    },
    // Pixabay has no written descriptions; its tags ("clock, antique, time") stand in.
    photos: (data) => (data.hits || []).map((p) => ({
      id: p.id, alt: String(p.tags || "").split(",").map((t) => t.trim()).filter(Boolean).join(", "), width: p.imageWidth, height: p.imageHeight,
      thumb: p.webformatURL || p.previewURL, large: p.largeImageURL || p.webformatURL,
      photographer: p.user, photographerUrl: p.user_id ? `https://pixabay.com/users/${p.user}-${p.user_id}/` : "", pageUrl: p.pageURL,
    })),
  },
};

/** Which service the settings choose: Pexels if it has a key, else Pixabay. */
export function stockFromEnv(env = process.env) {
  if (env.PEXELS_API_KEY) return { provider: "pexels", apiKey: env.PEXELS_API_KEY };
  if (env.PIXABAY_API_KEY) return { provider: "pixabay", apiKey: env.PIXABAY_API_KEY };
  return { provider: "pexels", apiKey: "" };
}

export function createStock({ provider, apiKey, fetchImpl = fetch, photoHosts } = stockFromEnv()) {
  const service = PROVIDERS[provider || "pexels"];
  const hosts = photoHosts || service.hosts;
  const cache = new Map(); // request → { at, photos }

  async function search(query, { orientation, perPage = 24, page = 1 } = {}) {
    if (!apiKey) throw new Error("Stock photos aren't set up. Add a free Pixabay or Pexels API key in the settings.");
    const q = String(query || "").trim().slice(0, 100);
    if (!q) return [];
    const req = service.request(service.api, apiKey, q, { orientation, perPage, page });
    const hit = cache.get(req.url);
    if (hit && Date.now() - hit.at < 3600_000) return hit.photos;
    const res = await fetchImpl(req.url, { headers: req.headers });
    if (res.status === 429) throw new Error("Too many stock photo searches this hour. Try again shortly.");
    if (!res.ok) throw new Error(`Stock photo search failed (${res.status}). Check the ${service.name} API key.`);
    const photos = service.photos(await res.json()).filter((p) => p.thumb && p.large);
    cache.set(req.url, { at: Date.now(), photos });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return photos;
  }

  // Downloads a photo into a site's (or the wizard's) media folder, resized and
  // converted to WebP like any upload. Returns its URL.
  async function download(url, { dir, urlPrefix, name = "stock" }) {
    if (!hosts.test(String(url))) throw new Error(`That isn't a ${service.name} photo.`);
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Couldn't download the photo (${res.status}).`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return saveUpload({ dir, urlPrefix, buffer, filename: name });
  }

  return { enabled: !!apiKey, provider: provider || "pexels", name: service.name, site: service.site, search, download };
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
  const used = new Set([...`${JSON.stringify(site)} ${avoid}`.matchAll(new RegExp(`${stock.provider}-(\\d+)-`, "g"))].map((m) => Number(m[1])));
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
        slot.set(await stock.download(photo.large, { dir, urlPrefix, name: `${stock.provider}-${photo.id}` }), photo);
        added++;
      } catch (err) {
        console.warn("Stock photo skipped:", err.message);
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return added;
}
