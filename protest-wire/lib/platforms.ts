// Recognises post links from the platforms we can embed with their official players.

export type Platform = "tiktok" | "instagram" | "x" | "youtube" | "bluesky" | "mastodon";

export interface ParsedLink {
  platform: Platform;
  nativeId: string;
  /** Canonical public URL ("Watch on <platform>"). */
  url: string;
  /** Extra data the embed needs (Bluesky AT-URI, Mastodon embed URL, Instagram kind). */
  embedRef?: string;
  author?: string;
}

export const PLATFORM_NAMES: Record<Platform, string> = {
  tiktok: "TikTok", instagram: "Instagram", x: "X", youtube: "YouTube", bluesky: "Bluesky", mastodon: "Mastodon",
};

/** Pulls the first http(s) URL out of shared text ("Check this out https://vm.tiktok.com/abc/ #protest"). */
export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[),.!?]+$/, "") : null;
}

function toUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** Short links (vm.tiktok.com, youtu.be is handled locally) need one redirect hop to find the real post. */
export function needsResolve(raw: string): boolean {
  const u = toUrl(raw);
  if (!u) return false;
  return /^(vm|vt)\.tiktok\.com$/i.test(u.hostname) || /^(www\.)?tiktok\.com$/i.test(u.hostname) && u.pathname.startsWith("/t/");
}

export function parseLink(raw: string): ParsedLink | null {
  const u = toUrl(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "tiktok.com") {
    // /@user/video/1234567890  or  /@user/photo/... (photos can't be embedded as video)
    const i = parts.indexOf("video");
    if (i > 0 && /^\d{8,25}$/.test(parts[i + 1] ?? "")) {
      const author = parts[0].startsWith("@") ? parts[0] : undefined;
      return { platform: "tiktok", nativeId: parts[i + 1], url: `https://www.tiktok.com/${author ?? "@"}/video/${parts[i + 1]}`, author };
    }
    return null;
  }

  if (host === "instagram.com") {
    // /reel/CODE/, /p/CODE/, /tv/CODE/ (optionally prefixed by /username/)
    const i = parts.findIndex((p) => p === "reel" || p === "reels" || p === "p" || p === "tv");
    const code = i >= 0 ? parts[i + 1] : undefined;
    if (code && /^[A-Za-z0-9_-]{5,40}$/.test(code)) {
      const kind = parts[i] === "p" ? "p" : parts[i] === "tv" ? "tv" : "reel";
      return { platform: "instagram", nativeId: code, url: `https://www.instagram.com/${kind}/${code}/`, embedRef: kind };
    }
    return null;
  }

  if (host === "x.com" || host === "twitter.com") {
    // /user/status/123
    const i = parts.indexOf("status");
    if (i > 0 && /^\d{5,25}$/.test(parts[i + 1] ?? "")) {
      return { platform: "x", nativeId: parts[i + 1], url: `https://x.com/${parts[0]}/status/${parts[i + 1]}`, author: `@${parts[0]}` };
    }
    return null;
  }

  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    let id: string | undefined;
    if (host === "youtu.be") id = parts[0];
    else if (parts[0] === "watch") id = u.searchParams.get("v") ?? undefined;
    else if (["shorts", "live", "embed"].includes(parts[0])) id = parts[1];
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
      return { platform: "youtube", nativeId: id, url: parts[0] === "shorts" ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}` };
    }
    return null;
  }

  if (host === "bsky.app") {
    // /profile/<handle-or-did>/post/<rkey>
    if (parts[0] === "profile" && parts[2] === "post" && parts[1] && /^[a-z0-9]{8,20}$/i.test(parts[3] ?? "")) {
      const actor = parts[1];
      return {
        platform: "bluesky",
        nativeId: `${actor}/${parts[3]}`,
        url: `https://bsky.app/profile/${actor}/post/${parts[3]}`,
        embedRef: actor.startsWith("did:") ? `at://${actor}/app.bsky.feed.post/${parts[3]}` : undefined,
        author: actor.startsWith("did:") ? undefined : `@${actor}`,
      };
    }
    return null;
  }

  // Mastodon (any instance): https://instance/@user/123456789
  // The server later calls this host's oEmbed endpoint, so only public hostnames are accepted.
  if (parts.length === 2 && isPublicHostname(u.hostname) && parts[0].startsWith("@") && /^\d{6,25}$/.test(parts[1])) {
    const url = `https://${u.hostname}/${parts[0]}/${parts[1]}`;
    return { platform: "mastodon", nativeId: `${u.hostname}/${parts[1]}`, url, embedRef: `${url}/embed`, author: `${parts[0]}@${u.hostname}` };
  }

  return null;
}

/** A real public DNS name: no IP literals, no localhost or internal-only suffixes. */
export function isPublicHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (!h.includes(".") || h.startsWith("[") || /^\d+(\.\d+){3}$/.test(h)) return false;
  return !/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(h);
}

/** Only http(s) URLs may reach href/src attributes (blocks javascript: and data: from third-party metadata). */
export function safeUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

export function clipId(p: Pick<ParsedLink, "platform" | "nativeId">): string {
  return `${p.platform}:${p.nativeId}`;
}

/** Where people can see a hashtag on each platform. */
export function hashtagLinks(tag: string): Array<{ platform: Platform; url: string }> {
  const t = encodeURIComponent(tag.replace(/^#/, ""));
  return [
    { platform: "tiktok", url: `https://www.tiktok.com/tag/${t}` },
    { platform: "instagram", url: `https://www.instagram.com/explore/tags/${t}/` },
    { platform: "x", url: `https://x.com/hashtag/${t}` },
    { platform: "youtube", url: `https://www.youtube.com/hashtag/${t.toLowerCase()}` },
    { platform: "bluesky", url: `https://bsky.app/hashtag/${t}` },
  ];
}
