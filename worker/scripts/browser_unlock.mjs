// End-to-end check of the Pro unlock path in a real browser, run by tests/test_pro.py:
//   node worker/scripts/browser_unlock.mjs <bundle.json> <private-jwk.json>
// Serves a page plus the real Worker code as a local mock /unlock (test keys, in-memory KV) and has
// Chromium's WebCrypto fetch the bundle, unlock its content key and decrypt it. Prints the plaintext.
import http from "node:http";
import fs from "node:fs";
import { createRequire } from "node:module";
import { handle } from "../src/index.js";

const require = createRequire(import.meta.url);
const { chromium } = require("../../node_modules/playwright");

const [bundlePath, jwkPath] = process.argv.slice(2);
const bundle = fs.readFileSync(bundlePath, "utf8");
const store = new Map();
const env = {
  LICENSES: { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, String(v)) },
  PRO_PRIVATE_KEY: fs.readFileSync(jwkPath, "utf8"),
  SITE_ORIGIN: "http://127.0.0.1",
};
const KEY = "WP-ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345";
store.set(`lic:${KEY}`, JSON.stringify({ plan: "pro", expires: new Date(Date.now() + 86400000).toISOString(), revoked: false }));

const PAGE = `<!doctype html><meta charset="utf-8"><script>
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function openPro(licenseKey) {
  const b = (await (await fetch("api/v1/pro/bundle.json")).json()).data;
  const r = await fetch("/unlock", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: licenseKey, wrapped_key: b.wrapped_key }) });
  const u = await r.json();
  if (!r.ok) return { status: r.status, error: u.error };
  const key = await crypto.subtle.importKey("raw", unb64u(u.content_key), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(b.iv), additionalData: new TextEncoder().encode(b.id) }, key, unb64u(b.ct));
  return { status: r.status, topic: u.alerts.topic, content: JSON.parse(new TextDecoder().decode(plain)) };
}
</script>`;

const server = http.createServer(async (req, res) => {
  if (req.url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  if (req.url === "/api/v1/pro/bundle.json") return res.writeHead(200, { "content-type": "application/json" }).end(bundle);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const r = await handle(new Request(`http://127.0.0.1${req.url}`, {
    method: req.method, headers: { "content-type": "application/json", origin: env.SITE_ORIGIN }, body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
  }), env, { waitUntil() {} });
  res.writeHead(r.status, { "content-type": "application/json" }).end(await r.text());
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const good = await page.evaluate((k) => openPro(k), KEY.toLowerCase());
  const bad = await page.evaluate(() => openPro("WP-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ"));
  console.log(JSON.stringify({ good, bad }));
} finally {
  await browser.close();
  server.close();
}
