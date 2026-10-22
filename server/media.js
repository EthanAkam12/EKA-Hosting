// Image uploads. Photos are resized and converted to WebP in two sizes so
// customer sites stay fast even when the owner uploads 8MB phone photos.

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
};

function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.slice(0, 3).toString() === "GIF") return "image/gif";
  if (buf.slice(4, 12).toString() === "ftypavif") return "image/avif";
  return null;
}

export async function saveUpload({ dir, siteId, buffer, filename }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("No file received.");
  const type = sniff(buffer);
  if (!type) throw new Error("Please upload a JPG, PNG, WebP, GIF or AVIF image.");
  await fs.mkdir(dir, { recursive: true });

  const base = path.parse(String(filename)).name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "image";
  const stem = `${base}-${crypto.randomBytes(4).toString("hex")}`;

  // Animated GIFs are kept as-is; everything else is optimised.
  if (sharp && type !== "image/gif") {
    const image = sharp(buffer, { failOn: "error" }).rotate(); // apply EXIF orientation
    await image.clone().resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(dir, `${stem}-o.webp`));
    await image.clone().resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(dir, `${stem}-o-sm.webp`));
    return `/_m/${siteId}/${stem}-o.webp`;
  }

  const file = `${stem}.${TYPES[type]}`;
  await fs.writeFile(path.join(dir, file), buffer);
  return `/_m/${siteId}/${file}`;
}

export async function deleteUpload(dir, file) {
  if (!/^[\w.-]+$/.test(file) || file.startsWith(".")) return;
  await fs.rm(path.join(dir, file), { force: true });
  if (file.endsWith("-o.webp")) await fs.rm(path.join(dir, file.replace(/-o\.webp$/, "-o-sm.webp")), { force: true });
}
