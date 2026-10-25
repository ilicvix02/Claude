// Database access. Postgres (Neon or Supabase) when DATABASE_URL is set; otherwise PGlite,
// a real Postgres compiled to WebAssembly, so `npm run dev` works with zero setup.
// All SQL uses $1-style parameters and runs unchanged on both.

import { env } from "./env.ts";

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
  close(): Promise<void>;
}

export const SCHEMA = `
create table if not exists clips (
  id text primary key,
  platform text not null,
  native_id text not null,
  url text not null,
  embed_ref text,
  author_name text not null default '',
  author_handle text not null default '',
  author_url text not null default '',
  thumbnail text not null default '',
  title text not null default '',
  caption text not null default '',
  place text not null default '',
  country text not null default '',
  lat double precision,
  lon double precision,
  posted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  is_live boolean not null default false,
  live_viewers integer,
  vertical boolean not null default false,
  origin text not null default 'auto',
  status text not null default 'pending',
  firsthand boolean,
  ai_checked boolean not null default false,
  reports integer not null default 0,
  cheers integer not null default 0,
  pinned boolean not null default false,
  hashtags jsonb not null default '[]',
  note text not null default '',
  archive_url text not null default '',
  dead boolean not null default false,
  last_checked_at timestamptz
);
create index if not exists clips_feed_idx on clips (status, posted_at desc);

create table if not exists items (
  id text primary key,
  published_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  body text not null default '',
  tag text not null default 'rally',
  place text not null default '',
  country text not null default '',
  lat double precision,
  lon double precision,
  sources jsonb not null default '[]',
  hidden boolean not null default false,
  review_reason text not null default '',
  ai boolean not null default false,
  edited boolean not null default false
);
create index if not exists items_time_idx on items (published_at desc);

create table if not exists articles (
  url text primary key,
  title text not null,
  summary text not null default '',
  source_name text not null,
  published_at timestamptz not null,
  serbia boolean not null default false,
  status text not null default 'pending',
  item_id text,
  created_at timestamptz not null default now()
);
create index if not exists articles_status_idx on articles (status, published_at desc);

create table if not exists checkins (
  id bigserial primary key,
  kind text not null default 'in',
  city_key text not null,
  country text not null default '',
  ref_city text not null default '',
  fp text not null,
  created_at timestamptz not null default now()
);
create index if not exists checkins_time_idx on checkins (kind, created_at desc);
create unique index if not exists checkins_once_idx on checkins (fp, kind);

create table if not exists polls (
  id text primary key,
  question text not null,
  options jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists votes (
  poll_id text not null,
  option integer not null,
  fp text not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, fp)
);

create table if not exists translations (
  hash text not null,
  lang text not null,
  text text not null,
  created_at timestamptz not null default now(),
  primary key (hash, lang)
);

create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists counters (
  key text primary key,
  value double precision not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  stats jsonb not null default '{}'
);
`;

type Global = typeof globalThis & { __pwDb?: Promise<Db> };

async function openPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  // prepare:false keeps it compatible with Supabase's and Neon's transaction poolers.
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 15, onnotice: () => {} });
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await sql.unsafe(text, params as never[]);
      return rows as unknown as T[];
    },
    async exec(text: string) { await sql.unsafe(text); },
    async close() { await sql.end({ timeout: 5 }); },
  };
}

async function openPglite(dir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = dir ? new PGlite(dir) : new PGlite();
  await pg.waitReady;
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const res = await pg.query(text, params);
      return res.rows as T[];
    },
    async exec(text: string) { await pg.exec(text); },
    async close() { await pg.close(); },
  };
}

/** Opens a database without touching the shared singleton (used by tests and scripts). */
export async function openDb(opts: { url?: string; memory?: boolean; dir?: string } = {}): Promise<Db> {
  const db = opts.url ? await openPostgres(opts.url) : await openPglite(opts.memory ? undefined : opts.dir);
  await db.exec(SCHEMA);
  return db;
}

export function getDb(): Promise<Db> {
  const g = globalThis as Global;
  if (!g.__pwDb) {
    const url = env.databaseUrl;
    // On Vercel without DATABASE_URL there is no writable disk: keep PGlite in memory (demo only).
    const dir = process.env.VERCEL ? undefined : process.env.PGLITE_DIR || ".data/pglite";
    g.__pwDb = openDb(url ? { url } : { dir, memory: !dir }).catch((err) => {
      g.__pwDb = undefined;
      throw err;
    });
  }
  return g.__pwDb;
}

/** Postgres returns timestamps as Date objects; the app passes ISO strings around. */
export function iso(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return v as T;
}
