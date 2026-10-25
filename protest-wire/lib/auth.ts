// Admin sessions (password -> signed cookie) and anonymous fingerprints for counting people once.
// We never store IP addresses or device ids: only salted hashes that can't be reversed.

import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.ts";

export const ADMIN_COOKIE = "pw_admin";
const SESSION_DAYS = 14;

function secret(): string {
  return `${env.adminPassword}|${env.cronSecret}|protest-wire`;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkPassword(password: string): boolean {
  return Boolean(env.adminPassword) && safeEqual(sign(`pw:${password}`), sign(`pw:${env.adminPassword}`));
}

export function makeSession(): { value: string; maxAge: number } {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  return { value: `${exp}.${sign(`session:${exp}`)}`, maxAge: SESSION_DAYS * 86_400 };
}

export function isValidSession(value: string | undefined): boolean {
  if (!value || !env.adminPassword) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(`session:${exp}`));
}

/** Cron calls must carry CRON_SECRET (Vercel sends it as a Bearer token; other schedulers can use ?key=). */
export function isCronAuthorized(req: Request): boolean {
  if (!env.cronSecret) return process.env.NODE_ENV !== "production";
  const header = req.headers.get("authorization") ?? "";
  const key = new URL(req.url).searchParams.get("key") ?? "";
  return safeEqual(header, `Bearer ${env.cronSecret}`) || safeEqual(key, env.cronSecret);
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

/** Salted, one-way hash. `scope` keeps hashes from different features unlinkable. */
export function anonHash(scope: string, value: string): string {
  return createHmac("sha256", secret()).update(`${scope}:${value}`).digest("base64url").slice(0, 22);
}

/** Per-day IP hash, used only for rate limits (rotates daily). */
export function ipKey(req: Request): string {
  return anonHash(`ip:${new Date().toISOString().slice(0, 10)}`, clientIp(req));
}

export function validDeviceId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(id);
}
