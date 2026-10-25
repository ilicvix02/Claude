"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicClip } from "@/lib/data.ts";
import { deviceId, postJson, shareLink } from "@/lib/client.ts";
import { city as cityByKey, flag } from "@/lib/geo.ts";
import { numberFmt } from "@/lib/i18n.ts";
import { PLATFORM_NAMES } from "@/lib/platforms.ts";
import { useApp } from "./AppContext.tsx";
import { Section, SectionHead } from "./Chrome.tsx";

export const EUROPE = new Set("AL AD AM AT AZ BY BE BA BG HR CY CZ DK EE FI FR GE DE GR HU IS IE IT XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH TR UA GB VA".split(" "));

function ago(iso: string, t: ReturnType<typeof useApp>["t"]): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 2) return t("time.just_now");
  if (min < 60) return t("time.min_ago", { n: min });
  if (min < 48 * 60) return t("time.h_ago", { n: Math.round(min / 60) });
  return new Date(iso).toLocaleDateString();
}

/** Clips filmed at the same place within 45 minutes are "angles" of one moment. */
export function angleCounts(clips: PublicClip[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of clips) {
    if (!c.place) continue;
    const n = clips.filter((o) => o.place === c.place && Math.abs(new Date(o.postedAt).getTime() - new Date(c.postedAt).getTime()) < 45 * 60_000).length;
    if (n > 1) out.set(c.id, n);
  }
  return out;
}

export function ClipRail() {
  const { t, tc, data, open, mounted, country } = useApp();
  const clips = data.clips;
  return (
    <Section id="clips">
      <SectionHead kicker="▶ TIKTOK · INSTAGRAM · X · YOUTUBE · BLUESKY" title={t("clips.title")} lede={t("clips.lede")} />
      {clips.length === 0 ? (
        <div className="empty">
          <p>{t("clips.empty")}</p>
          <button className="btn" onClick={() => open({ name: "drop" })}>{t("drop.title")}</button>
        </div>
      ) : (
        <div className="rail" role="list">
          {clips.slice(0, 16).map((c) => (
            <button key={c.id} role="listitem" className="rail-card" onClick={() => open({ name: "feed", start: c.id })}>
              <span className="rail-thumb" style={c.thumbnail ? { backgroundImage: `url("${c.thumbnail}")` } : undefined}>
                <span className={`plat plat-${c.platform}`}>{PLATFORM_NAMES[c.platform]}</span>
                <span className="rail-play" aria-hidden="true">▶</span>
              </span>
              <span className="rail-cap">{tc(c.caption) || c.text}</span>
              <span className="rail-meta">
                {c.country && `${flag(c.country)} `}{c.place ? tc(c.place) : country(c.country)}
                {mounted && <>{(c.place || c.country) && " · "}{ago(c.postedAt, t)}</>}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <button className="cta small" onClick={() => open({ name: "feed" })}>▶ {t("clips.open")}</button>
        <button className="btn" onClick={() => open({ name: "drop" })}>＋ {t("drop.title")}</button>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- embeds

declare global {
  interface Window { twttr?: { widgets: { createTweet(id: string, el: HTMLElement, opts?: Record<string, unknown>): Promise<unknown> } } }
}

let xScript: Promise<void> | null = null;
function loadX(): Promise<void> {
  if (window.twttr?.widgets) return Promise.resolve();
  xScript ??= new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://platform.twitter.com/widgets.js";
    s.async = true;
    s.onload = () => {
      const wait = () => (window.twttr?.widgets ? resolve() : setTimeout(wait, 100));
      wait();
    };
    document.head.appendChild(s);
  });
  return xScript;
}

function XEmbed({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    void loadX().then(() => {
      if (alive && ref.current) {
        ref.current.innerHTML = "";
        void window.twttr!.widgets.createTweet(id, ref.current, { theme: "dark", dnt: true, align: "center" });
      }
    });
    return () => { alive = false; };
  }, [id]);
  return <div ref={ref} className="embed-x" />;
}

/** Official players only. Nothing is downloaded or re-hosted. */
export function Embed({ clip, active }: { clip: PublicClip; active: boolean }) {
  const common = { className: "embed-frame", allow: "autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write", allowFullScreen: true, loading: "lazy" as const, referrerPolicy: "strict-origin-when-cross-origin" as const, title: `${PLATFORM_NAMES[clip.platform]} video` };
  if (!active) return null;
  switch (clip.platform) {
    case "youtube":
      return <iframe {...common} src={`https://www.youtube-nocookie.com/embed/${clip.nativeId}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1`} />;
    case "tiktok":
      return <iframe {...common} src={`https://www.tiktok.com/player/v1/${clip.nativeId}?autoplay=1&muted=1&description=0&music_info=0&rel=0&progress_bar=1`} />;
    case "instagram":
      return <iframe {...common} src={`https://www.instagram.com/${clip.embedRef || "reel"}/${clip.nativeId}/embed/`} scrolling="no" />;
    case "x":
      return <XEmbed id={clip.nativeId} />;
    case "bluesky": {
      const [did, rkey] = clip.nativeId.split("/");
      if (!did?.startsWith("did:")) return null;
      return <iframe {...common} src={`https://embed.bsky.app/embed/${did}/app.bsky.feed.post/${rkey}`} />;
    }
    case "mastodon":
      return clip.embedRef ? <iframe {...common} src={clip.embedRef} sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" /> : null;
  }
}

// ---------------------------------------------------------------- full-screen vertical feed

type Filter = "all" | "europe" | "near";

/** Platforms whose official embed is a post card (text + video) rather than a bare player. */
const CARD_EMBEDS = new Set(["x", "bluesky", "mastodon", "instagram"]);

export function ClipFeed({ start }: { start?: string }) {
  const { t, tc, data, close, me, mounted, country, lang, mergeTr } = useApp();
  const [extra, setExtra] = useState<PublicClip[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [activeId, setActiveId] = useState<string | null>(start ?? null);
  const [cheered, setCheered] = useState<Record<string, number>>({});
  const [toast, setToast] = useState("");
  const [done, setDone] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const myCountry = cityByKey(me.city)?.country ?? null;
  const all = useMemo(() => {
    const seen = new Set<string>();
    return [...data.clips, ...extra].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  }, [data.clips, extra]);
  const clips = all.filter((c) => filter === "all" || (filter === "europe" ? EUROPE.has(c.country) : c.country === myCountry));
  const angles = useMemo(() => angleCounts(all), [all]);

  // Shared links can point at a clip that isn't in the first page: fetch it.
  useEffect(() => {
    if (!start || all.some((c) => c.id === start)) return;
    void fetch(`/api/clip?id=${encodeURIComponent(start)}&lang=${lang}`).then(async (r) => {
      if (!r.ok) return;
      const j = (await r.json()) as { clip: PublicClip; tr: Record<string, string> };
      setExtra((cur) => [j.clip, ...cur]);
      mergeTr(j.tr);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  const loadMore = useCallback(async () => {
    if (done || !all.length) return;
    const last = all[all.length - 1];
    const res = await fetch(`/api/clips?lang=${lang}&before=${encodeURIComponent(last.postedAt)}`);
    if (!res.ok) return;
    const j = (await res.json()) as { clips: PublicClip[]; tr: Record<string, string> };
    if (!j.clips.length) setDone(true);
    setExtra((cur) => [...cur, ...j.clips]);
    mergeTr(j.tr);
  }, [all, done, lang, mergeTr]);

  // The slide that is mostly on screen becomes active (only it loads a player).
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setActiveId((e.target as HTMLElement).dataset.id ?? null);
    }, { root, threshold: 0.6 });
    root.querySelectorAll("[data-id]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [clips.length, filter]);

  useEffect(() => {
    if (start) document.getElementById(`slide-${CSS.escape(start)}`)?.scrollIntoView({ block: "start" });
  }, [start, clips.length]);

  useEffect(() => {
    const idx = clips.findIndex((c) => c.id === activeId);
    if (idx >= clips.length - 3) void loadMore();
  }, [activeId, clips, loadMore]);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  const cheer = async (c: PublicClip) => {
    if (cheered[c.id]) return;
    setCheered((cur) => ({ ...cur, [c.id]: c.cheers + 1 }));
    try {
      const r = await postJson<{ cheers?: number }>(`/api/clips/${encodeURIComponent(c.id)}/cheer`, { deviceId: deviceId() });
      if (r.cheers) setCheered((cur) => ({ ...cur, [c.id]: r.cheers! }));
    } catch {
      // keep the optimistic count
    }
  };

  const share = async (c: PublicClip) => {
    const url = `${window.location.origin}/c/${encodeURIComponent(c.id)}${me.city ? `?from=${me.city}` : ""}`;
    const r = await shareLink(`${tc(c.caption) || c.text} 👊`, url);
    if (r === "copied") flash(t("share.copied"));
  };

  const report = async (c: PublicClip) => {
    await postJson(`/api/clips/${encodeURIComponent(c.id)}/report`, {}).catch(() => undefined);
    flash(t("clips.reported"));
  };

  return (
    <div className="feed" role="dialog" aria-modal="true" aria-label={t("clips.title")}>
      <div className="feed-top">
        <div className="feed-tabs" role="tablist">
          {(["all", "europe", "near"] as Filter[]).filter((f) => f !== "near" || myCountry).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? t("clips.all") : f === "europe" ? t("clips.europe") : `${flag(myCountry ?? "")} ${t("clips.near")}`}
            </button>
          ))}
        </div>
        <button className="feed-close" onClick={close} aria-label={t("clips.close")}>✕</button>
      </div>
      <div className="feed-scroll" ref={scroller}>
        {clips.length === 0 && <div className="feed-empty">{t("clips.empty")}</div>}
        {clips.map((c) => {
          const active = c.id === activeId;
          const n = cheered[c.id] ?? c.cheers;
          return (
            <article key={c.id} id={`slide-${c.id}`} data-id={c.id} className={`slide ${CARD_EMBEDS.has(c.platform) ? "card" : c.vertical ? "vertical" : "wide"}`}>
              <div className="slide-media" style={!active && c.thumbnail ? { backgroundImage: `url("${c.thumbnail}")` } : undefined}>
                <Embed clip={c} active={active} />
                {!active && <span className="slide-play" aria-hidden="true">▶</span>}
              </div>
              <div className="slide-info">
                <p className="slide-where">
                  <span className={`plat plat-${c.platform}`}>{PLATFORM_NAMES[c.platform]}</span>
                  {c.country && flag(c.country)} <b>{(c.place && tc(c.place)) || country(c.country) || "🌍"}</b>
                  {mounted && <> · {ago(c.postedAt, t)}</>}
                  {angles.get(c.id) && <span className="angles">{t("clips.angles", { n: angles.get(c.id)! })}</span>}
                </p>
                <h3 className="slide-cap">{tc(c.caption) || c.text}</h3>
                {c.text && c.caption && !c.caption.startsWith(c.text.slice(0, 24)) && <p className="slide-text">“{c.text}”</p>}
                <p className="slide-src">
                  {c.authorUrl ? <a href={c.authorUrl} target="_blank" rel="noopener noreferrer">{c.authorHandle || c.authorName}</a> : c.authorHandle || c.authorName}
                  {" · "}
                  <a href={c.url} target="_blank" rel="noopener noreferrer">{t("clips.watch_on", { platform: PLATFORM_NAMES[c.platform] })} ↗</a>
                  {c.archiveUrl && <> · <a href={c.archiveUrl} target="_blank" rel="noopener noreferrer">{t("clips.archived")}</a></>}
                </p>
                {c.community && <p className="slide-note">{t("clips.community")}</p>}
              </div>
              <div className="slide-actions">
                <button onClick={() => void cheer(c)} className={cheered[c.id] ? "on" : ""} aria-label={t("clips.cheer")}>
                  <span className="act-ico">👊</span><span>{n ? numberFmt(lang, n) : t("clips.cheer")}</span>
                </button>
                <button onClick={() => void share(c)} aria-label={t("share.share")}>
                  <span className="act-ico">↗</span><span>{t("share.share")}</span>
                </button>
                <button onClick={() => void report(c)} aria-label={t("clips.report")}>
                  <span className="act-ico">⚑</span><span>{t("clips.report")}</span>
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
