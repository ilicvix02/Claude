import { anonHash, ipKey } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { ok } from "@/lib/http.ts";
import { rateLimit, reportClip } from "@/lib/repo.ts";

// Three reports from different people pull a clip until a moderator reviews it.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = await getDb();
  if (await rateLimit(db, `report:${anonHash("report", `${ipKey(req)}:${id}`)}`, 1, 86400)) await reportClip(db, decodeURIComponent(id));
  return ok({ ok: true });
}
