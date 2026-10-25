import { NextResponse } from "next/server";
import { ADMIN_COOKIE, checkPassword, ipKey, makeSession } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { env } from "@/lib/env.ts";
import { body, fail } from "@/lib/http.ts";
import { rateLimit } from "@/lib/repo.ts";

export async function POST(req: Request) {
  if (!env.adminPassword) return fail(503, "Set ADMIN_PASSWORD first (see README).");
  const db = await getDb();
  if (!(await rateLimit(db, `login:${ipKey(req)}`, 10, 900))) return fail(429, "Too many attempts. Wait 15 minutes.");
  const b = await body<{ password: string }>(req);
  if (!checkPassword(String(b.password ?? ""))) {
    await new Promise((r) => setTimeout(r, 600));
    return fail(401, "Wrong password");
  }
  const s = makeSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, s.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: s.maxAge });
  return res;
}
