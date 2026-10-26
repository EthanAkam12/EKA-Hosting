// Image and video uploads. Photos are resized and converted to WebP in two
// sizes so customer sites stay fast even when the owner uploads 8MB phone
// photos. Videos (for video backgrounds) are stored as they are.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

let sharp = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.warn("sharp is not installed: uploaded images will be stored without optimisation.");
}

const TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};
export const MAX_VIDEO_MB = 40;

function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.slice(0, 3).toString() === "GIF") return "image/gif";
  if (buf.slice(4, 12).toString() === "ftypavif") return "image/avif";
  if (buf.slice(4, 8).toString() === "ftyp") return "video/mp4"; // MP4 / MOV-style ISO media
  if (buf.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  return null;
}

// urlPrefix is where the file will be served from, e.g. "/_m/<siteId>/".
export async function saveUpload({ dir, siteId, urlPrefix = `/_m/${siteId}/`, buffer, filename, allowVideo = true }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("No file received.");
  const type = sniff(buffer);
  if (!type) throw new Error("Please upload a JPG, PNG, WebP, GIF or AVIF image, or an MP4 or WebM video.");
  if (type.startsWith("video/") && !allowVideo) throw new Error("Video uploads are switched off in the demo. You can still use a YouTube or Vimeo link.");
  if (type.startsWith("video/") && buffer.length > MAX_VIDEO_MB * 1024 * 1024) throw new Error(`Videos can be up to ${MAX_VIDEO_MB} MB. For a background, 10–20 seconds at 1280px wide is plenty (usually 3–8 MB).`);
  await fs.mkdir(dir, { recursive: true });

  const base = path.parse(String(filename)).name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || (type.startsWith("video/") ? "video" : "image");
  const stem = `${base}-${crypto.randomBytes(4).toString("hex")}`;

  // Animated GIFs and videos are kept as-is; other images are optimised.
  if (sharp && type.startsWith("image/") && type !== "image/gif") {
    const image = sharp(buffer, { failOn: "error" }).rotate(); // apply EXIF orientation
    await image.clone().resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(dir, `${stem}-o.webp`));
    await image.clone().resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(dir, `${stem}-o-sm.webp`));
    return `${urlPrefix}${stem}-o.webp`;
  }

  const file = `${stem}.${TYPES[type]}`;
  await fs.writeFile(path.join(dir, file), buffer);
  return `${urlPrefix}${file}`;
}

export async function deleteUpload(dir, file) {
  if (!/^[\w.-]+$/.test(file) || file.startsWith(".")) return;
  await fs.rm(path.join(dir, file), { force: true });
  if (file.endsWith("-o.webp")) await fs.rm(path.join(dir, file.replace(/-o\.webp$/, "-o-sm.webp")), { force: true });
}
