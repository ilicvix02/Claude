import { translationsFor } from "@/lib/data.ts";
import { getDb } from "@/lib/db.ts";
import { ok } from "@/lib/http.ts";
import { isLocale } from "@/lib/i18n.ts";
import { listItems } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

// Older wire items ("Load more").
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const lang = isLocale(q.get("lang")) ? q.get("lang")! : "en";
  const before = q.get("before") ?? undefined;
  const items = await listItems(await getDb(), { limit: 40, before: before && !Number.isNaN(Date.parse(before)) ? before : undefined });
  const tr = await translationsFor(lang, items.flatMap((i) => [i.title, i.body, i.place]));
  return ok({ items, tr }, 30);
}
