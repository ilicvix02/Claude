// All database reads and writes. Every function takes the Db so tests can pass an in-memory one.

import { type Db, iso, json } from "./db.ts";
import { city as cityByKey, country as countryByCode } from "./geo.ts";
import type { Platform } from "./platforms.ts";

// ---------------------------------------------------------------- types

export interface Clip {
  id: string;
  platform: Platform;
  nativeId: string;
  url: string;
  embedRef: string;
  authorName: string;
  authorHandle: string;
  authorUrl: string;
  thumbnail: string;
  title: string;
  caption: string;
  place: string;
  country: string;
  lat: number | null;
  lon: number | null;
  postedAt: string;
  createdAt: string;
  isLive: boolean;
  liveViewers: number | null;
  vertical: boolean;
  origin: "auto" | "community" | "admin";
  status: "pending" | "approved" | "rejected" | "review";
  firsthand: boolean | null;
  aiChecked: boolean;
  reports: number;
  cheers: number;
  pinned: boolean;
  hashtags: string[];
  note: string;
  archiveUrl: string;
  dead: boolean;
}

export type Tag = "incident" | "alert" | "turnout" | "results" | "rally" | "official";
export const TAGS: Tag[] = ["incident", "alert", "turnout", "results", "rally", "official"];

export interface Source { name: string; url: string }

export interface Item {
  id: string;
  publishedAt: string;
  updatedAt: string;
  title: string;
  body: string;
  tag: Tag;
  place: string;
  country: string;
  lat: number | null;
  lon: number | null;
  sources: Source[];
  hidden: boolean;
  reviewReason: string;
  ai: boolean;
  edited: boolean;
}

export interface Settings {
  headline: string;
  lede: string;
  event: string;
  announcement: string;
  announcementUrl: string;
  /** Daily Global Minute, "HH:MM" in UTC. */
  minuteUtc: string;
  pinnedStream: string;
  hashtags: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  headline: "",
  lede: "",
  event: "",
  announcement: "",
  announcementUrl: "",
  minuteUtc: "18:00",
  pinnedStream: "",
  hashtags: [],
};

// ---------------------------------------------------------------- settings & counters

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.query<{ value: unknown }>("select value from settings where key = 'site'");
  return { ...DEFAULT_SETTINGS, ...json<Partial<Settings>>(rows[0]?.value, {}) };
}

export async function saveSettings(db: Db, patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings(db)), ...patch };
  await db.query(
    `insert into settings (key, value, updated_at) values ('site', $1::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [JSON.stringify(next)],
  );
  return next;
}

export async function getState<T>(db: Db, key: string, fallback: T): Promise<T> {
  const rows = await db.query<{ value: unknown }>("select value from settings where key = $1", [key]);
  return json<T>(rows[0]?.value, fallback);
}

export async function setState(db: Db, key: string, value: unknown): Promise<void> {
  await db.query(
    `insert into settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

/** Lease lock so two overlapping cron runs never process the same work. */
export async function acquireLock(db: Db, name: string, seconds: number): Promise<boolean> {
  const until = new Date(Date.now() + seconds * 1000).toISOString();
  const rows = await db.query(
    `insert into settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()
       where (settings.value->>'until')::timestamptz < now()
     returning key`,
    [`lock:${name}`, JSON.stringify({ until })],
  );
  return rows.length > 0;
}

export async function releaseLock(db: Db, name: string): Promise<void> {
  await db.query("delete from settings where key = $1", [`lock:${name}`]);
}

export async function addCounter(db: Db, key: string, delta: number): Promise<number> {
  const rows = await db.query<{ value: number }>(
    `insert into counters (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = counters.value + excluded.value, updated_at = now()
     returning value`,
    [key, delta],
  );
  return Number(rows[0]?.value ?? 0);
}

export async function getCounter(db: Db, key: string): Promise<number> {
  const rows = await db.query<{ value: number }>("select value from counters where key = $1", [key]);
  return Number(rows[0]?.value ?? 0);
}

/** Fixed-window rate limit. Returns false once `max` hits are used in the current window. */
export async function rateLimit(db: Db, key: string, max: number, windowSec: number): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const n = await addCounter(db, `rl:${key}:${bucket}`, 1);
  return n <= max;
}

// ---------------------------------------------------------------- clips

type Row = Record<string, unknown>;

function toClip(r: Row): Clip {
  return {
    id: String(r.id),
    platform: r.platform as Platform,
    nativeId: String(r.native_id),
    url: String(r.url),
    embedRef: String(r.embed_ref ?? ""),
    authorName: String(r.author_name ?? ""),
    authorHandle: String(r.author_handle ?? ""),
    authorUrl: String(r.author_url ?? ""),
    thumbnail: String(r.thumbnail ?? ""),
    title: String(r.title ?? ""),
    caption: String(r.caption ?? ""),
    place: String(r.place ?? ""),
    country: String(r.country ?? ""),
    lat: r.lat === null || r.lat === undefined ? null : Number(r.lat),
    lon: r.lon === null || r.lon === undefined ? null : Number(r.lon),
    postedAt: iso(r.posted_at),
    createdAt: iso(r.created_at),
    isLive: Boolean(r.is_live),
    liveViewers: r.live_viewers === null || r.live_viewers === undefined ? null : Number(r.live_viewers),
    vertical: Boolean(r.vertical),
    origin: r.origin as Clip["origin"],
    status: r.status as Clip["status"],
    firsthand: r.firsthand === null || r.firsthand === undefined ? null : Boolean(r.firsthand),
    aiChecked: Boolean(r.ai_checked),
    reports: Number(r.reports ?? 0),
    cheers: Number(r.cheers ?? 0),
    pinned: Boolean(r.pinned),
    hashtags: json<string[]>(r.hashtags, []),
    note: String(r.note ?? ""),
    archiveUrl: String(r.archive_url ?? ""),
    dead: Boolean(r.dead),
  };
}

export interface NewClip {
  id: string;
  platform: Platform;
  nativeId: string;
  url: string;
  embedRef?: string;
  authorName?: string;
  authorHandle?: string;
  authorUrl?: string;
  thumbnail?: string;
  title?: string;
  caption?: string;
  place?: string;
  country?: string;
  lat?: number | null;
  lon?: number | null;
  postedAt?: string;
  isLive?: boolean;
  liveViewers?: number | null;
  vertical?: boolean;
  origin: Clip["origin"];
  status: Clip["status"];
  hashtags?: string[];
  note?: string;
}

/** Inserts a clip; if it exists, refreshes platform metadata but keeps moderation state. Returns true when new. */
export async function upsertClip(db: Db, c: NewClip): Promise<boolean> {
  const rows = await db.query<{ inserted: boolean }>(
    `insert into clips (id, platform, native_id, url, embed_ref, author_name, author_handle, author_url, thumbnail,
       title, caption, place, country, lat, lon, posted_at, is_live, live_viewers, vertical, origin, status, hashtags, note, last_checked_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,coalesce($16::timestamptz, now()),$17,$18,$19,$20,$21,$22::jsonb,$23, now())
     on conflict (id) do update set
       thumbnail = case when excluded.thumbnail <> '' then excluded.thumbnail else clips.thumbnail end,
       title = case when excluded.title <> '' then excluded.title else clips.title end,
       author_name = case when excluded.author_name <> '' then excluded.author_name else clips.author_name end,
       is_live = excluded.is_live,
       live_viewers = excluded.live_viewers,
       last_checked_at = now()
     returning (xmax = 0) as inserted`,
    [
      c.id, c.platform, c.nativeId, c.url, c.embedRef ?? null, c.authorName ?? "", c.authorHandle ?? "", c.authorUrl ?? "",
      c.thumbnail ?? "", c.title ?? "", c.caption ?? "", c.place ?? "", c.country ?? "", c.lat ?? null, c.lon ?? null,
      c.postedAt || null, c.isLive ?? false, c.liveViewers ?? null, c.vertical ?? false, c.origin, c.status,
      JSON.stringify(c.hashtags ?? []), c.note ?? "",
    ],
  );
  return Boolean(rows[0]?.inserted);
}

export interface ClipQuery {
  limit?: number;
  before?: string;
  countries?: string[];
  includeLive?: boolean;
}

export async function listClips(db: Db, q: ClipQuery = {}): Promise<Clip[]> {
  const params: unknown[] = [];
  const where = ["status = 'approved'", "not dead"];
  if (!q.includeLive) where.push("not is_live");
  if (q.before) { params.push(q.before); where.push(`posted_at < $${params.length}::timestamptz`); }
  if (q.countries?.length) { params.push(JSON.stringify(q.countries)); where.push(`country in (select jsonb_array_elements_text($${params.length}::jsonb))`); }
  params.push(Math.min(q.limit ?? 40, 100));
  const rows = await db.query(
    `select * from clips where ${where.join(" and ")} order by pinned desc, posted_at desc limit $${params.length}`,
    params,
  );
  return rows.map(toClip);
}

export async function liveStreams(db: Db): Promise<Clip[]> {
  const rows = await db.query(
    `select * from clips where is_live and status = 'approved' and not dead
     order by pinned desc, coalesce(live_viewers, 0) desc limit 12`,
  );
  return rows.map(toClip);
}

export async function getClip(db: Db, id: string): Promise<Clip | null> {
  const rows = await db.query("select * from clips where id = $1", [id]);
  return rows[0] ? toClip(rows[0]) : null;
}

export async function clipsByStatus(db: Db, status: Clip["status"], limit = 100): Promise<Clip[]> {
  const rows = await db.query("select * from clips where status = $1 order by created_at desc limit $2", [status, limit]);
  return rows.map(toClip);
}

export async function clipsNeedingAi(db: Db, limit: number): Promise<Clip[]> {
  const rows = await db.query(
    `select * from clips where not ai_checked and status in ('pending', 'approved') and created_at > now() - interval '3 days'
     order by created_at desc limit $1`,
    [limit],
  );
  return rows.map(toClip);
}

export async function applyClipAi(
  db: Db,
  id: string,
  a: { caption: string; place: string; country: string; lat: number | null; lon: number | null; firsthand: boolean; status?: Clip["status"] },
): Promise<void> {
  await db.query(
    `update clips set caption = $2, place = case when place = '' then $3 else place end,
       country = case when country = '' then $4 else country end,
       lat = coalesce(lat, $5), lon = coalesce(lon, $6), firsthand = $7, ai_checked = true,
       status = coalesce($8, status)
     where id = $1`,
    [id, a.caption, a.place, a.country, a.lat, a.lon, a.firsthand, a.status ?? null],
  );
}

export async function updateClip(db: Db, id: string, patch: Partial<Pick<Clip, "caption" | "place" | "country" | "status" | "pinned" | "lat" | "lon">>): Promise<void> {
  const cols: Record<string, string> = { caption: "caption", place: "place", country: "country", status: "status", pinned: "pinned", lat: "lat", lon: "lon" };
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [k, col] of Object.entries(cols)) {
    if (k in patch) { params.push((patch as Record<string, unknown>)[k]); sets.push(`${col} = $${params.length}`); }
  }
  if (sets.length) await db.query(`update clips set ${sets.join(", ")} where id = $1`, params);
}

export async function setLive(db: Db, liveIds: string[], viewers: Record<string, number | null>, checkedIds: string[]): Promise<void> {
  // Anything we checked and is not live any more stops being a live stream.
  if (checkedIds.length) {
    await db.query(
      `update clips set is_live = false, live_viewers = null
       where is_live and id in (select jsonb_array_elements_text($1::jsonb)) and not (id in (select jsonb_array_elements_text($2::jsonb)))`,
      [JSON.stringify(checkedIds), JSON.stringify(liveIds)],
    );
  }
  for (const id of liveIds) {
    await db.query("update clips set is_live = true, live_viewers = $2, last_checked_at = now() where id = $1", [id, viewers[id] ?? null]);
  }
}

export async function cheerClip(db: Db, id: string): Promise<number> {
  const rows = await db.query<{ cheers: number }>("update clips set cheers = cheers + 1 where id = $1 returning cheers", [id]);
  return Number(rows[0]?.cheers ?? 0);
}

/** Three reports pull a clip from the feed until a moderator decides. */
export async function reportClip(db: Db, id: string): Promise<void> {
  await db.query(
    `update clips set reports = reports + 1,
       status = case when reports + 1 >= 3 and status = 'approved' and origin <> 'admin' then 'review' else status end
     where id = $1`,
    [id],
  );
}

export async function clipsToArchive(db: Db, limit: number): Promise<Clip[]> {
  const rows = await db.query(
    `select * from clips where status = 'approved' and archive_url = '' and not is_live and platform <> 'youtube'
     order by created_at desc limit $1`,
    [limit],
  );
  return rows.map(toClip);
}

export async function setArchive(db: Db, id: string, url: string): Promise<void> {
  await db.query("update clips set archive_url = $2 where id = $1", [id, url]);
}

export async function clipsToRecheck(db: Db, limit: number): Promise<Clip[]> {
  const rows = await db.query(
    `select * from clips where status = 'approved' and not dead and not is_live
       and (last_checked_at is null or last_checked_at < now() - interval '12 hours')
     order by last_checked_at nulls first limit $1`,
    [limit],
  );
  return rows.map(toClip);
}

export async function markChecked(db: Db, id: string, dead: boolean): Promise<void> {
  await db.query("update clips set dead = $2, last_checked_at = now() where id = $1", [id, dead]);
}

export async function knownClipIds(db: Db, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.query<{ id: string }>(
    "select id from clips where id in (select jsonb_array_elements_text($1::jsonb))",
    [JSON.stringify(ids)],
  );
  return new Set(rows.map((r) => r.id));
}

// ---------------------------------------------------------------- check-ins ("I'm in", Global Minute)

export interface CheckinResult { n: number; isNew: boolean }

export async function addCheckin(
  db: Db,
  c: { kind: "in" | "minute"; cityKey: string; refCity?: string; fp: string },
): Promise<CheckinResult> {
  const cityInfo = cityByKey(c.cityKey);
  const ref = c.refCity && c.refCity !== c.cityKey && cityByKey(c.refCity) ? c.refCity : "";
  const inserted = await db.query<{ id: number }>(
    `insert into checkins (kind, city_key, country, ref_city, fp) values ($1, $2, $3, $4, $5)
     on conflict (fp, kind) do nothing returning id`,
    [c.kind, c.cityKey, cityInfo?.country ?? "", ref, c.fp],
  );
  const id = inserted[0]?.id;
  const rows = id !== undefined
    ? await db.query<{ n: number }>("select count(*)::int as n from checkins where kind = $1 and id <= $2", [c.kind, id])
    : await db.query<{ n: number }>(
      "select count(*)::int as n from checkins where kind = $1 and id <= (select id from checkins where fp = $2 and kind = $1)",
      [c.kind, c.fp],
    );
  return { n: Number(rows[0]?.n ?? 0), isNew: id !== undefined };
}

export interface Stats { people: number; cities: number; countries: number; clipsToday: number; live: number; minuteNow: number }

export async function stats(db: Db, minuteSince?: string): Promise<Stats> {
  const [a] = await db.query<{ people: number; cities: number; countries: number }>(
    `select count(*)::int as people, count(distinct city_key)::int as cities, count(distinct nullif(country, ''))::int as countries
     from checkins where kind = 'in'`,
  );
  const [b] = await db.query<{ clips: number; live: number; countries: number }>(
    `select count(*) filter (where posted_at > now() - interval '24 hours' and not is_live)::int as clips,
            count(*) filter (where is_live)::int as live,
            count(distinct nullif(country, '')) filter (where posted_at > now() - interval '7 days')::int as countries
     from clips where status = 'approved' and not dead`,
  );
  const [m] = minuteSince
    ? await db.query<{ n: number }>("select count(*)::int as n from checkins where kind = 'minute' and created_at >= $1::timestamptz", [minuteSince])
    : [{ n: 0 }];
  return {
    people: Number(a?.people ?? 0),
    cities: Number(a?.cities ?? 0),
    countries: Math.max(Number(a?.countries ?? 0), Number(b?.countries ?? 0)),
    clipsToday: Number(b?.clips ?? 0),
    live: Number(b?.live ?? 0),
    minuteNow: Number(m?.n ?? 0),
  };
}

export interface RaceRow { cityKey: string; score: number; own: number; brought: number }

/** City race: people who checked in from a city plus the people that city's invites brought in. */
export async function cityRace(db: Db, hours: number, limit = 10): Promise<RaceRow[]> {
  const rows = await db.query<{ city: string; own: number; brought: number }>(
    `with recent as (select city_key, ref_city from checkins where kind = 'in' and created_at > now() - ($1 || ' hours')::interval),
     own as (select city_key as city, count(*)::int as n from recent group by city_key),
     brought as (select ref_city as city, count(*)::int as n from recent where ref_city <> '' group by ref_city)
     select coalesce(own.city, brought.city) as city, coalesce(own.n, 0) as own, coalesce(brought.n, 0) as brought
     from own full outer join brought on own.city = brought.city
     order by coalesce(own.n, 0) + coalesce(brought.n, 0) desc limit $2`,
    [String(hours), limit],
  );
  return rows.map((r) => ({ cityKey: r.city, own: Number(r.own), brought: Number(r.brought), score: Number(r.own) + Number(r.brought) }));
}

export interface MapPoint { key: string; name: string; country: string; lat: number; lon: number; people: number; clips: number }
export interface MapLine { from: string; to: string; n: number }

export async function mapData(db: Db): Promise<{ points: MapPoint[]; lines: MapLine[] }> {
  const people = await db.query<{ city_key: string; n: number }>(
    "select city_key, count(*)::int as n from checkins where kind = 'in' group by city_key",
  );
  const clipRows = await db.query<{ place: string; country: string; lat: number; lon: number; n: number }>(
    `select place, country, round(lat::numeric, 1)::float as lat, round(lon::numeric, 1)::float as lon, count(*)::int as n
     from clips where status = 'approved' and not dead and lat is not null and posted_at > now() - interval '7 days'
     group by place, country, round(lat::numeric, 1), round(lon::numeric, 1)`,
  );
  const points = new Map<string, MapPoint>();
  for (const r of people) {
    const c = cityByKey(r.city_key);
    if (!c) continue;
    points.set(c.key, { key: c.key, name: c.en, country: c.country, lat: c.lat, lon: c.lon, people: Number(r.n), clips: 0 });
  }
  for (const r of clipRows) {
    // Merge clip clusters into a known city when they are close.
    const near = [...points.values()].find((p) => Math.abs(p.lat - r.lat) < 0.35 && Math.abs(p.lon - r.lon) < 0.45);
    if (near) { near.clips += Number(r.n); continue; }
    const key = `clip:${r.lat},${r.lon}`;
    const cur = points.get(key);
    if (cur) cur.clips += Number(r.n);
    else points.set(key, { key, name: r.place || countryByCode(r.country)?.en || "", country: r.country, lat: r.lat, lon: r.lon, people: 0, clips: Number(r.n) });
  }
  const lines = await db.query<{ from_city: string; to_city: string; n: number }>(
    `select ref_city as from_city, city_key as to_city, count(*)::int as n from checkins
     where kind = 'in' and ref_city <> '' group by ref_city, city_key order by n desc limit 300`,
  );
  return { points: [...points.values()], lines: lines.map((l) => ({ from: l.from_city, to: l.to_city, n: Number(l.n) })) };
}

// ---------------------------------------------------------------- People's Pulse

export interface Poll { id: string; question: string; options: string[]; counts: number[]; total: number }

export async function activePoll(db: Db): Promise<Poll | null> {
  const rows = await db.query<{ id: string; question: string; options: unknown }>(
    "select id, question, options from polls where active order by created_at desc limit 1",
  );
  const p = rows[0];
  if (!p) return null;
  const options = json<string[]>(p.options, []);
  const counts = options.map(() => 0);
  const votes = await db.query<{ option: number; n: number }>(
    "select option, count(*)::int as n from votes where poll_id = $1 group by option",
    [p.id],
  );
  for (const v of votes) if (v.option >= 0 && v.option < counts.length) counts[v.option] = Number(v.n);
  return { id: p.id, question: p.question, options, counts, total: counts.reduce((a, b) => a + b, 0) };
}

export async function vote(db: Db, pollId: string, option: number, fp: string): Promise<boolean> {
  const rows = await db.query(
    `insert into votes (poll_id, option, fp)
     select $1, $2, $3 where exists (select 1 from polls where id = $1 and active and $2 >= 0 and $2 < jsonb_array_length(options))
     on conflict do nothing returning poll_id`,
    [pollId, option, fp],
  );
  return rows.length > 0;
}

export async function createPoll(db: Db, id: string, question: string, options: string[]): Promise<void> {
  await db.query("update polls set active = false where active");
  await db.query("insert into polls (id, question, options) values ($1, $2, $3::jsonb)", [id, question, JSON.stringify(options)]);
}

export async function closePolls(db: Db): Promise<void> {
  await db.query("update polls set active = false where active");
}

// ---------------------------------------------------------------- wire items & articles

function toItem(r: Row): Item {
  return {
    id: String(r.id),
    publishedAt: iso(r.published_at),
    updatedAt: iso(r.updated_at),
    title: String(r.title),
    body: String(r.body ?? ""),
    tag: r.tag as Tag,
    place: String(r.place ?? ""),
    country: String(r.country ?? ""),
    lat: r.lat === null || r.lat === undefined ? null : Number(r.lat),
    lon: r.lon === null || r.lon === undefined ? null : Number(r.lon),
    sources: json<Source[]>(r.sources, []),
    hidden: Boolean(r.hidden),
    reviewReason: String(r.review_reason ?? ""),
    ai: Boolean(r.ai),
    edited: Boolean(r.edited),
  };
}

export async function listItems(db: Db, q: { limit?: number; before?: string; since?: string; includeHidden?: boolean } = {}): Promise<Item[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (!q.includeHidden) where.push("not hidden");
  if (q.before) { params.push(q.before); where.push(`published_at < $${params.length}::timestamptz`); }
  if (q.since) { params.push(q.since); where.push(`updated_at > $${params.length}::timestamptz`); }
  params.push(Math.min(q.limit ?? 60, 300));
  const rows = await db.query(
    `select * from items ${where.length ? `where ${where.join(" and ")}` : ""} order by published_at desc limit $${params.length}`,
    params,
  );
  return rows.map(toItem);
}

export async function insertItem(db: Db, it: Omit<Item, "updatedAt" | "edited">): Promise<void> {
  await db.query(
    `insert into items (id, published_at, title, body, tag, place, country, lat, lon, sources, hidden, review_reason, ai)
     values ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13) on conflict (id) do nothing`,
    [it.id, it.publishedAt, it.title, it.body, it.tag, it.place, it.country, it.lat, it.lon, JSON.stringify(it.sources), it.hidden, it.reviewReason, it.ai],
  );
}

export async function addSources(db: Db, itemId: string, sources: Source[]): Promise<void> {
  const rows = await db.query<{ sources: unknown }>("select sources from items where id = $1", [itemId]);
  if (!rows[0]) return;
  const cur = json<Source[]>(rows[0].sources, []);
  const seen = new Set(cur.map((s) => s.url));
  const merged = [...cur, ...sources.filter((s) => !seen.has(s.url))].slice(0, 8);
  if (merged.length === cur.length) return;
  await db.query("update items set sources = $2::jsonb, updated_at = now() where id = $1", [itemId, JSON.stringify(merged)]);
}

export async function updateItem(db: Db, id: string, patch: Partial<Pick<Item, "title" | "body" | "tag" | "place" | "country" | "hidden">>): Promise<void> {
  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [id];
  for (const k of ["title", "body", "tag", "place", "country", "hidden"] as const) {
    if (k in patch) { params.push(patch[k]); sets.push(`${k} = $${params.length}`); }
  }
  if ("title" in patch || "body" in patch) sets.push("edited = true", "review_reason = ''");
  await db.query(`update items set ${sets.join(", ")} where id = $1`, params);
}

export interface Article { url: string; title: string; summary: string; sourceName: string; publishedAt: string; serbia: boolean }

/** Stores new articles; returns only the ones not seen before. */
export async function insertArticles(db: Db, list: Article[]): Promise<number> {
  let n = 0;
  for (const a of list) {
    const rows = await db.query(
      `insert into articles (url, title, summary, source_name, published_at, serbia) values ($1, $2, $3, $4, $5::timestamptz, $6)
       on conflict (url) do nothing returning url`,
      [a.url, a.title, a.summary, a.sourceName, a.publishedAt, a.serbia],
    );
    n += rows.length;
  }
  return n;
}

export async function pendingArticles(db: Db, limit: number): Promise<Article[]> {
  // Older than 12 hours is no longer "live"; skip it.
  await db.query("update articles set status = 'stale' where status = 'pending' and published_at < now() - interval '12 hours'");
  const rows = await db.query<Row>(
    "select * from articles where status = 'pending' order by serbia desc, published_at desc limit $1",
    [limit],
  );
  return rows.map((r) => ({
    url: String(r.url), title: String(r.title), summary: String(r.summary), sourceName: String(r.source_name),
    publishedAt: iso(r.published_at), serbia: Boolean(r.serbia),
  }));
}

export async function setArticleStatus(db: Db, url: string, status: string, itemId?: string): Promise<void> {
  await db.query("update articles set status = $2, item_id = $3 where url = $1", [url, status, itemId ?? null]);
}

// ---------------------------------------------------------------- translations cache

export async function getTranslations(db: Db, hashes: string[], lang: string): Promise<Map<string, string>> {
  if (!hashes.length) return new Map();
  const rows = await db.query<{ hash: string; text: string }>(
    "select hash, text from translations where lang = $1 and hash in (select jsonb_array_elements_text($2::jsonb))",
    [lang, JSON.stringify(hashes)],
  );
  return new Map(rows.map((r) => [r.hash, r.text]));
}

export async function saveTranslations(db: Db, lang: string, entries: Array<[string, string]>): Promise<void> {
  for (const [hash, text] of entries) {
    await db.query(
      "insert into translations (hash, lang, text) values ($1, $2, $3) on conflict (hash, lang) do update set text = excluded.text",
      [hash, lang, text],
    );
  }
}

// ---------------------------------------------------------------- runs

export async function startRun(db: Db): Promise<number> {
  const rows = await db.query<{ id: number }>("insert into runs default values returning id");
  return Number(rows[0].id);
}

export async function finishRun(db: Db, id: number, ok: boolean, stats: unknown): Promise<void> {
  await db.query("update runs set finished_at = now(), ok = $2, stats = $3::jsonb where id = $1", [id, ok, JSON.stringify(stats)]);
  await db.query("delete from runs where started_at < now() - interval '7 days'");
}

export async function lastRun(db: Db): Promise<{ finishedAt: string; ok: boolean; stats: Record<string, unknown> } | null> {
  const rows = await db.query<Row>("select * from runs where finished_at is not null order by id desc limit 1");
  const r = rows[0];
  return r ? { finishedAt: iso(r.finished_at), ok: Boolean(r.ok), stats: json<Record<string, unknown>>(r.stats, {}) } : null;
}

export async function recentRuns(db: Db, limit = 10): Promise<Array<{ startedAt: string; finishedAt: string; ok: boolean | null; stats: Record<string, unknown> }>> {
  const rows = await db.query<Row>("select * from runs order by id desc limit $1", [limit]);
  return rows.map((r) => ({ startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), ok: r.ok === null ? null : Boolean(r.ok), stats: json(r.stats, {}) }));
}
