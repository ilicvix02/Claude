import { isAdmin } from "@/lib/admin.ts";
import { getDb } from "@/lib/db.ts";
import { city } from "@/lib/geo.ts";
import { body, fail, ok } from "@/lib/http.ts";
import { runPipeline } from "@/lib/pipeline.ts";
import { clipId, extractUrl, safeUrl } from "@/lib/platforms.ts";
import * as repo from "@/lib/repo.ts";
import { preview, resolveLink } from "@/lib/sources/oembed.ts";
import { sha } from "@/lib/text.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type A = Record<string, unknown> & { action: string };

export async function POST(req: Request) {
  if (!(await isAdmin())) return fail(401, "login required");
  const a = (await body<A>(req)) as A;
  const db = await getDb();
  const id = String(a.id ?? "");

  switch (a.action) {
    case "clip.status": {
      const status = String(a.status);
      if (!["approved", "rejected", "pending", "review"].includes(status)) return fail(400, "bad status");
      await repo.updateClip(db, id, { status: status as repo.Clip["status"] });
      return ok({ ok: true });
    }
    case "clip.update": {
      const place = city(String(a.city ?? ""));
      await repo.updateClip(db, id, {
        caption: String(a.caption ?? ""),
        ...(place ? { place: place.en, country: place.country, lat: place.lat, lon: place.lon } : {}),
      });
      return ok({ ok: true });
    }
    case "clip.pin":
      await repo.updateClip(db, id, { pinned: Boolean(a.pinned) });
      return ok({ ok: true });
    case "clip.add":
    case "stream.pin": {
      const raw = extractUrl(String(a.url ?? ""));
      const link = raw ? await resolveLink(raw) : null;
      if (!link) return fail(400, "unsupported link");
      if (a.action === "stream.pin" && link.platform !== "youtube") return fail(400, "live streams must be YouTube links");
      const meta = await preview(link);
      const place = city(String(a.city ?? ""));
      const cid = clipId(link);
      await repo.upsertClip(db, {
        id: cid, platform: link.platform, nativeId: link.nativeId, url: link.url, embedRef: link.embedRef,
        authorName: meta?.authorName ?? "", authorHandle: link.author ?? meta?.authorName ?? "", authorUrl: meta?.authorUrl ?? "",
        thumbnail: meta?.thumbnail ?? "", title: meta?.title ?? "", caption: String(a.caption ?? "") || meta?.title?.slice(0, 140) || "",
        place: place?.en ?? "", country: place?.country ?? "", lat: place?.lat ?? null, lon: place?.lon ?? null,
        vertical: meta?.vertical ?? false, origin: "admin", status: "approved", isLive: a.action === "stream.pin",
      });
      await repo.updateClip(db, cid, { status: "approved", pinned: a.action === "stream.pin" ? true : Boolean(a.pinned) });
      if (a.action === "stream.pin") await db.query("update clips set is_live = true where id = $1", [cid]);
      return ok({ ok: true, id: cid });
    }
    case "stream.unpin":
      await db.query("update clips set pinned = false, is_live = false where id = $1", [id]);
      return ok({ ok: true });
    case "item.update": {
      const tag = String(a.tag ?? "");
      await repo.updateItem(db, id, {
        ...(typeof a.title === "string" ? { title: a.title } : {}),
        ...(typeof a.body === "string" ? { body: a.body } : {}),
        ...(repo.TAGS.includes(tag as repo.Tag) ? { tag: tag as repo.Tag } : {}),
        ...(typeof a.place === "string" ? { place: a.place } : {}),
        ...(typeof a.country === "string" ? { country: a.country.toUpperCase().slice(0, 2) } : {}),
        ...(typeof a.hidden === "boolean" ? { hidden: a.hidden } : {}),
      });
      return ok({ ok: true });
    }
    case "settings.save": {
      const s = (a.settings ?? {}) as Partial<repo.Settings>;
      const allowed: Array<keyof repo.Settings> = ["headline", "lede", "event", "announcement", "announcementUrl", "minuteUtc", "hashtags"];
      const patch: Partial<repo.Settings> = {};
      for (const k of allowed) if (k in s) (patch as Record<string, unknown>)[k] = s[k];
      if (patch.minuteUtc && !/^\d{2}:\d{2}$/.test(patch.minuteUtc)) return fail(400, "Global Minute time must be HH:MM (UTC)");
      if (patch.announcementUrl && !safeUrl(patch.announcementUrl)) return fail(400, "The announcement link must start with https://");
      return ok({ ok: true, settings: await repo.saveSettings(db, patch) });
    }
    case "poll.create": {
      const question = String(a.question ?? "").trim();
      const options = (Array.isArray(a.options) ? a.options : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 4);
      if (!question || options.length < 2) return fail(400, "a question and at least two options");
      await repo.createPoll(db, sha(`${question}${Date.now()}`, 10), question, options);
      return ok({ ok: true });
    }
    case "poll.close":
      await repo.closePolls(db);
      return ok({ ok: true });
    case "run": {
      const stats = await runPipeline(db, { deadlineMs: 100_000 });
      return ok({ ok: true, stats });
    }
    default:
      return fail(400, "unknown action");
  }
}
