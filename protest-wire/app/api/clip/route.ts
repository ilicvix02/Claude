import { publicClip, translationsFor } from "@/lib/data.ts";
import { getDb } from "@/lib/db.ts";
import { fail, ok } from "@/lib/http.ts";
import { isLocale } from "@/lib/i18n.ts";
import { getClip } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const clip = await getClip(await getDb(), q.get("id") ?? "");
  if (!clip || clip.status !== "approved") return fail(404, "not found");
  const lang = isLocale(q.get("lang")) ? q.get("lang")! : "en";
  return ok({ clip: publicClip(clip), tr: await translationsFor(lang, [clip.caption]) }, 30);
}
