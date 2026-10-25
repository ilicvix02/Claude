"use client";

import { useEffect, useRef, useState } from "react";
import { numberFmt } from "@/lib/i18n.ts";
import { useApp } from "./AppContext.tsx";
import { Section, SectionHead } from "./Chrome.tsx";

interface YTPlayer {
  loadVideoById(id: string): void;
  playVideo(): void;
  unMute(): void;
  destroy(): void;
}
interface YTNamespace { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer }
declare global {
  interface Window { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void }
}

let apiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT!); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    document.head.appendChild(s);
  });
  return apiPromise;
}

export function LiveSection() {
  const { t, tc, data, lang } = useApp();
  const streams = data.live.filter((c) => c.platform === "youtube");
  const [current, setCurrent] = useState<string | null>(streams[0]?.nativeId ?? null);
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);

  // If the stream we're showing ends, move to the next one.
  useEffect(() => {
    if (!streams.length) setCurrent(null);
    else if (!current || !streams.some((s) => s.nativeId === current)) setCurrent(streams[0].nativeId);
  }, [streams, current]);

  useEffect(() => {
    if (!current || !host.current) return;
    if (player.current) { player.current.loadVideoById(current); return; }
    let cancelled = false;
    const el = document.createElement("div");
    host.current.appendChild(el);
    void loadYouTubeApi().then((YT) => {
      if (cancelled) return;
      player.current = new YT.Player(el, {
        videoId: current,
        host: "https://www.youtube-nocookie.com",
        playerVars: { autoplay: 1, mute: 1, playsinline: 1, rel: 0, modestbranding: 1 },
      });
    });
    return () => { cancelled = true; };
  }, [current]);

  useEffect(() => () => { player.current?.destroy(); player.current = null; }, []);

  // "WATCH LIVE" in the hero: play with sound (the tap counts as a user gesture).
  useEffect(() => {
    const onPlay = () => { player.current?.unMute(); player.current?.playVideo(); };
    window.addEventListener("pw:play", onPlay);
    return () => window.removeEventListener("pw:play", onPlay);
  }, []);

  if (!streams.length) return null;
  const active = streams.find((s) => s.nativeId === current) ?? streams[0];

  return (
    <Section id="live">
      <SectionHead kicker={`● ${t("hero.live")}`} title={t("live.title")} lede={t("live.lede")} />
      <div className="player"><div ref={host} className="player-host" /></div>
      <p className="player-meta">
        <b>{active.authorName}</b>
        {active.place && <> · {active.place}</>}
        {active.liveViewers ? <> · {t("live.viewers", { n: numberFmt(lang, active.liveViewers) })}</> : null}
      </p>
      {active.caption && <p className="player-caption">{tc(active.caption)}</p>}
      {streams.length > 1 && (
        <div className="strip" role="list">
          {streams.map((s) => (
            <button key={s.id} role="listitem" className={`strip-item ${s.nativeId === current ? "on" : ""}`} onClick={() => setCurrent(s.nativeId)}>
              <span className="strip-thumb" style={{ backgroundImage: `url("${s.thumbnail || `https://i.ytimg.com/vi/${s.nativeId}/mqdefault.jpg`}")` }}>
                <span className="live-badge">● LIVE</span>
              </span>
              <span className="strip-name">{s.authorName}</span>
              {s.place && <span className="strip-place">{s.place}</span>}
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}
