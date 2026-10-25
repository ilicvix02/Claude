// Minimal RSS 2.0 / Atom reader (news outlets, Google News, YouTube channel feeds).

import { XMLParser } from "fast-xml-parser";
import { stripHtml } from "../text.ts";
import { fetchText } from "./http.ts";

export interface FeedEntry {
  id: string;
  title: string;
  link: string;
  summary: string;
  published: string;
  author: string;
  /** YouTube feeds: video id. */
  videoId?: string;
  channelId?: string;
  thumbnail?: string;
  sourceName?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  removeNSPrefix: false,
  processEntities: true,
  htmlEntities: true,
});

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("#text" in o) return text(o["#text"]);
    if ("@href" in o) return text(o["@href"]);
  }
  return "";
}

function arr<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

function date(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function parseFeed(xml: string): FeedEntry[] {
  const doc = parser.parse(xml) as Record<string, any>;
  if (doc.rss?.channel) {
    return arr(doc.rss.channel.item).map((it: Record<string, any>) => {
      const link = text(it.link) || text(it.guid);
      return {
        id: text(it.guid) || link,
        title: stripHtml(text(it.title)),
        link,
        summary: stripHtml(text(it.description) || text(it["content:encoded"])).slice(0, 1200),
        published: date(text(it.pubDate) || text(it["dc:date"])),
        author: text(it["dc:creator"]) || text(it.author),
        sourceName: text(it.source) || undefined,
        thumbnail: text(it["media:thumbnail"]?.["@url"]) || text(it["media:content"]?.["@url"]) || undefined,
      };
    });
  }
  if (doc.feed) {
    return arr(doc.feed.entry).map((e: Record<string, any>) => {
      const links = arr(e.link) as Array<Record<string, string>>;
      const link = links.find((l) => !l["@rel"] || l["@rel"] === "alternate")?.["@href"] ?? text(links[0]);
      const group = e["media:group"] ?? {};
      return {
        id: text(e.id) || link,
        title: stripHtml(text(e.title)),
        link,
        summary: stripHtml(text(e.summary) || text(e.content) || text(group["media:description"])).slice(0, 1200),
        published: date(text(e.published) || text(e.updated)),
        author: text(e.author?.name),
        videoId: text(e["yt:videoId"]) || undefined,
        channelId: text(e["yt:channelId"]) || undefined,
        thumbnail: text(group["media:thumbnail"]?.["@url"]) || undefined,
      };
    });
  }
  return [];
}

export async function readFeed(url: string): Promise<FeedEntry[]> {
  const r = await fetchText(url, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return parseFeed(r.text);
}
