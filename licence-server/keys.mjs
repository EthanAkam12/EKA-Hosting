// Run once, on the computer or server that will run the licence server:
//
//   node licence-server/keys.mjs https://licence.yourdomain.com
//
// Makes the signing key pair. The private key stays in licence-server/data
// (never share it or put it on GitHub). The public key and the licence
// server's address go into server/licence-config.json, which every copy of
// the builder you sell uses to check licences: commit that file.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const url = (process.argv[2] || "").replace(/\/+$/, "");
if (!/^https?:\/\/[^/]+/.test(url)) {
  console.error("Give the licence server's address, e.g.  node licence-server/keys.mjs https://licence.yourdomain.com");
  process.exit(1);
}
const dataDir = path.join(here, "data");
const privFile = path.join(dataDir, "private-key.pem");
await fs.mkdir(dataDir, { recursive: true });
let privateKey;
try {
  privateKey = crypto.createPrivateKey(await fs.readFile(privFile, "utf8"));
  console.log("Using the existing private key in licence-server/data/private-key.pem.");
} catch {
  const pair = crypto.generateKeyPairSync("ed25519");
  privateKey = pair.privateKey;
  await fs.writeFile(privFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  console.log("Made a new private key: licence-server/data/private-key.pem (keep it safe and private; back it up).");
}
const publicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
const configFile = path.join(here, "..", "server", "licence-config.json");
await fs.writeFile(configFile, JSON.stringify({ server: url, publicKey }, null, 2) + "\n");
console.log(`Wrote server/licence-config.json (licence server: ${url}). Commit it, so the builders you sell check licences there.`);
