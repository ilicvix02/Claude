import { anonHash, ipKey, validDeviceId } from "@/lib/auth.ts";
import { publicClip, translationsFor } from "@/lib/data.ts";
import { getDb } from "@/lib/db.ts";
import { city } from "@/lib/geo.ts";
import { body, fail, ok } from "@/lib/http.ts";
import { isLocale } from "@/lib/i18n.ts";
import { clipId, extractUrl } from "@/lib/platforms.ts";
import { listClips, rateLimit, upsertClip } from "@/lib/repo.ts";
import { preview, resolveLink } from "@/lib/sources/oembed.ts";
import { clip, hashtags } from "@/lib/text.ts";

export const dynamic = "force-dynamic";

// The clip feed (paged).
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const lang = isLocale(q.get("lang")) ? q.get("lang")! : "en";
  const before = q.get("before");
  const countries = (q.get("countries") ?? "").split(",").filter((c) => /^[A-Z]{2}$/.test(c));
  const clips = await listClips(await getDb(), {
    limit: 20,
    before: before && !Number.isNaN(Date.parse(before)) ? before : undefined,
    countries: countries.length ? countries : undefined,
  });
  const tr = await translationsFor(lang, clips.map((c) => c.caption));
  return ok({ clips: clips.map(publicClip), tr }, 15);
}

// "Drop your clip": a protester submits a link to their own post. It waits for a moderator.
export async function POST(req: Request) {
  const b = await body<{ url: string; city: string; note: string; deviceId: string }>(req);
  const db = await getDb();
  if (!(await rateLimit(db, `submit:${ipKey(req)}`, 12, 3600))) return fail(429, "too many submissions, try again later");
  const raw = extractUrl(String(b.url ?? ""));
  const link = raw ? await resolveLink(raw) : null;
  if (!link) return fail(400, "unsupported link");
  const place = city(String(b.city ?? ""));
  const meta = await preview(link);
  const note = clip(String(b.note ?? "").replace(/\s+/g, " "), 280);
  const title = meta?.title ?? "";
  const isNew = await upsertClip(db, {
    id: clipId(link),
    platform: link.platform,
    nativeId: link.nativeId,
    url: link.url,
    embedRef: link.embedRef,
    authorName: meta?.authorName ?? "",
    authorHandle: link.author ?? meta?.authorName ?? "",
    authorUrl: meta?.authorUrl ?? "",
    thumbnail: meta?.thumbnail ?? "",
    title,
    caption: note || clip(title, 140),
    place: place?.en ?? "",
    country: place?.country ?? "",
    lat: place?.lat ?? null,
    lon: place?.lon ?? null,
    vertical: meta?.vertical ?? link.platform === "tiktok",
    origin: "community",
    status: "pending",
    hashtags: hashtags(`${title} ${note}`),
    note: [note, validDeviceId(b.deviceId) ? `by ${anonHash("submitter", b.deviceId)}` : ""].filter(Boolean).join(" · "),
  });
  return ok({ ok: true, id: clipId(link), isNew, platform: link.platform });
}
