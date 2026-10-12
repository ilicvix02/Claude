// World Pulse Pro license server: a Cloudflare Worker on the free plan (see docs/PRO.md).
//
//   POST /kofi          Ko-fi webhook: subscription payments create or extend personal licenses
//   POST /claim         {email} → re-sends that subscriber's key (same answer either way)
//   POST /unlock        {key, wrapped_key} → the bundle's content key and the Pro alerts topic
//   GET  /pubkey        public half of the key the build wraps content keys to
//   GET  /health
//   POST /admin/revoke  {key} or {email}, with "Authorization: Bearer <ADMIN_TOKEN>"
//   cron                polls the public conflicts.json and sends Pro breaking alerts via ntfy
//
// KV layout (binding LICENSES). Emails are never stored, only their SHA-256:
//   lic:<key>          {plan, email_hash, created, expires, revoked, renewals}
//   sub:<email hash>   <key>
//   tx:<transaction>   "1" (90 days; makes the webhook idempotent)
//   rl:<scope>:<id>:<window>  request counter (rate limits)
//   cfg:topic          ntfy topic of the Pro alerts (random, generated once)
//   alerts:state       {theater: {status, trend}} as of the last poll
//   alerts:<day>       ids of the alerts already sent that UTC day
//
// Secrets: PRO_PRIVATE_KEY (P-256 JWK), KOFI_VERIFICATION_TOKEN, BREVO_API_KEY, ADMIN_TOKEN.
// Nothing here logs a key, an email, a token or a secret.

const DAY = 86400000;
const LICENSE_DAYS = 35; // a monthly payment plus a few days of grace for late renewals
const MAX_BODY = 16384;
const MAX_ALERTS_PER_DAY = 6;
const KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U
const KEY_GROUPS = 7; // 7 groups of 4 characters = 140 random bits
const WRAP_INFO = "worldpulse-pro-wrap-v1";
const NATIVE_ORIGINS = ["capacitor://localhost", "https://localhost", "http://localhost", "ionic://localhost"];
const LIMITS = {
  unlock_key: [30, 3600], // per license key: 30 an hour
  unlock_ip: [60, 3600],
  claim_ip: [5, 3600],
  claim_email: [3, 86400],
  admin_ip: [20, 3600],
};

// -- small helpers ---------------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64u(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64u(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) throw new HttpError(400, "bad encoding");
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function sha256hex(text) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const emailHash = (email) => sha256hex(`worldpulse:${email.trim().toLowerCase()}`);

function safeEqual(a, b) {
  // constant-time comparison of two strings
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0 && x.length > 0;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const EMAIL_RE = /^[^@\s<>"']{1,64}@[^@\s<>"']{1,190}\.[A-Za-z]{2,24}$/;

// -- license keys ----------------------------------------------------------

export function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_GROUPS * 4));
  const chars = [...bytes].map((b) => KEY_ALPHABET[b & 31]); // 5 uniform bits per byte
  const groups = [];
  for (let i = 0; i < chars.length; i += 4) groups.push(chars.slice(i, i + 4).join(""));
  return `WP-${groups.join("-")}`;
}

/** Canonical form of a typed or pasted key, or null when it can't be one. */
export function normalizeKey(input) {
  if (typeof input !== "string" || input.length > 80) return null;
  let s = input.toUpperCase().replace(/[\s-]/g, "");
  if (s.startsWith("WP")) s = s.slice(2);
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1");
  if (s.length !== KEY_GROUPS * 4 || [...s].some((c) => !KEY_ALPHABET.includes(c))) return null;
  return `WP-${s.match(/.{4}/g).join("-")}`;
}

export function licenseActive(lic, now = Date.now()) {
  return !!lic && !lic.revoked && Date.parse(lic.expires) > now;
}

// -- crypto: content keys wrapped to the Worker's P-256 key ----------------

async function privateKey(env) {
  if (!env.PRO_PRIVATE_KEY) throw new HttpError(503, "not configured");
  const jwk = JSON.parse(env.PRO_PRIVATE_KEY);
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}

export async function publicJwk(env) {
  if (!env.PRO_PRIVATE_KEY) throw new HttpError(503, "not configured");
  const { kty, crv, x, y } = JSON.parse(env.PRO_PRIVATE_KEY);
  const kid = (await sha256hex(`${crv}.${x}.${y}`)).slice(0, 16);
  return { kty, crv, x, y, kid, use: "enc", alg: "ECDH-ES+HKDF-SHA256+A256GCM" };
}

/**
 * Unwrap a content key: wrapped_key = "v1.<bundle id>.<ephemeral public key>.<iv>.<ciphertext>"
 * (base64url parts). KEK = HKDF-SHA256(ECDH(worker key, ephemeral key), salt = ephemeral public
 * key (65-byte uncompressed point), info = "worldpulse-pro-wrap-v1"); the content key is
 * AES-256-GCM(KEK, iv, aad = bundle id). Returns {id, key: Uint8Array(32)}.
 */
export async function unwrapKey(env, wrapped) {
  const parts = typeof wrapped === "string" && wrapped.length < 1024 ? wrapped.split(".") : [];
  if (parts.length !== 5 || parts[0] !== "v1" || !/^[A-Za-z0-9_-]{1,64}$/.test(parts[1])) throw new HttpError(400, "bad wrapped_key");
  const [, id, epkText, ivText, ctText] = parts;
  const epkRaw = unb64u(epkText), iv = unb64u(ivText), ct = unb64u(ctText);
  if (epkRaw.length !== 65 || iv.length !== 12 || ct.length !== 48) throw new HttpError(400, "bad wrapped_key");
  try {
    const epk = await crypto.subtle.importKey("raw", epkRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: epk }, await privateKey(env), 256);
    const hk = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    const kek = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: epkRaw, info: enc.encode(WRAP_INFO) }, hk,
      { name: "AES-GCM", length: 256 }, false, ["decrypt"],
    );
    const key = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: enc.encode(id) }, kek, ct);
    return { id, key: new Uint8Array(key) };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "bad wrapped_key");
  }
}

// -- rate limits (fixed windows in KV) -------------------------------------

async function limited(env, scope, id, now = Date.now()) {
  const [max, seconds] = LIMITS[scope];
  const name = `rl:${scope}:${await sha256hex(String(id))}:${Math.floor(now / 1000 / seconds)}`;
  const count = parseInt((await env.LICENSES.get(name)) || "0", 10);
  if (count >= max) return true;
  await env.LICENSES.put(name, String(count + 1), { expirationTtl: Math.max(60, seconds * 2) });
  return false;
}

// -- email (Brevo transactional API) ---------------------------------------

function appLink(env, key) {
  return `${env.APP_URL || "https://ilicvix02.github.io/Claude/"}#/pro?key=${encodeURIComponent(key)}`;
}

export async function sendKeyEmail(env, email, key, lic, resend = false) {
  if (!env.BREVO_API_KEY || !env.SENDER_EMAIL) return false;
  const link = appLink(env, key);
  const plan = lic.plan === "business" ? "World Pulse Business" : "World Pulse Pro";
  const until = lic.expires.slice(0, 10);
  const lead = resend ? `Here is your ${plan} key again.` : `Thank you for subscribing to ${plan}.`;
  const text = `${lead}\n\nOpen World Pulse and unlock Pro with one tap:\n${link}\n\nYour personal key: ${key}\n\n`
    + `It renews with each Ko-fi payment (now valid until ${until}). Keep it to yourself: it is yours alone.\n\nWorld Pulse`;
  const html = `<div style="font:16px/1.5 system-ui,sans-serif;color:#111;max-width:520px">`
    + `<p>${lead}</p><p><a href="${link}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Unlock Pro</a></p>`
    + `<p>Your personal key:<br><code style="font-size:17px;letter-spacing:.04em">${key}</code></p>`
    + `<p style="color:#555;font-size:14px">It renews with each Ko-fi payment (now valid until ${until}). Keep it to yourself: it is yours alone.</p>`
    + `<p style="color:#555;font-size:14px">World Pulse</p></div>`;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: env.SENDER_NAME || "World Pulse", email: env.SENDER_EMAIL },
      to: [{ email }],
      subject: resend ? `Your ${plan} key` : `Welcome to ${plan}: your key`,
      textContent: text,
      htmlContent: html,
      tags: ["worldpulse-pro"],
    }),
  });
  if (!res.ok) console.log(`email not sent: Brevo answered ${res.status}`);
  return res.ok;
}

// -- Ko-fi webhook ---------------------------------------------------------

export function planFor(tierName) {
  const t = String(tierName || "").toLowerCase();
  if (t.includes("business")) return "business";
  if (t.includes("pro")) return "pro";
  return null;
}

async function kofi(request, env, ctx) {
  const form = await request.formData().catch(() => null);
  const raw = form && form.get("data");
  let data;
  try {
    data = JSON.parse(typeof raw === "string" ? raw : "");
  } catch {
    throw new HttpError(400, "bad payload");
  }
  if (!env.KOFI_VERIFICATION_TOKEN || !safeEqual(data.verification_token, env.KOFI_VERIFICATION_TOKEN)) {
    throw new HttpError(401, "unauthorized");
  }
  const ignored = (why) => json({ ok: true, ignored: why });
  if (data.type !== "Subscription" || !data.is_subscription_payment) return ignored("not a subscription payment");
  const plan = planFor(data.tier_name);
  if (!plan) return ignored("not a Pro tier");
  const email = String(data.email || "").trim();
  const tx = String(data.kofi_transaction_id || data.message_id || "");
  if (!EMAIL_RE.test(email) || !/^[A-Za-z0-9_.:-]{1,100}$/.test(tx)) throw new HttpError(400, "bad payload");
  if (await env.LICENSES.get(`tx:${tx}`)) return ignored("already processed");

  const paid = Date.parse(data.timestamp) || Date.now();
  const hash = await emailHash(email);
  let key = await env.LICENSES.get(`sub:${hash}`);
  let lic = key ? JSON.parse((await env.LICENSES.get(`lic:${key}`)) || "null") : null;
  const fresh = !lic || lic.revoked;
  if (fresh) {
    key = newKey();
    lic = { plan, email_hash: hash, created: new Date(paid).toISOString(), expires: new Date(paid).toISOString(), revoked: false, renewals: 0 };
  } else {
    lic.renewals = (lic.renewals || 0) + 1;
  }
  lic.plan = plan; // a tier change takes effect with its payment
  lic.expires = new Date(Math.max(Date.parse(lic.expires) || 0, paid) + LICENSE_DAYS * DAY).toISOString();
  await env.LICENSES.put(`lic:${key}`, JSON.stringify(lic));
  if (fresh) await env.LICENSES.put(`sub:${hash}`, key);
  await env.LICENSES.put(`tx:${tx}`, "1", { expirationTtl: 90 * 86400 });
  // Email the key with the first payment (or when an earlier license had been revoked).
  if (fresh) ctx.waitUntil(sendKeyEmail(env, email, key, lic).catch(() => console.log("email not sent: request failed")));
  return json({ ok: true, plan, renewed: !fresh });
}

// -- app endpoints -----------------------------------------------------------

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "too large");
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {}
  throw new HttpError(400, "expected a JSON object");
}

const CLAIM_ANSWER = { ok: true, message: "If that email has an active World Pulse Pro subscription, its key is on its way." };

async function claim(request, env, ctx, ip) {
  const body = await readJson(request);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "enter a valid email address");
  if (await limited(env, "claim_ip", ip)) throw new HttpError(429, "too many requests, try again later");
  const hash = await emailHash(email);
  if (await limited(env, "claim_email", hash)) return json(CLAIM_ANSWER); // silent: same answer either way
  const key = await env.LICENSES.get(`sub:${hash}`);
  const lic = key ? JSON.parse((await env.LICENSES.get(`lic:${key}`)) || "null") : null;
  if (licenseActive(lic)) ctx.waitUntil(sendKeyEmail(env, email, key, lic, true).catch(() => console.log("email not sent: request failed")));
  return json(CLAIM_ANSWER);
}

export async function alertsTopic(env) {
  let topic = await env.LICENSES.get("cfg:topic");
  if (!topic) {
    topic = `wp-pro-${b64u(crypto.getRandomValues(new Uint8Array(18))).replace(/[-_]/g, "x")}`;
    await env.LICENSES.put("cfg:topic", topic);
  }
  return topic;
}

async function unlock(request, env, ip) {
  const body = await readJson(request);
  const key = normalizeKey(body.key);
  if (!key) throw new HttpError(400, "that doesn't look like a World Pulse key");
  if ((await limited(env, "unlock_ip", ip)) || (await limited(env, "unlock_key", key))) {
    throw new HttpError(429, "too many requests, try again later");
  }
  const lic = JSON.parse((await env.LICENSES.get(`lic:${key}`)) || "null");
  if (!licenseActive(lic)) {
    const reason = !lic ? "unknown" : lic.revoked ? "revoked" : "expired";
    return json({ ok: false, error: reason === "expired" ? "this key has expired: renew on Ko-fi to continue" : "this key is not valid", reason }, 403);
  }
  const { id, key: contentKey } = await unwrapKey(env, body.wrapped_key);
  return json({
    ok: true,
    plan: lic.plan,
    expires_at: lic.expires,
    bundle_id: id,
    content_key: b64u(contentKey),
    alerts: { server: env.NTFY_SERVER || "https://ntfy.sh", topic: await alertsTopic(env) },
  });
}

async function revoke(request, env, ip) {
  if (await limited(env, "admin_ip", ip)) throw new HttpError(429, "too many requests");
  const auth = request.headers.get("authorization") || "";
  if (!env.ADMIN_TOKEN || !safeEqual(auth.replace(/^Bearer\s+/i, ""), env.ADMIN_TOKEN)) throw new HttpError(401, "unauthorized");
  const body = await readJson(request);
  let key = normalizeKey(body.key);
  if (!key && typeof body.email === "string" && EMAIL_RE.test(body.email.trim())) {
    key = await env.LICENSES.get(`sub:${await emailHash(body.email)}`);
  }
  const lic = key ? JSON.parse((await env.LICENSES.get(`lic:${key}`)) || "null") : null;
  if (!lic) throw new HttpError(404, "no such license");
  lic.revoked = true;
  lic.revoked_at = new Date().toISOString();
  await env.LICENSES.put(`lic:${key}`, JSON.stringify(lic));
  return json({ ok: true, revoked: true });
}

// -- HTTP plumbing -----------------------------------------------------------

function allowedOrigin(env, origin) {
  if (!origin) return null;
  const list = [env.SITE_ORIGIN || "https://ilicvix02.github.io", ...NATIVE_ORIGINS, ...String(env.EXTRA_ORIGINS || "").split(",")];
  return list.map((o) => o.trim()).filter(Boolean).includes(origin) ? origin : null;
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers },
  });
}

function withCors(response, origin) {
  const h = new Headers(response.headers);
  if (origin) {
    h.set("access-control-allow-origin", origin);
    h.set("vary", "Origin");
  }
  return new Response(response.body, { status: response.status, headers: h });
}

export async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const origin = allowedOrigin(env, request.headers.get("origin"));
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const route = `${request.method} ${path}`;
  const cors = ["/claim", "/unlock", "/pubkey", "/health"].includes(path);

  if (request.method === "OPTIONS") {
    if (!cors || !origin) return new Response(null, { status: 403 });
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
        vary: "Origin",
      },
    });
  }
  // Browsers may only call the app endpoints from the site and the native apps.
  if (request.headers.get("origin") && cors && !origin && request.method === "POST") return json({ ok: false, error: "origin not allowed" }, 403);
  const length = parseInt(request.headers.get("content-length") || "0", 10);
  if (length > MAX_BODY) return json({ ok: false, error: "too large" }, 413);

  let res;
  try {
    switch (route) {
      case "GET /health":
        res = json({ ok: true, service: "worldpulse-pro", configured: !!(env.PRO_PRIVATE_KEY && env.KOFI_VERIFICATION_TOKEN && env.LICENSES) });
        break;
      case "GET /pubkey":
        res = json(await publicJwk(env), 200, { "cache-control": "public, max-age=300" });
        break;
      case "POST /kofi":
        res = await kofi(request, env, ctx);
        break;
      case "POST /claim":
        res = await claim(request, env, ctx, ip);
        break;
      case "POST /unlock":
        res = await unlock(request, env, ip);
        break;
      case "POST /admin/revoke":
        res = await revoke(request, env, ip);
        break;
      default:
        res = json({ ok: false, error: "not found" }, 404);
    }
  } catch (err) {
    // Known errors carry their own short message; anything else is a bare 500 with no details.
    if (err instanceof HttpError) res = json({ ok: false, error: err.message }, err.status);
    else {
      console.log(`error on ${route}: ${err && err.name}`);
      res = json({ ok: false, error: "internal error" }, 500);
    }
  }
  return cors ? withCors(res, origin) : res;
}

// -- Pro breaking alerts (Cron Trigger) --------------------------------------

const RANK = { quiet: 0, watch: 1, elevated: 2, high: 3, critical: 4 };

/** Alerts for theaters that newly turned critical, or newly started escalating at high or above. */
export function detectAlerts(previous, theaters) {
  const out = [];
  for (const t of theaters) {
    const before = previous[t.id];
    if (!before) continue; // first sighting: nothing to compare with
    if (t.status === "critical" && before.status !== "critical") {
      out.push({ id: `${t.id}:critical`, theater: t, kind: "critical" });
    } else if (t.trend === "escalating" && before.trend !== "escalating" && (RANK[t.status] || 0) >= RANK.high) {
      out.push({ id: `${t.id}:escalating`, theater: t, kind: "escalating" });
    }
  }
  return out;
}

export async function runAlerts(env, now = Date.now()) {
  const res = await fetch(env.CONFLICTS_URL || "https://ilicvix02.github.io/Claude/api/v1/conflicts.json", { headers: { accept: "application/json" } });
  if (!res.ok) return { sent: 0, error: `conflicts.json answered ${res.status}` };
  const theaters = ((await res.json()).data || {}).theaters || [];
  const previous = JSON.parse((await env.LICENSES.get("alerts:state")) || "{}");
  const state = Object.fromEntries(theaters.map((t) => [t.id, { status: t.status, trend: t.trend }]));
  const candidates = detectAlerts(previous, theaters);
  const day = new Date(now).toISOString().slice(0, 10);
  const sentToday = JSON.parse((await env.LICENSES.get(`alerts:${day}`)) || "[]");
  let sent = 0;
  if (candidates.length) {
    const topic = await alertsTopic(env);
    for (const a of candidates) {
      if (sentToday.length >= MAX_ALERTS_PER_DAY) break;
      if (sentToday.includes(a.id)) continue; // de-duplicated per theater and kind each day
      const t = a.theater;
      const title = a.kind === "critical" ? `${t.name}: now critical` : `${t.name}: escalating`;
      const summary = ((t.analysis || {}).summary || t.description || "").slice(0, 300);
      const r = await fetch(`${env.NTFY_SERVER || "https://ntfy.sh"}/${topic}`, {
        method: "POST",
        headers: {
          Title: title,
          Priority: a.kind === "critical" ? "high" : "default",
          Tags: a.kind === "critical" ? "rotating_light" : "chart_with_upwards_trend",
          Click: `${env.APP_URL || "https://ilicvix02.github.io/Claude/"}#/conflict/${encodeURIComponent(t.id)}`,
        },
        body: `Intensity ${t.intensity}/100, ${t.stories_24h} reports in 24 h. ${summary}`.trim(),
      });
      if (r.ok) {
        sentToday.push(a.id);
        sent++;
      }
    }
    if (sent) await env.LICENSES.put(`alerts:${day}`, JSON.stringify(sentToday), { expirationTtl: 3 * 86400 });
  }
  // Write the snapshot only when it changed (KV free plan: 1,000 writes a day).
  if (JSON.stringify(state) !== JSON.stringify(previous)) await env.LICENSES.put("alerts:state", JSON.stringify(state));
  return { sent, candidates: candidates.length };
}

export default {
  fetch: (request, env, ctx) => handle(request, env, ctx),
  scheduled: (event, env, ctx) => ctx.waitUntil(runAlerts(env).then((r) => console.log(`alerts: ${JSON.stringify(r)}`))),
};
