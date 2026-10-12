// Unit tests for the license server, with an in-memory KV and a mocked fetch: node --test test/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { handle, newKey, normalizeKey, runAlerts, detectAlerts, b64u, unb64u, emailHash } from "../src/index.js";

const ORIGIN = "https://ilicvix02.github.io";
const DAY = 86400000;

class MemoryKV {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v) { this.map.set(k, String(v)); }
  async delete(k) { this.map.delete(k); }
}

let env, ctx, sent, waits;

async function testEnv() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return {
    LICENSES: new MemoryKV(),
    PRO_PRIVATE_KEY: JSON.stringify(jwk),
    KOFI_VERIFICATION_TOKEN: "test-verification-token",
    BREVO_API_KEY: "test-brevo",
    ADMIN_TOKEN: "test-admin-token-long-random",
    SENDER_EMAIL: "sender@example.org",
    SITE_ORIGIN: ORIGIN,
    _public: pair.publicKey,
  };
}

beforeEach(async () => {
  env = await testEnv();
  sent = [];
  waits = [];
  ctx = { waitUntil: (p) => waits.push(p) };
  globalThis.fetch = async (url, init = {}) => {
    sent.push({ url: String(url), init });
    if (String(url).endsWith("/conflicts.json")) return new Response(JSON.stringify(globalThis.__conflicts), { status: 200 });
    return new Response("{}", { status: 201 });
  };
});

const settle = () => Promise.all(waits.splice(0));

function kofiRequest(data, token = "test-verification-token") {
  const body = new URLSearchParams({ data: JSON.stringify({ verification_token: token, ...data }) });
  return new Request("https://pro.example/kofi", { method: "POST", body });
}

function payment(over = {}) {
  return {
    message_id: "m-" + Math.random(), timestamp: "2026-10-01T10:00:00Z", type: "Subscription", is_public: true,
    from_name: "Ada", amount: "3.00", email: "Ada@Example.org", currency: "USD", is_subscription_payment: true,
    is_first_subscription_payment: true, kofi_transaction_id: "tx-1", tier_name: "World Pulse Pro", ...over,
  };
}

function post(path, body, headers = {}) {
  return new Request(`https://pro.example${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "cf-connecting-ip": "1.2.3.4", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function call(req) {
  const res = await handle(req, env, ctx);
  await settle();
  return { res, body: await res.json().catch(() => null) };
}

// Wrap a content key the way worldpulse/pro.py does, for /unlock.
async function wrap(contentKey, id) {
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const epkRaw = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: env._public }, eph.privateKey, 256);
  const hk = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const kek = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: epkRaw, info: new TextEncoder().encode("worldpulse-pro-wrap-v1") },
    hk, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(id) }, kek, contentKey);
  return `v1.${id}.${b64u(epkRaw)}.${b64u(iv)}.${b64u(ct)}`;
}

async function licenseFor(email) {
  const key = await env.LICENSES.get(`sub:${await emailHash(email)}`);
  return { key, lic: JSON.parse(await env.LICENSES.get(`lic:${key}`)) };
}

test("license keys are random, 140-bit, and normalize from sloppy input", () => {
  const a = newKey(), b = newKey();
  assert.match(a, /^WP(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
  assert.notEqual(a, b);
  assert.equal(normalizeKey(a.toLowerCase().replace(/-/g, " ")), a);
  assert.equal(normalizeKey("WP-1234"), null);
  assert.equal(normalizeKey(42), null);
});

test("webhook rejects a wrong verification token and bad payloads", async () => {
  assert.equal((await call(kofiRequest(payment(), "wrong"))).res.status, 401);
  const bad = new Request("https://pro.example/kofi", { method: "POST", body: new URLSearchParams({ data: "{nope" }) });
  assert.equal((await call(bad)).res.status, 400);
  assert.equal(env.LICENSES.map.size, 0);
});

test("first payment creates a 35-day license and emails the key and one-tap link", async () => {
  const { res, body } = await call(kofiRequest(payment()));
  assert.equal(res.status, 200);
  assert.equal(body.plan, "pro");
  const { key, lic } = await licenseFor("ada@example.org");
  assert.match(key, /^WP-/);
  assert.equal(lic.expires, new Date(Date.parse("2026-10-01T10:00:00Z") + 35 * DAY).toISOString());
  assert.ok(!JSON.stringify([...env.LICENSES.map]).toLowerCase().includes("ada@example.org"), "email stored in clear");
  const mail = sent.find((s) => s.url.includes("api.brevo.com"));
  assert.ok(mail);
  assert.equal(mail.init.headers["api-key"], "test-brevo");
  const msg = JSON.parse(mail.init.body);
  assert.equal(msg.to[0].email, "Ada@Example.org");
  assert.ok(msg.textContent.includes(key));
  assert.ok(msg.htmlContent.includes(`#/pro?key=${encodeURIComponent(key)}`));
});

test("webhook is idempotent on kofi_transaction_id", async () => {
  await call(kofiRequest(payment()));
  const { lic: before } = await licenseFor("ada@example.org");
  const again = await call(kofiRequest(payment()));
  assert.equal(again.body.ignored, "already processed");
  const { lic: after } = await licenseFor("ada@example.org");
  assert.equal(after.expires, before.expires);
  assert.equal(sent.filter((s) => s.url.includes("brevo")).length, 1);
});

test("renewals extend the same key; business tier maps to business; others are ignored", async () => {
  await call(kofiRequest(payment()));
  const { key } = await licenseFor("ada@example.org");
  await call(kofiRequest(payment({ kofi_transaction_id: "tx-2", timestamp: "2026-10-31T10:00:00Z", is_first_subscription_payment: false, tier_name: "Business" })));
  const { key: same, lic } = await licenseFor("ada@example.org");
  assert.equal(same, key);
  assert.equal(lic.plan, "business");
  assert.equal(lic.renewals, 1);
  assert.equal(lic.expires, new Date(Date.parse("2026-10-01T10:00:00Z") + 70 * DAY).toISOString());
  assert.equal(sent.filter((s) => s.url.includes("brevo")).length, 1, "renewals send no email");

  for (const p of [payment({ type: "Donation", kofi_transaction_id: "d" }), payment({ tier_name: "Fan club", kofi_transaction_id: "f" }),
    payment({ is_subscription_payment: false, kofi_transaction_id: "s" })]) {
    assert.ok((await call(kofiRequest(p))).body.ignored);
  }
});

test("unlock: valid key gets the content key and alerts topic; expired, unknown and revoked get 403", async () => {
  await call(kofiRequest(payment({ timestamp: new Date().toISOString() })));
  const { key } = await licenseFor("ada@example.org");
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await wrap(contentKey, "20261012-abc");

  const ok = await call(post("/unlock", { key: key.toLowerCase(), wrapped_key: wrapped }));
  assert.equal(ok.res.status, 200);
  assert.equal(ok.res.headers.get("access-control-allow-origin"), ORIGIN);
  assert.deepEqual(unb64u(ok.body.content_key), contentKey);
  assert.equal(ok.body.bundle_id, "20261012-abc");
  assert.match(ok.body.alerts.topic, /^wp-pro-[A-Za-z0-9]{24}$/);

  assert.equal((await call(post("/unlock", { key: newKey(), wrapped_key: wrapped }))).res.status, 403);
  assert.equal((await call(post("/unlock", { key, wrapped_key: wrapped.replace(".20261012-abc.", ".other.") }))).res.status, 400);
  assert.equal((await call(post("/unlock", { key: "nope", wrapped_key: wrapped }))).res.status, 400);

  const lic = JSON.parse(await env.LICENSES.get(`lic:${key}`));
  await env.LICENSES.put(`lic:${key}`, JSON.stringify({ ...lic, expires: new Date(Date.now() - 1000).toISOString() }));
  const expired = await call(post("/unlock", { key, wrapped_key: wrapped }));
  assert.equal(expired.res.status, 403);
  assert.equal(expired.body.reason, "expired");
  assert.equal(expired.body.content_key, undefined);
});

test("admin revoke needs the token and blocks unlock", async () => {
  await call(kofiRequest(payment({ timestamp: new Date().toISOString() })));
  const { key } = await licenseFor("ada@example.org");
  assert.equal((await call(post("/admin/revoke", { key }, { authorization: "Bearer wrong" }))).res.status, 401);
  assert.equal((await call(post("/admin/revoke", { key }))).res.status, 401);
  const ok = await call(post("/admin/revoke", { email: "ada@example.org" }, { authorization: `Bearer ${env.ADMIN_TOKEN}` }));
  assert.equal(ok.res.status, 200);
  const res = await call(post("/unlock", { key, wrapped_key: await wrap(new Uint8Array(32), "b1") }));
  assert.equal(res.res.status, 403);
  assert.equal(res.body.reason, "revoked");
});

test("claim answers the same either way and only emails active licenses", async () => {
  await call(kofiRequest(payment({ timestamp: new Date().toISOString() })));
  sent = [];
  const a = await call(post("/claim", { email: "ada@example.org" }));
  const b = await call(post("/claim", { email: "nobody@example.org" }, { "cf-connecting-ip": "5.6.7.8" }));
  assert.equal(a.res.status, 200);
  assert.deepEqual(a.body, b.body);
  const mails = sent.filter((s) => s.url.includes("brevo"));
  assert.equal(mails.length, 1);
  assert.equal(JSON.parse(mails[0].init.body).to[0].email, "ada@example.org");
  assert.equal((await call(post("/claim", { email: "not-an-email" }))).res.status, 400);
});

test("rate limits: claim per IP and per email, unlock per key", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call(post("/claim", { email: `u${i}@example.org` }))).res.status, 200);
  assert.equal((await call(post("/claim", { email: "u9@example.org" }))).res.status, 429);

  await call(kofiRequest(payment({ timestamp: new Date().toISOString() })));
  const { key } = await licenseFor("ada@example.org");
  sent = [];
  for (let i = 0; i < 4; i++) await call(post("/claim", { email: "ada@example.org" }, { "cf-connecting-ip": `9.9.9.${i}` }));
  assert.equal(sent.filter((s) => s.url.includes("brevo")).length, 3, "per-email cap of 3 a day");

  const wrapped = await wrap(new Uint8Array(32), "b1");
  let last;
  for (let i = 0; i < 31; i++) last = await call(post("/unlock", { key, wrapped_key: wrapped }, { "cf-connecting-ip": `8.8.${i}.1` }));
  assert.equal(last.res.status, 429);
});

test("CORS: only the site and app origins; preflight; input validation; no stack traces", async () => {
  const pre = await handle(new Request("https://pro.example/unlock", { method: "OPTIONS", headers: { origin: ORIGIN } }), env, ctx);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), ORIGIN);
  const evil = await handle(new Request("https://pro.example/unlock", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), env, ctx);
  assert.equal(evil.status, 403);
  const blocked = await call(post("/unlock", {}, { origin: "https://evil.example" }));
  assert.equal(blocked.res.status, 403);
  assert.equal(blocked.res.headers.get("access-control-allow-origin"), null);
  const native = await call(post("/claim", { email: "x@example.org" }, { origin: "capacitor://localhost" }));
  assert.equal(native.res.headers.get("access-control-allow-origin"), "capacitor://localhost");

  assert.equal((await call(post("/unlock", "[1,2]"))).res.status, 400);
  assert.equal((await call(post("/unlock", "x".repeat(20000)))).res.status, 413);
  assert.equal((await call(new Request("https://pro.example/nope"))).res.status, 404);

  env.LICENSES.get = async () => { throw new Error("secret detail"); };
  const boom = await call(post("/claim", { email: "x@example.org" }));
  assert.equal(boom.res.status, 500);
  assert.deepEqual(boom.body, { ok: false, error: "internal error" });
});

test("pubkey publishes only the public half; health works", async () => {
  const { body } = await call(new Request("https://pro.example/pubkey"));
  assert.equal(body.crv, "P-256");
  assert.equal(body.d, undefined);
  assert.match(body.kid, /^[0-9a-f]{16}$/);
  assert.equal((await call(new Request("https://pro.example/health"))).body.ok, true);
});

test("cron alerts: newly critical or escalating theaters, de-duplicated, at most 6 a day", async () => {
  const theater = (id, status, trend) => ({ id, name: id.toUpperCase(), status, trend, intensity: 80, stories_24h: 9, description: "d" });
  globalThis.__conflicts = { data: { theaters: [theater("a", "high", "steady"), theater("b", "elevated", "steady")] } };
  assert.equal((await runAlerts(env)).sent, 0, "first poll only records state");

  globalThis.__conflicts = { data: { theaters: [theater("a", "critical", "escalating"), theater("b", "elevated", "escalating")] } };
  sent = [];
  const r = await runAlerts(env);
  assert.equal(r.sent, 1, "b is escalating but below high");
  const push = sent.find((s) => s.url.startsWith("https://ntfy.sh/wp-pro-"));
  assert.equal(push.init.headers.Title, "A: now critical");

  // flapping back and forth sends nothing new the same day
  globalThis.__conflicts = { data: { theaters: [theater("a", "high", "steady"), theater("b", "elevated", "steady")] } };
  await runAlerts(env);
  globalThis.__conflicts = { data: { theaters: [theater("a", "critical", "steady"), theater("b", "elevated", "steady")] } };
  assert.equal((await runAlerts(env)).sent, 0);

  const prev = Object.fromEntries("cdefghij".split("").map((id) => [id, { status: "high", trend: "steady" }]));
  const many = detectAlerts(prev, "cdefghij".split("").map((id) => theater(id, "critical", "steady")));
  assert.equal(many.length, 8);
  await env.LICENSES.put("alerts:state", JSON.stringify(prev));
  globalThis.__conflicts = { data: { theaters: "cdefghij".split("").map((id) => theater(id, "critical", "steady")) } };
  assert.equal((await runAlerts(env)).sent, 5, "6 a day in total, one already used");
});

test("default export wires fetch and scheduled", async () => {
  assert.equal(typeof worker.fetch, "function");
  assert.equal(typeof worker.scheduled, "function");
});
