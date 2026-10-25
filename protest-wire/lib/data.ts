// What the pages and the polling API send to the browser.

import { after } from "next/server";
import { getDb } from "./db.ts";
import { features } from "./env.ts";
import { contentLang } from "./i18n.ts";
import * as repo from "./repo.ts";
import { type MinuteInfo, minuteInfo } from "./minute.ts";
import { safeUrl } from "./platforms.ts";
import { fill, lookup } from "./translate.ts";

export { minuteInfo };

export interface PublicClip extends Omit<repo.Clip, "reports" | "note" | "aiChecked" | "status" | "origin" | "title"> {
  community: boolean;
  /** Original post text (shown smaller, untranslated: it's the protester's own words). */
  text: string;
}

export function publicClip(c: repo.Clip): PublicClip {
  const { reports: _r, note: _n, aiChecked: _a, status: _s, origin, title, ...rest } = c;
  return {
    ...rest,
    authorUrl: safeUrl(rest.authorUrl),
    thumbnail: safeUrl(rest.thumbnail),
    archiveUrl: safeUrl(rest.archiveUrl),
    community: origin === "community",
    text: title.split("\n")[0].slice(0, 280),
  };
}

export interface HomeData {
  settings: repo.Settings;
  stats: repo.Stats;
  live: PublicClip[];
  clips: PublicClip[];
  items: repo.Item[];
  race: repo.RaceRow[];
  poll: repo.Poll | null;
  minute: MinuteInfo;
  updatedAt: string;
  tr: Record<string, string>;
  setup: { db: boolean; ai: boolean; youtube: boolean };
}

/** Collect every content string the page shows so they can be translated in one lookup. */
function contentTexts(d: Omit<HomeData, "tr">): string[] {
  const s = d.settings;
  return [
    s.headline, s.lede, s.event, s.announcement,
    ...d.clips.flatMap((c) => [c.caption, c.place]), ...d.live.flatMap((c) => [c.caption, c.place]),
    ...d.items.flatMap((i) => [i.title, i.body, i.place]),
    ...(d.poll ? [d.poll.question, ...d.poll.options] : []),
  ].filter(Boolean);
}

/** Look up cached translations; queue the missing ones to be translated after the response is sent. */
export async function translationsFor(lang: string, texts: string[]): Promise<Record<string, string>> {
  if (contentLang(lang) === "en" || !texts.length) return {};
  const db = await getDb();
  const { map, missing } = await lookup(db, lang, texts);
  if (missing.length && features.ai) {
    after(async () => {
      try { await fill(db, lang, missing, 40); } catch (err) { console.error("translate", err); }
    });
  }
  return Object.fromEntries(map);
}

export async function homeData(lang: string): Promise<HomeData> {
  const db = await getDb();
  const settings = await repo.getSettings(db);
  const minute = minuteInfo(settings.minuteUtc);
  const [stats, live, clips, items, race, poll, run] = await Promise.all([
    repo.stats(db, minute.active ? minute.startsAt : undefined),
    repo.liveStreams(db),
    repo.listClips(db, { limit: 30 }),
    repo.listItems(db, { limit: 80 }),
    repo.cityRace(db, 24 * 7, 10),
    repo.activePoll(db),
    repo.lastRun(db),
  ]);
  const base = {
    settings, stats, minute, race, poll, items,
    live: live.map(publicClip),
    clips: clips.map(publicClip),
    updatedAt: run?.finishedAt ?? "",
    setup: { db: features.db === "postgres", ai: features.ai, youtube: features.youtube },
  };
  return { ...base, tr: await translationsFor(lang, contentTexts(base)) };
}
