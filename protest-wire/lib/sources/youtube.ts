// YouTube Data API v3: protesters' Shorts, uploads and live streams. News outlets are excluded:
// this feed is for footage from the people in the streets.
//
// Quota: search.list costs 100 units, videos.list 1 unit per 50 videos; the free daily quota is 10,000.
// We run one search every YOUTUBE_SEARCH_EVERY_MIN minutes (rotating live / Shorts / recent) and stop
// at 90% of YOUTUBE_DAILY_QUOTA. The day resets at midnight Pacific time, like Google's counter.

import type { Db } from "../db.ts";
import { env } from "../env.ts";
import { addCounter, getCounter, getState, setState } from "../repo.ts";
import { fetchJson } from "./http.ts";

// Official channels of news outlets: never part of the protester feed (add more with BLOCKED_YOUTUBE_CHANNELS).
export const MEDIA_CHANNELS: Record<string, string> = {
  "UCpglal7d5mhV4lA1b3-DsCw": "N1",
  "UCloa3CgQMtGSeqjLkpQlEFg": "Nova S",
  "UCX32bBbDzEPJhxowcEXu1Rw": "Insajder",
  "UCGd-RXHkOoJwSdKM0GQE-Sw": "Vreme",
  "UCF6U1KDm7BLHWBBUwsZzKtQ": "RTS",
  "UClTOqr6qe-BmwwXDrcmuEhg": "RTS Info",
  "UCaW4dfI-ME9o9tvNsjg8PYA": "Danas",
  "UCNye-wNBqNL5ZzHSJj3l8Bg": "Al Jazeera English",
  "UChqUTb7kYRX8-EiaN3XFrSQ": "Reuters",
};

const MEDIA_NAME = /\b(news|nieuws|noticias|nachrichten|novosti|vesti|vijesti|haber|tv|televizija|televizyon|television|telewizja|channel|kanal|radio|media|medya|press|presse|journal|times|post|herald|daily|telegraph|guardian|tribune|gazette|bbc|cnn|dw|france ?24|euronews|sky|reuters|associated press|afp|al ?jazeera|trt|rt|cgtn|nbc|abc|cbs|fox|msnbc|pbs|npr|n1|rts|b92|pink|informer|kurir|blic|nova s|nedeljnik|dnevnik|insajder|vreme)\b/i;

export function isMediaChannel(channelId: string, channelTitle: string): boolean {
  return channelId in MEDIA_CHANNELS || env.blockedChannels.includes(channelId) || MEDIA_NAME.test(channelTitle);
}

const SEARCH_TERMS = [
  "protest", "protesters", "demonstration", "protesta", "manifestation", "protesti", "протест", "protesto",
  "unjuk rasa", "Demo", "huelga", "grève", "strajk", "#protest",
];

function pacificDay(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

async function spend(db: Db, units: number): Promise<boolean> {
  const key = `yt_units:${pacificDay()}`;
  if ((await getCounter(db, key)) + units > env.youtubeDailyQuota * 0.9) return false;
  await addCounter(db, key, units);
  return true;
}

export async function quotaUsedToday(db: Db): Promise<number> {
  return getCounter(db, `yt_units:${pacificDay()}`);
}

const API = "https://www.googleapis.com/youtube/v3";

interface SearchResponse { items?: Array<{ id: { videoId?: string } }> }
interface VideosResponse {
  items?: Array<{
    id: string;
    snippet: { title: string; description: string; channelId: string; channelTitle: string; publishedAt: string; liveBroadcastContent: string; thumbnails?: Record<string, { url: string }>; tags?: string[] };
    contentDetails?: { duration?: string };
    liveStreamingDetails?: { concurrentViewers?: string; actualStartTime?: string; actualEndTime?: string };
  }>;
}

export interface YtVideo {
  id: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  isLive: boolean;
  viewers: number | null;
  thumbnail: string;
  vertical: boolean;
  media: boolean;
}

function seconds(iso8601?: string): number {
  const m = iso8601?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

export async function videoDetails(db: Db, ids: string[]): Promise<YtVideo[]> {
  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    if (!(await spend(db, 1))) break;
    const url = `${API}/videos?part=snippet,contentDetails,liveStreamingDetails&id=${chunk.join(",")}&key=${env.youtubeKey}`;
    const res = await fetchJson<VideosResponse>(url);
    for (const v of res.items ?? []) {
      const s = v.snippet;
      const dur = seconds(v.contentDetails?.duration);
      const isLive = s.liveBroadcastContent === "live" && !v.liveStreamingDetails?.actualEndTime;
      out.push({
        id: v.id,
        title: s.title,
        description: s.description ?? "",
        channelId: s.channelId,
        channelTitle: s.channelTitle,
        publishedAt: v.liveStreamingDetails?.actualStartTime ?? s.publishedAt,
        isLive,
        viewers: v.liveStreamingDetails?.concurrentViewers ? Number(v.liveStreamingDetails.concurrentViewers) : null,
        thumbnail: s.thumbnails?.high?.url ?? s.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
        // Shorts are vertical; YouTube doesn't expose aspect ratio, so use length + #shorts as the signal.
        vertical: !isLive && dur > 0 && dur <= 180 && /#shorts?\b/i.test(`${s.title} ${s.description}`) || (!isLive && dur > 0 && dur <= 60),
        media: isMediaChannel(s.channelId, s.channelTitle),
      });
    }
  }
  return out;
}

type Job = "live" | "shorts" | "recent";
const ROTATION: Job[] = ["live", "shorts", "live", "recent"];

/** Runs at most one search (if it's time and quota allows). Returns candidate video ids. */
export async function searchCandidates(db: Db): Promise<{ job: Job | null; ids: string[] }> {
  const state = await getState(db, "yt_search", { last: 0, i: 0 });
  if (Date.now() - state.last < env.youtubeSearchEveryMin * 60_000) return { job: null, ids: [] };
  if (!(await spend(db, 100))) return { job: null, ids: [] };
  const job = ROTATION[state.i % ROTATION.length];
  await setState(db, "yt_search", { last: Date.now(), i: state.i + 1 });

  const q = encodeURIComponent([...SEARCH_TERMS, `#${env.hashtag}`].join("|"));
  const after = new Date(Date.now() - 36 * 3600_000).toISOString();
  let url = `${API}/search?part=id&type=video&maxResults=50&q=${q}&key=${env.youtubeKey}`;
  if (job === "live") url += "&eventType=live&order=viewCount";
  if (job === "shorts") url += `&videoDuration=short&order=date&publishedAfter=${after}`;
  if (job === "recent") url += `&order=date&publishedAfter=${after}`;
  const res = await fetchJson<SearchResponse>(url);
  return { job, ids: (res.items ?? []).map((i) => i.id.videoId).filter((x): x is string => Boolean(x)) };
}
