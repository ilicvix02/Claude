// News sources for The Wire: outlet RSS feeds and GDELT. Only protest-related articles are kept.

import type { Article } from "../repo.ts";
import { isProtestText, isSerbianProtestText } from "../text.ts";
import { fetchJson } from "./http.ts";
import { readFeed } from "./rss.ts";

export interface NewsFeed { name: string; url: string; serbia: boolean; fallback?: string }

const gnews = (q: string, lang = "en-US", gl = "US", ceid = "US:en") =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${lang}&gl=${gl}&ceid=${ceid}`;

export const NEWS_FEEDS: NewsFeed[] = [
  { name: "Danas", url: "https://www.danas.rs/feed/", serbia: true },
  // n1info.rs sometimes refuses automated requests; Google News carries the same headlines.
  { name: "N1", url: "https://n1info.rs/feed/", serbia: true, fallback: gnews("site:n1info.rs when:1d", "sr", "RS", "RS:sr") },
  { name: "Nova", url: "https://nova.rs/feed/", serbia: true },
  { name: "Nedeljnik", url: "https://www.nedeljnik.rs/feed/", serbia: true },
  { name: "Insajder", url: "https://insajder.net/feed", serbia: true },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", serbia: false },
  // Reuters has no public RSS; Google News search restricted to reuters.com stands in.
  { name: "Reuters", url: gnews("site:reuters.com protest when:1d"), serbia: false },
  { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", serbia: false },
];

function sourceFromTitle(feed: NewsFeed, title: string): { title: string; source: string } {
  // Google News titles end with " - Outlet".
  const m = feed.url.includes("news.google.com") ? title.match(/^(.*) - ([^-]+)$/) : null;
  return m ? { title: m[1].trim(), source: m[2].trim() } : { title, source: feed.name };
}

export async function fetchNewsFeed(feed: NewsFeed): Promise<Article[]> {
  let entries;
  try {
    entries = await readFeed(feed.url);
  } catch (err) {
    if (!feed.fallback) throw err;
    entries = await readFeed(feed.fallback);
  }
  const out: Article[] = [];
  for (const e of entries) {
    if (!e.link || !e.title) continue;
    const text = `${e.title}\n${e.summary}`;
    const keep = feed.serbia ? isSerbianProtestText(text) : isProtestText(text);
    if (!keep) continue;
    const { title, source } = sourceFromTitle(feed, e.title);
    out.push({ url: e.link, title, summary: e.summary, sourceName: source, publishedAt: e.published, serbia: feed.serbia || /\b(serbia|srbij|belgrade|beograd|novi sad)/i.test(text) });
  }
  return out;
}

interface GdeltResponse { articles?: Array<{ url: string; title: string; seendate: string; domain: string; language: string; sourcecountry: string }> }

/** GDELT 2.0 DOC API: protest coverage worldwide over the last hour (all languages). */
export async function fetchGdelt(): Promise<Article[]> {
  const query = '(protest OR protesters OR demonstrators OR "riot police" OR "tear gas" OR "general strike")';
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=60&timespan=1h&sort=datedesc`;
  const res = await fetchJson<GdeltResponse>(url, { timeoutMs: 15_000 });
  return (res.articles ?? [])
    .filter((a) => a.url && a.title && isProtestText(a.title))
    .map((a) => {
      // seendate looks like 20261025T203000Z
      const d = a.seendate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z");
      return { url: a.url, title: a.title, summary: "", sourceName: a.domain, publishedAt: new Date(d).toISOString(), serbia: a.sourcecountry === "Serbia" };
    });
}
