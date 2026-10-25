import { anonHash, ipKey, validDeviceId } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { body, fail, ok } from "@/lib/http.ts";
import { cheerClip, rateLimit } from "@/lib/repo.ts";

// "Stand with": one per device per clip.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body<{ deviceId: string }>(req);
  if (!validDeviceId(b.deviceId)) return fail(400, "missing device id");
  const db = await getDb();
  if (!(await rateLimit(db, `cheer-ip:${ipKey(req)}`, 300, 3600))) return fail(429, "slow down");
  if (!(await rateLimit(db, `cheer:${anonHash("cheer", `${b.deviceId}:${id}`)}`, 1, 365 * 86400))) return ok({ ok: false });
  return ok({ ok: true, cheers: await cheerClip(db, decodeURIComponent(id)) });
}
