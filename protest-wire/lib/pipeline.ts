// The cron job. Each run (every 3–5 minutes):
//  1. finds protest videos posted by people (YouTube Shorts/live/uploads, Bluesky, Mastodon, Instagram*),
//  2. has Claude caption them and filter out news outlets and off-topic posts,
//  3. builds The Wire from news RSS + GDELT (Claude rewrites, de-duplicates, checks numbers),
//  4. pre-translates new text into Serbian, archives approved posts, and checks for takedowns.

import { aiAvailable, classifyClips, writeStories, type ClipVerdict } from "./ai.ts";
import type { Db } from "./db.ts";
import { env, features } from "./env.ts";
import { findCity, country as countryInfo } from "./geo.ts";
import { parseLink } from "./platforms.ts";
import * as repo from "./repo.ts";
import { fetchGdelt, fetchNewsFeed, NEWS_FEEDS } from "./sources/news.ts";
import { pool } from "./sources/http.ts";
import { archive, isGone } from "./sources/oembed.ts";
import { blueskyVideos, discoveryTags, instagramVideos, mastodonVideos } from "./sources/social.ts";
import { searchCandidates, videoDetails } from "./sources/youtube.ts";
import { clip, isProtestText, sha, similarity, unverifiedNumbers } from "./text.ts";
import { fill, lookup } from "./translate.ts";

export interface RunStats {
  [key: string]: unknown;
  clipsFound: number;
  clipsNew: number;
  clipsApproved: number;
  clipsRejected: number;
  live: number;
  articlesNew: number;
  itemsNew: number;
  itemsMerged: number;
  translated: number;
  archived: number;
  removed: number;
  errors: string[];
  ms: number;
}

function errText(where: string, err: unknown): string {
  return `${where}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
}

function locate(text: string): { place: string; country: string; lat: number | null; lon: number | null } {
  const c = findCity(text);
  return c ? { place: c.en, country: c.country, lat: c.lat, lon: c.lon } : { place: "", country: "", lat: null, lon: null };
}

export async function runPipeline(db: Db, opts: { deadlineMs?: number; skipNetwork?: boolean } = {}): Promise<RunStats | null> {
  const started = Date.now();
  const deadline = started + (opts.deadlineMs ?? 50_000);
  const timeLeft = () => deadline - Date.now();
  if (!(await repo.acquireLock(db, "pipeline", 240))) return null;
  const runId = await repo.startRun(db);
  const s: RunStats = {
    clipsFound: 0, clipsNew: 0, clipsApproved: 0, clipsRejected: 0, live: 0, articlesNew: 0, itemsNew: 0,
    itemsMerged: 0, translated: 0, archived: 0, removed: 0, errors: [], ms: 0,
  };
  const ai = await aiAvailable(db);
  const fresh: string[] = [];

  try {
    // ---------------------------------------------------------------- 1. discover clips
    const turn = (await repo.addCounter(db, "pipeline_turn", 1)) | 0;
    const tags = discoveryTags();
    const pick = (n: number) => Array.from({ length: n }, (_, i) => tags[(turn * n + i) % tags.length]);

    const jobs: Array<{ name: string; run: () => Promise<repo.NewClip[]> }> = [];
    for (const t of pick(3)) jobs.push({ name: `bluesky #${t}`, run: () => blueskyVideos(t) });
    for (const t of pick(2)) jobs.push({ name: `mastodon #${t}`, run: () => mastodonVideos(t) });
    if (features.instagram && turn % 6 === 0) {
      // Instagram allows 30 different hashtags per 7 days: alternate between our tag and #protest.
      const t = turn % 12 === 0 ? env.hashtag : "protest";
      jobs.push({ name: `instagram #${t}`, run: () => instagramVideos(t) });
    }
    if (features.youtube) {
      jobs.push({
        name: "youtube",
        run: async () => {
          const live = await repo.liveStreams(db);
          const { ids } = await searchCandidates(db);
          const known = await repo.knownClipIds(db, ids.map((id) => `youtube:${id}`));
          const toFetch = [...new Set([...live.filter((c) => c.platform === "youtube").map((c) => c.nativeId), ...ids.filter((id) => !known.has(`youtube:${id}`))])];
          const vids = await videoDetails(db, toFetch);
          const liveIds = vids.filter((v) => v.isLive && !v.media).map((v) => `youtube:${v.id}`);
          const viewers = Object.fromEntries(vids.map((v) => [`youtube:${v.id}`, v.viewers]));
          await repo.setLive(db, liveIds, viewers, live.map((c) => c.id));
          s.live = liveIds.length;
          return vids.filter((v) => !v.media).map((v) => ({
            id: `youtube:${v.id}`, platform: "youtube" as const, nativeId: v.id,
            url: v.vertical ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`,
            authorName: v.channelTitle, authorHandle: v.channelTitle, authorUrl: `https://www.youtube.com/channel/${v.channelId}`,
            thumbnail: v.thumbnail, title: `${v.title}\n${v.description.slice(0, 400)}`, postedAt: v.publishedAt,
            isLive: v.isLive, liveViewers: v.viewers, vertical: v.vertical, origin: "auto" as const, status: "pending" as const,
            hashtags: (`${v.title} ${v.description}`.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((h) => h.slice(1)).slice(0, 20),
          }));
        },
      });
    }

    if (!opts.skipNetwork) {
      const results = await pool(jobs, 4, (j) => j.run());
      for (const r of results) {
        if (r.error) { s.errors.push(errText(r.item.name, r.error)); continue; }
        for (const c of r.value ?? []) {
          s.clipsFound++;
          const text = `${c.title} ${(c.hashtags ?? []).join(" ")}`;
          // Without AI we can only trust posts that clearly say "protest" (or carry our tag).
          if (!ai && !isProtestText(text) && !(c.hashtags ?? []).some((h) => h.toLowerCase() === env.hashtag.toLowerCase())) continue;
          if (!ai && /news|media|\btv|info|press|portal|podcast/i.test(`${c.authorHandle} ${c.authorName}`)) continue;
          const loc = locate(c.title ?? "");
          const isNew = await repo.upsertClip(db, { ...c, ...loc, caption: ai ? "" : clip(c.title ?? "", 140), status: ai ? "pending" : "approved" });
          if (isNew) { s.clipsNew++; if (!ai) s.clipsApproved++; }
        }
      }
    }

    // ---------------------------------------------------------------- 2. caption + filter clips with Claude
    if (ai) {
      const todo = await repo.clipsNeedingAi(db, env.aiMaxClipsPerRun);
      for (let i = 0; i < todo.length && timeLeft() > 15_000; i += 15) {
        const batch = todo.slice(i, i + 15);
        let verdicts: ClipVerdict[];
        try {
          verdicts = await classifyClips(db, batch.map((c, j) => ({
            index: j, platform: c.platform, author: c.authorHandle || c.authorName, text: [c.title, c.note].filter(Boolean).join("\n"),
            hashtags: c.hashtags, postedAt: c.postedAt,
          })));
        } catch (err) {
          s.errors.push(errText("ai clips", err));
          break;
        }
        for (const v of verdicts) {
          const c = batch[v.index];
          if (!c) continue;
          const ok = v.relevant && v.firsthand;
          let status: repo.Clip["status"] | undefined;
          if (c.origin === "auto") status = ok ? "approved" : "rejected";
          else if (c.origin === "community" && c.status === "pending" && env.autoApproveSubmissions === "ai" && ok) status = "approved";
          const fallback = locate(`${c.title} ${c.note}`);
          const known = countryInfo(v.country);
          await repo.applyClipAi(db, c.id, {
            caption: v.caption,
            place: v.place || fallback.place,
            country: v.country || fallback.country,
            lat: v.lat || v.lon ? v.lat : fallback.lat ?? known?.lat ?? null,
            lon: v.lat || v.lon ? v.lon : fallback.lon ?? known?.lon ?? null,
            firsthand: v.firsthand,
            status,
          });
          if (status === "approved") { s.clipsApproved++; fresh.push(v.caption); }
          if (status === "rejected") s.clipsRejected++;
        }
      }
    }

    // ---------------------------------------------------------------- 3. The Wire
    if (!opts.skipNetwork) {
      const feeds = await pool(NEWS_FEEDS, 4, (f) => fetchNewsFeed(f));
      const articles: repo.Article[] = [];
      for (const r of feeds) {
        if (r.error) s.errors.push(errText(`rss ${r.item.name}`, r.error));
        else articles.push(...(r.value ?? []));
      }
      try { articles.push(...(await fetchGdelt())); } catch (err) { s.errors.push(errText("gdelt", err)); }
      s.articlesNew = await repo.insertArticles(db, articles);
    }

    const pending = await repo.pendingArticles(db, ai ? env.aiMaxArticlesPerRun : 25);
    const recent = await repo.listItems(db, { limit: 80, includeHidden: true });
    const recent6h = recent.filter((it) => Date.now() - new Date(it.publishedAt).getTime() < 6 * 3600_000);

    // Cheap de-duplication first: near-identical headlines just add a source.
    const toWrite: repo.Article[] = [];
    for (const a of pending) {
      const twin = recent6h.find((it) => similarity(it.title, a.title) >= 0.55);
      if (twin) {
        await repo.addSources(db, twin.id, [{ name: a.sourceName, url: a.url }]);
        await repo.setArticleStatus(db, a.url, "merged", twin.id);
        s.itemsMerged++;
      } else {
        toWrite.push(a);
      }
    }

    if (ai) {
      for (let i = 0; i < toWrite.length && timeLeft() > 15_000; i += 10) {
        const batch = toWrite.slice(i, i + 10);
        let verdicts;
        try {
          verdicts = await writeStories(
            db,
            batch.map((a, j) => ({ index: j, source: a.sourceName, title: a.title, summary: a.summary, publishedAt: a.publishedAt })),
            recent6h.slice(0, 50).map((it) => ({ id: it.id, title: it.title, place: it.place })),
          );
        } catch (err) {
          s.errors.push(errText("ai wire", err));
          break;
        }
        const created = new Map<number, string>();
        // Handle "new" first so in-batch duplicates ("article:3") can point at them.
        const ordered = [...verdicts].sort((a, b) => (a.action === "new" ? -1 : 0) - (b.action === "new" ? -1 : 0));
        for (const v of ordered) {
          const a = batch[v.index];
          if (!a) continue;
          if (v.action === "skip") { await repo.setArticleStatus(db, a.url, "skipped"); continue; }
          if (v.action === "duplicate") {
            const target = v.duplicateOf.startsWith("article:") ? created.get(Number(v.duplicateOf.slice(8))) : recent.find((r) => r.id === v.duplicateOf)?.id;
            if (target) {
              await repo.addSources(db, target, [{ name: a.sourceName, url: a.url }]);
              await repo.setArticleStatus(db, a.url, "merged", target);
              s.itemsMerged++;
              continue;
            }
          }
          const id = sha(a.url, 12);
          const bad = unverifiedNumbers(`${v.title} ${v.body}`, `${a.title} ${a.summary}`);
          const known = countryInfo(v.country);
          await repo.insertItem(db, {
            id, publishedAt: a.publishedAt, title: v.title || a.title, body: v.body, tag: v.tag, place: v.place, country: v.country,
            lat: v.lat || v.lon ? v.lat : known?.lat ?? null, lon: v.lat || v.lon ? v.lon : known?.lon ?? null,
            sources: [{ name: a.sourceName, url: a.url }],
            // Numbers the source doesn't contain: hold the item for a moderator instead of publishing.
            hidden: bad.length > 0, reviewReason: bad.length ? `Numbers not found in source: ${bad.join(", ")}` : "", ai: true,
          });
          await repo.setArticleStatus(db, a.url, "done", id);
          created.set(v.index, id);
          s.itemsNew++;
          if (!bad.length) fresh.push(v.title, v.body);
        }
      }
    } else {
      // No AI key: publish the outlet's own headline with a short excerpt, clearly sourced.
      for (const a of toWrite.slice(0, 25)) {
        const id = sha(a.url, 12);
        const loc = locate(`${a.title} ${a.summary}`);
        await repo.insertItem(db, {
          id, publishedAt: a.publishedAt, title: a.title, body: clip(a.summary, 220), tag: "rally",
          place: loc.place, country: loc.country || (a.serbia ? "RS" : ""), lat: loc.lat, lon: loc.lon,
          sources: [{ name: a.sourceName, url: a.url }], hidden: false, reviewReason: "", ai: false,
        });
        await repo.setArticleStatus(db, a.url, "done", id);
        s.itemsNew++;
      }
    }

    // ---------------------------------------------------------------- 4. pre-translate, archive, takedown checks
    if (ai && fresh.length && timeLeft() > 10_000) {
      try {
        const { missing } = await lookup(db, "sr", fresh);
        s.translated = await fill(db, "sr", missing, 60);
      } catch (err) {
        s.errors.push(errText("translate", err));
      }
    }

    if (!opts.skipNetwork && timeLeft() > 8_000) {
      for (const c of await repo.clipsToArchive(db, 3)) {
        if (timeLeft() < 8_000) break;
        const url = await archive(c.url);
        if (url) { await repo.setArchive(db, c.id, url); s.archived++; }
      }
      const recheck = await repo.clipsToRecheck(db, 10);
      await pool(recheck, 4, async (c) => {
        const link = parseLink(c.url);
        const gone = link ? await isGone(link) : false;
        await repo.markChecked(db, c.id, gone);
        if (gone) s.removed++;
      });
    }

    s.ms = Date.now() - started;
    await repo.finishRun(db, runId, s.errors.length === 0, s);
    return s;
  } catch (err) {
    s.errors.push(errText("pipeline", err));
    s.ms = Date.now() - started;
    await repo.finishRun(db, runId, false, s);
    return s;
  } finally {
    await repo.releaseLock(db, "pipeline");
  }
}
