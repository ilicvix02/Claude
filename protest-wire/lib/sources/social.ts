// Free, keyless discovery of protest videos on open networks (Bluesky, Mastodon), plus the optional
// Instagram Graph API hashtag search (needs a Business account token; see README).

import { env } from "../env.ts";
import type { NewClip } from "../repo.ts";
import { hashtags as findTags, stripHtml } from "../text.ts";
import { fetchJson } from "./http.ts";

export function discoveryTags(): string[] {
  return [env.hashtag, "protest", "protests", "protesti", "GenZProtest", "protesta", "manifestation", "demo"];
}

// ---------------------------------------------------------------- Bluesky

interface BskyPost {
  uri: string;
  author: { did: string; handle: string; displayName?: string };
  record: { text?: string; createdAt?: string };
  embed?: { $type: string; thumbnail?: string; aspectRatio?: { width: number; height: number }; media?: { $type: string; thumbnail?: string; aspectRatio?: { width: number; height: number } } };
}

export function bskyToClip(p: BskyPost): NewClip | null {
  const video = p.embed?.$type === "app.bsky.embed.video#view" ? p.embed : p.embed?.media?.$type === "app.bsky.embed.video#view" ? p.embed.media : null;
  if (!video) return null;
  const rkey = p.uri.split("/").pop() ?? "";
  if (!rkey) return null;
  const text = p.record.text ?? "";
  const ar = video.aspectRatio;
  return {
    id: `bluesky:${p.author.did}/${rkey}`,
    platform: "bluesky",
    nativeId: `${p.author.did}/${rkey}`,
    url: `https://bsky.app/profile/${p.author.handle}/post/${rkey}`,
    embedRef: p.uri,
    authorName: p.author.displayName || p.author.handle,
    authorHandle: `@${p.author.handle}`,
    authorUrl: `https://bsky.app/profile/${p.author.handle}`,
    thumbnail: video.thumbnail ?? "",
    title: text,
    postedAt: p.record.createdAt,
    vertical: ar ? ar.height > ar.width : false,
    origin: "auto",
    status: "pending",
    hashtags: findTags(text),
  };
}

export async function blueskyVideos(tag: string): Promise<NewClip[]> {
  const url = `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(`#${tag}`)}&sort=latest&limit=50`;
  const res = await fetchJson<{ posts?: BskyPost[] }>(url);
  return (res.posts ?? []).map(bskyToClip).filter((c): c is NewClip => c !== null);
}

// ---------------------------------------------------------------- Mastodon

interface MastoStatus {
  id: string;
  url: string | null;
  created_at: string;
  content: string;
  account: { acct: string; display_name: string; url: string };
  media_attachments: Array<{ type: string; preview_url?: string; meta?: { original?: { width?: number; height?: number } } }>;
  tags?: Array<{ name: string }>;
}

const MASTODON_URL = /^https:\/\/([^/]+)\/@([^/]+)\/(\d+)$/;

export function mastoToClip(s: MastoStatus): NewClip | null {
  const media = s.media_attachments.find((m) => m.type === "video" || m.type === "gifv");
  // Only real Mastodon statuses have the /embed player; bridged posts from other software don't.
  const m = s.url ? s.url.match(MASTODON_URL) : null;
  if (!media || !m || !s.url) return null;
  const text = stripHtml(s.content);
  const w = media.meta?.original?.width;
  const h = media.meta?.original?.height;
  return {
    id: `mastodon:${m[1]}/${m[3]}`,
    platform: "mastodon",
    nativeId: `${m[1]}/${m[3]}`,
    url: s.url,
    embedRef: `${s.url}/embed`,
    authorName: s.account.display_name || s.account.acct,
    authorHandle: `@${s.account.acct.includes("@") ? s.account.acct : `${s.account.acct}@${m[1]}`}`,
    authorUrl: s.account.url,
    thumbnail: media.preview_url ?? "",
    title: text,
    postedAt: s.created_at,
    vertical: w && h ? h > w : false,
    origin: "auto",
    status: "pending",
    hashtags: (s.tags ?? []).map((t) => t.name).slice(0, 20),
  };
}

export async function mastodonVideos(tag: string, instance = "mastodon.social"): Promise<NewClip[]> {
  const url = `https://${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?only_media=true&limit=40`;
  const res = await fetchJson<MastoStatus[]>(url);
  return res.map(mastoToClip).filter((c): c is NewClip => c !== null);
}

// ---------------------------------------------------------------- Instagram (optional, official Graph API)

interface IgMedia { id: string; caption?: string; media_type: string; permalink: string; timestamp: string }

export async function instagramVideos(tag: string): Promise<NewClip[]> {
  const base = "https://graph.facebook.com/v23.0";
  const auth = `user_id=${env.instagramUserId}&access_token=${env.instagramToken}`;
  const search = await fetchJson<{ data?: Array<{ id: string }> }>(`${base}/ig_hashtag_search?q=${encodeURIComponent(tag)}&${auth}`);
  const hashtagId = search.data?.[0]?.id;
  if (!hashtagId) return [];
  const media = await fetchJson<{ data?: IgMedia[] }>(`${base}/${hashtagId}/recent_media?fields=id,caption,media_type,permalink,timestamp&limit=50&${auth}`);
  const out: NewClip[] = [];
  for (const m of media.data ?? []) {
    if (m.media_type !== "VIDEO") continue;
    const code = m.permalink.match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
    if (!code) continue;
    const kind = code[1] === "p" ? "p" : code[1];
    out.push({
      id: `instagram:${code[2]}`,
      platform: "instagram",
      nativeId: code[2],
      url: `https://www.instagram.com/${kind}/${code[2]}/`,
      embedRef: kind,
      title: m.caption ?? "",
      postedAt: m.timestamp,
      vertical: kind === "reel",
      origin: "auto",
      status: "pending",
      hashtags: findTags(m.caption ?? ""),
    });
  }
  return out;
}
