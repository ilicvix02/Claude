// Official oEmbed endpoints: preview data for submitted links, and "is this post still up?" checks.
// Also archives approved posts to the Internet Archive so the evidence survives takedowns.

import { type ParsedLink, needsResolve, parseLink, safeUrl } from "../platforms.ts";
import { fetchJson, fetchText } from "./http.ts";

export interface Preview {
  title: string;
  authorName: string;
  authorUrl: string;
  thumbnail: string;
  vertical: boolean;
}

/** Follows a short link (vm.tiktok.com/...) to the real post URL. */
export async function resolveLink(raw: string): Promise<ParsedLink | null> {
  const direct = parseLink(raw);
  if (direct?.platform === "bluesky" && !direct.embedRef) return withBlueskyDid(direct);
  if (direct) return direct;
  if (!needsResolve(raw)) return null;
  try {
    const r = await fetchText(raw, { timeoutMs: 8000, method: "HEAD" });
    return parseLink(r.finalUrl);
  } catch {
    return null;
  }
}

/** Bluesky's embed needs the account DID, not the handle. */
async function withBlueskyDid(link: ParsedLink): Promise<ParsedLink> {
  const [handle, rkey] = link.nativeId.split("/");
  try {
    const r = await fetchJson<{ did?: string }>(`https://api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`, { timeoutMs: 6000 });
    if (r.did) return { ...link, nativeId: `${r.did}/${rkey}`, embedRef: `at://${r.did}/app.bsky.feed.post/${rkey}` };
  } catch {
    // keep the handle form; the card still links to the post
  }
  return link;
}

function endpoint(link: ParsedLink): string | null {
  const u = encodeURIComponent(link.url);
  switch (link.platform) {
    case "tiktok": return `https://www.tiktok.com/oembed?url=${u}`;
    case "youtube": return `https://www.youtube.com/oembed?format=json&url=${u}`;
    case "x": return `https://publish.twitter.com/oembed?omit_script=1&url=${u}`;
    case "bluesky": return `https://embed.bsky.app/oembed?format=json&url=${u}`;
    case "mastodon": return `https://${new URL(link.url).hostname}/api/oembed?url=${u}`;
    case "instagram": {
      // Instagram's oEmbed needs a Meta app token ("APP_ID|APP_SECRET"); without it we skip the preview.
      const token = process.env.META_OEMBED_TOKEN;
      return token ? `https://graph.facebook.com/v23.0/instagram_oembed?url=${u}&access_token=${encodeURIComponent(token)}` : null;
    }
  }
}

interface OEmbed { title?: string; author_name?: string; author_url?: string; thumbnail_url?: string; width?: number | string; height?: number | string; html?: string }

export async function preview(link: ParsedLink): Promise<Preview | null> {
  const url = endpoint(link);
  if (!url) return null;
  try {
    const o = await fetchJson<OEmbed>(url, { timeoutMs: 8000 });
    const w = Number(o.width);
    const h = Number(o.height);
    // X returns the tweet text inside html only.
    const xText = link.platform === "x" && o.html ? o.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400) : "";
    return {
      title: o.title || xText,
      authorName: o.author_name ?? "",
      authorUrl: safeUrl(o.author_url),
      thumbnail: safeUrl(o.thumbnail_url),
      vertical: link.platform === "tiktok" || (w > 0 && h > w) || (link.platform === "youtube" && link.url.includes("/shorts/")),
    };
  } catch {
    return null;
  }
}

/** True when the platform says the post no longer exists. Unknown (network errors, no endpoint) counts as alive. */
export async function isGone(link: ParsedLink): Promise<boolean> {
  const url = endpoint(link);
  if (!url) return false;
  try {
    const r = await fetchText(url, { timeoutMs: 8000 });
    return r.status === 404 || r.status === 410 || (link.platform === "youtube" && r.status === 401);
  } catch {
    return false;
  }
}

/** Ask the Wayback Machine to save the post. Returns the archive link to show if the post disappears. */
export async function archive(url: string): Promise<string | null> {
  try {
    const r = await fetchText(`https://web.archive.org/save/${url}`, { timeoutMs: 25_000 });
    if (r.status >= 200 && r.status < 400) return `https://web.archive.org/web/2/${url}`;
  } catch {
    // The archive is often slow; the next run tries again.
  }
  return null;
}

