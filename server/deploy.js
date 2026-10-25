// "Publish to hosting": uploads a site's files to any normal web host over FTP
// (or FTPS, the encrypted version, when the host supports it).
//
// Only files that changed since the last upload are sent. Files are removed
// from the host only if this builder uploaded them before, so anything else
// in the folder (the host's own files, other apps) is never touched.

import { Readable } from "node:stream";
import * as ftp from "basic-ftp";
import { fileHash } from "./export.js";

const TIMEOUT_MS = 30000;

async function connect(settings) {
  const client = new ftp.Client(TIMEOUT_MS);
  const secure = settings.secure !== "none";
  try {
    await client.access({
      host: settings.host,
      port: Number(settings.port) || 21,
      user: settings.user,
      password: settings.password,
      secure,
      // Many shared hosts use a certificate for the server's own name rather
      // than the customer's domain; allow that, the connection is still encrypted.
      secureOptions: { rejectUnauthorized: false },
    });
  } catch (err) {
    client.close();
    throw friendlyError(err, secure);
  }
  return client;
}

function friendlyError(err, secure) {
  const msg = String(err?.message || err);
  if (/530|login|auth/i.test(msg)) return new Error("The hosting rejected the username or password. Check the FTP login details.");
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return new Error("Couldn't find that server. Check the FTP server name (e.g. ftp.yourdomain.co.uk).");
  if (/ECONNREFUSED|ETIMEDOUT|Timeout/i.test(msg)) return new Error("Couldn't connect to the server. Check the server name and port, or try again in a minute.");
  if (secure && /TLS|SSL|AUTH|534|550 SSL/i.test(msg)) return new Error("The server doesn't support encrypted FTP. Untick 'Use encrypted connection' and try again.");
  return new Error(`Upload failed: ${msg}`);
}

function remoteDir(settings) {
  const dir = String(settings.remoteDir || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return dir || "/";
}

export async function testConnection(settings) {
  const client = await connect(settings);
  try {
    await client.cd(remoteDir(settings)).catch(() => {
      throw new Error(`Connected, but the folder "${remoteDir(settings)}" doesn't exist. Websites usually go in public_html or htdocs.`);
    });
    const list = await client.list();
    return { ok: true, entries: list.slice(0, 12).map((f) => f.name) };
  } finally {
    client.close();
  }
}

/**
 * @param files     [{ path, content: Buffer }]
 * @param previous  { path: hash } from the last upload
 * @returns         { manifest, uploaded, deleted, unchanged }
 */
export async function deploy({ settings, files, previous = {}, onProgress }) {
  const next = Object.fromEntries(files.map((f) => [f.path, fileHash(f.content)]));
  const changed = files.filter((f) => previous[f.path] !== next[f.path]);
  const removed = Object.keys(previous).filter((p) => !(p in next));
  const total = changed.length + removed.length;
  let done = 0;
  onProgress?.({ done, total });

  const client = await connect(settings);
  const root = remoteDir(settings);
  try {
    await client.cd(root).catch(() => {
      throw new Error(`The folder "${root}" doesn't exist on the hosting. Websites usually go in public_html or htdocs.`);
    });
    const base = await client.pwd();

    // Upload smaller files first so pages appear quickly; folders are created as needed.
    for (const file of changed.sort((a, b) => a.content.length - b.content.length)) {
      const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
      await client.cd(base);
      if (dir) await client.ensureDir(dir);
      await client.uploadFrom(Readable.from(file.content), file.path.split("/").pop());
      onProgress?.({ done: ++done, total, file: file.path });
    }
    for (const p of removed) {
      await client.cd(base);
      await client.remove(p, true).catch(() => {}); // already gone is fine
      onProgress?.({ done: ++done, total, file: p });
    }
  } catch (err) {
    throw err.message?.startsWith("The folder") ? err : friendlyError(err, settings.secure !== "none");
  } finally {
    client.close();
  }
  return { manifest: next, uploaded: changed.length, deleted: removed.length, unchanged: files.length - changed.length };
}
