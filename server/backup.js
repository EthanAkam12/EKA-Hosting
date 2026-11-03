// Backups of everything the builder keeps: websites, images, form messages,
// customers, plans, usage and settings made by the builder (not settings.txt).
//
// A backup is one .zip in BACKUP_DIR (default: <data folder>/backups). One is
// made automatically each day and the newest BACKUP_KEEP (default 7) are
// kept. Restoring replaces the data folder's contents with a backup's, after
// backing up what's there now.

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import yazl from "yazl";
import yauzl from "yauzl";

const SKIP = new Set(["backups", "tmp-media", ".restore-tmp"]);
const NAME = /^eka-backup-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})(-[\w-]+)?\.zip$/;

async function* walk(dir, rel = "") {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!rel && SKIP.has(entry.name)) continue;
    if (entry.name.endsWith(".tmp")) continue;
    const full = path.join(dir, entry.name), r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walk(full, r);
    else if (entry.isFile()) yield { full, rel: r };
  }
}

export function createBackups({ dataDir, backupDir = path.join(dataDir, "backups"), keep = 7, onRestored = async () => {} }) {
  let busy = null;

  async function list() {
    await fs.mkdir(backupDir, { recursive: true });
    const out = [];
    for (const name of await fs.readdir(backupDir)) {
      const m = name.match(NAME);
      if (!m) continue;
      const st = await fs.stat(path.join(backupDir, name));
      out.push({ name, size: st.size, at: m[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3") + "Z", label: (m[2] || "").slice(1) });
    }
    return out.sort((a, b) => b.name.localeCompare(a.name));
  }

  async function create(label = "") {
    if (busy) return busy;
    busy = (async () => {
      await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
      const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
      const name = `eka-backup-${stamp}${label ? `-${label.replace(/[^\w-]/g, "")}` : ""}.zip`;
      const tmp = path.join(backupDir, `${name}.tmp`);
      const zip = new yazl.ZipFile();
      for await (const f of walk(dataDir)) zip.addFile(f.full, f.rel);
      zip.end();
      await new Promise((resolve, reject) => zip.outputStream.pipe(createWriteStream(tmp, { mode: 0o600 })).on("close", resolve).on("error", reject));
      await fs.rename(tmp, path.join(backupDir, name));
      // Keep the newest automatic backups; labelled ones (before restores) are kept too, up to the same number.
      const all = await list();
      for (const group of [all.filter((b) => !b.label), all.filter((b) => b.label)]) {
        for (const old of group.slice(keep)) await fs.rm(path.join(backupDir, old.name)).catch(() => {});
      }
      return name;
    })().finally(() => { busy = null; });
    return busy;
  }

  const file = (name) => {
    if (!NAME.test(String(name))) throw new Error("No such backup.");
    return path.join(backupDir, name);
  };

  /** Restores a backup by name, or from a .zip file anywhere (e.g. an upload). */
  async function restore({ name, zipPath }) {
    const source = zipPath || file(name);
    const tmp = path.join(dataDir, ".restore-tmp");
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.mkdir(tmp, { recursive: true });
    try {
      await unzip(source, tmp);
      try { await fs.access(path.join(tmp, "sites")); } catch { throw new Error("That file isn't an EKA backup (it has no websites folder)."); }
      await create("before-restore");
      // Swap: remove current contents (except backups), move restored ones in.
      for (const entry of await fs.readdir(dataDir)) {
        if (SKIP.has(entry)) continue;
        await fs.rm(path.join(dataDir, entry), { recursive: true, force: true });
      }
      for (const entry of await fs.readdir(tmp)) await fs.rename(path.join(tmp, entry), path.join(dataDir, entry));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
    await onRestored();
  }

  // A backup now if the newest automatic one is a day old, checked hourly.
  async function daily() {
    const last = (await list()).find((b) => !b.label);
    if (!last || Date.now() - Date.parse(last.at) > 23.5 * 3600_000) await create().catch((err) => console.warn("Automatic backup failed:", err.message));
  }
  return { list, create, restore, file, daily };
}

// Extracts a zip safely: no paths outside `dest`, no links.
function unzip(zipPath, dest) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, strictFileNames: true }, (err, zip) => {
      if (err) return reject(new Error("That file isn't a readable .zip."));
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry) => {
        const target = path.resolve(dest, entry.fileName);
        if (!target.startsWith(path.resolve(dest) + path.sep)) return reject(new Error("The backup has a file outside its folder."));
        if (/\/$/.test(entry.fileName)) return fs.mkdir(target, { recursive: true }).then(() => zip.readEntry(), reject);
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          fs.mkdir(path.dirname(target), { recursive: true }).then(() => {
            stream.pipe(createWriteStream(target, { mode: 0o600 })).on("close", () => zip.readEntry()).on("error", reject);
          }, reject);
        });
      });
      zip.readEntry();
    });
  });
}
