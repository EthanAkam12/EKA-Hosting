import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yazl from "yazl";
import { createWriteStream } from "node:fs";
import { createBackups } from "../server/backup.js";

test("backups: make, keep the newest, restore (with a safety copy), refuse bad files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eka-backup-"));
  await fs.mkdir(path.join(dir, "sites", "abc123", "media"), { recursive: true });
  await fs.writeFile(path.join(dir, "sites", "abc123", "meta.json"), '{"name":"Before"}');
  await fs.writeFile(path.join(dir, "sites", "abc123", "media", "photo.webp"), "img");
  await fs.writeFile(path.join(dir, "users.json"), '{"users":[1]}');
  await fs.mkdir(path.join(dir, "tmp-media"));
  await fs.writeFile(path.join(dir, "tmp-media", "skip.webp"), "x");
  let restored = 0;
  const b = createBackups({ dataDir: dir, keep: 2, onRestored: async () => { restored++; } });

  const first = await b.create();
  assert.match(first, /^eka-backup-\d{4}-\d{2}-\d{2}T[\d-]+\.zip$/);

  // Change things, then restore the first backup.
  await fs.writeFile(path.join(dir, "sites", "abc123", "meta.json"), '{"name":"After"}');
  await fs.mkdir(path.join(dir, "sites", "new999"));
  await b.restore({ name: first });
  assert.equal(await fs.readFile(path.join(dir, "sites", "abc123", "meta.json"), "utf8"), '{"name":"Before"}');
  assert.equal(await fs.readFile(path.join(dir, "sites", "abc123", "media", "photo.webp"), "utf8"), "img");
  await assert.rejects(fs.access(path.join(dir, "sites", "new999")), "sites made after the backup are gone");
  assert.equal(restored, 1);
  const list = await b.list();
  assert.ok(list.some((x) => x.label === "before-restore"), "what was there is backed up first");

  // Only the newest automatic backups are kept.
  await new Promise((r) => setTimeout(r, 1100));
  await b.create();
  await new Promise((r) => setTimeout(r, 1100));
  await b.create();
  assert.equal((await b.list()).filter((x) => !x.label).length, 2);

  // A zip that isn't a backup, or tries to write outside the folder, is refused.
  const bad = path.join(os.tmpdir(), `bad-${Date.now()}.zip`);
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from("x"), "notes.txt");
  zip.end();
  await new Promise((r) => zip.outputStream.pipe(createWriteStream(bad)).on("close", r));
  await assert.rejects(b.restore({ zipPath: bad }), /isn't an EKA backup/);
  assert.equal(await fs.readFile(path.join(dir, "users.json"), "utf8"), '{"users":[1]}', "nothing changed");
  await assert.rejects(b.restore({ name: "../../etc/passwd" }), /No such backup/);
  await fs.rm(bad);
  await fs.rm(dir, { recursive: true });
});
