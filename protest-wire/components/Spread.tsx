"use client";

import { useEffect, useRef, useState } from "react";
import { drawFlag, drawPulse, drawSign, ready, type FlagStyle, type SignStyle } from "@/lib/cards.ts";
import { copy, deviceId, postJson, shareImage } from "@/lib/client.ts";
import { CITIES, flag } from "@/lib/geo.ts";
import { numberFmt } from "@/lib/i18n.ts";
import { type ParsedLink, PLATFORM_NAMES, extractUrl, hashtagLinks } from "@/lib/platforms.ts";
import type { Poll } from "@/lib/repo.ts";
import { useApp } from "./AppContext.tsx";
import { RiseMark, Section, SectionHead } from "./Chrome.tsx";
import { useCityName } from "./Join.tsx";

const TAG = process.env.NEXT_PUBLIC_HASHTAG || "ProtestWire";

function siteLabel(): string {
  return typeof window === "undefined" ? "" : window.location.host.toUpperCase();
}

// ---------------------------------------------------------------- section on the home page

export function MakeItSpread() {
  const { t, open, data } = useApp();
  const [copied, setCopied] = useState("");
  const tags = [TAG, ...data.settings.hashtags.filter((h) => h.replace(/^#/, "").toLowerCase() !== TAG.toLowerCase())].map((h) => h.replace(/^#/, ""));
  return (
    <Section id="spread">
      <SectionHead kicker="⚡ MAKE IT SPREAD" title={t("tags.title")} lede={t("tags.lede")} />
      <div className="tools">
        <button className="tool" onClick={() => open({ name: "flag" })}>
          <span className="tool-art flag-art"><RiseMark size={54} /></span>
          <b>{t("flag.title")}</b>
          <small>{t("flag.lede")}</small>
        </button>
        <button className="tool" onClick={() => open({ name: "sign" })}>
          <span className="tool-art sign-art">{t("sign.default")}</span>
          <b>{t("sign.title")}</b>
          <small>{t("sign.lede")}</small>
        </button>
        <button className="tool" onClick={() => open({ name: "drop" })}>
          <span className="tool-art drop-art">＋▶</span>
          <b>{t("drop.title")}</b>
          <small>{t("drop.tip_share")}</small>
        </button>
      </div>
      <ul className="tags">
        {tags.map((tag) => (
          <li key={tag}>
            <button className="tag-chip" onClick={async () => { if (await copy(`#${tag}`)) { setCopied(tag); setTimeout(() => setCopied(""), 1800); } }}>
              #{tag} <small>{copied === tag ? "✓" : t("tags.copy")}</small>
            </button>
            <span className="tag-links">
              {hashtagLinks(tag).map((l) => (
                <a key={l.platform} href={l.url} target="_blank" rel="noopener noreferrer" aria-label={t("tags.open", { platform: PLATFORM_NAMES[l.platform] })}>
                  {PLATFORM_NAMES[l.platform]}
                </a>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------- Raise your flag (profile picture)

export function FlagSheet() {
  const { t, close } = useApp();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [style, setStyle] = useState<FlagStyle>("ring");
  const [text, setText] = useState(t("flag.default_text"));

  useEffect(() => {
    void ready().then(() => canvas.current && drawFlag(canvas.current, img, style, text || t("flag.default_text")));
  }, [img, style, text, t]);

  const pick = (file: File | undefined) => {
    if (!file) return;
    // The photo is read locally; it is never uploaded anywhere.
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = url;
  };

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={t("flag.title")}>
      <div className="sheet-card">
        <button className="sheet-close" onClick={close} aria-label={t("clips.close")}>✕</button>
        <p className="kicker">🏴 PROTEST WIRE</p>
        <h2 className="sheet-title">{t("flag.title")}</h2>
        <p className="sec-lede">{t("flag.lede")}</p>
        <canvas ref={canvas} className="square-preview" />
        <label className="btn file">
          📷 {t("flag.pick")}
          <input type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0])} hidden />
        </label>
        <p className="label">{t("flag.style")}</p>
        <div className="seg">
          {(["ring", "banner", "duo"] as FlagStyle[]).map((s) => (
            <button key={s} className={s === style ? "on" : ""} onClick={() => setStyle(s)}>{s === "ring" ? "◯" : s === "banner" ? "▬" : "◐"}</button>
          ))}
        </div>
        <label className="label" htmlFor="flag-text">{t("flag.text")}</label>
        <input id="flag-text" className="input" maxLength={40} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="cta" onClick={() => canvas.current && void shareImage(canvas.current, "my-flag.png", `#${TAG}`)}>
          📲 {t("share.share")} / {t("share.download")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Make a sign

export function SignSheet() {
  const { t, close } = useApp();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [text, setText] = useState("");
  const [style, setStyle] = useState<SignStyle>("cardboard");

  useEffect(() => {
    void ready().then(() => canvas.current && drawSign(canvas.current, text || t("sign.default"), style, `#${TAG.toUpperCase()} · ${siteLabel()}`));
  }, [text, style, t]);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={t("sign.title")}>
      <div className="sheet-card">
        <button className="sheet-close" onClick={close} aria-label={t("clips.close")}>✕</button>
        <p className="kicker">🪧 PROTEST WIRE</p>
        <h2 className="sheet-title">{t("sign.title")}</h2>
        <p className="sec-lede">{t("sign.lede")}</p>
        <canvas ref={canvas} className="sign-preview" />
        <textarea className="input" rows={2} maxLength={90} placeholder={t("sign.placeholder")} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="seg">
          {(["cardboard", "lime", "night"] as SignStyle[]).map((s) => (
            <button key={s} className={s === style ? "on" : ""} onClick={() => setStyle(s)}>{s === "cardboard" ? "📦" : s === "lime" ? "🟩" : "🌙"}</button>
          ))}
        </div>
        <button className="cta" onClick={() => canvas.current && void shareImage(canvas.current, "my-sign.png", `#${TAG}`)}>
          📲 {t("share.share")} / {t("share.download")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- The People's Pulse

export function Pulse() {
  const { t, tc, data, setData, lang } = useApp();
  const [voted, setVoted] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const poll = data.poll;

  useEffect(() => {
    if (!poll) return;
    try { const v = localStorage.getItem(`pw-vote-${poll.id}`); if (v !== null) setVoted(Number(v)); } catch { /* ignore */ }
  }, [poll?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!poll) return null;

  const vote = async (i: number) => {
    setVoted(i);
    try { localStorage.setItem(`pw-vote-${poll.id}`, String(i)); } catch { /* ignore */ }
    try {
      const r = await postJson<{ poll: Poll | null }>("/api/pulse", { poll: poll.id, option: i, deviceId: deviceId() });
      if (r.poll) setData({ ...data, poll: r.poll });
    } catch { /* keep the local vote */ }
  };

  const shareResult = async () => {
    if (!canvas.current) return;
    await ready();
    drawPulse(canvas.current, tc(poll.question), poll.options.map(tc), poll.counts, `#${TAG.toUpperCase()} · ${siteLabel()}`);
    await shareImage(canvas.current, "pulse.png", tc(poll.question), window.location.origin);
  };

  return (
    <Section id="pulse">
      <SectionHead kicker={`📊 ${t("pulse.title")}`} title={tc(poll.question)} lede={t("pulse.lede")} />
      <ul className="poll">
        {poll.options.map((o, i) => {
          const pct = poll.total ? Math.round((poll.counts[i] / poll.total) * 100) : 0;
          return (
            <li key={i}>
              <button className={`poll-opt ${voted === i ? "on" : ""}`} onClick={() => voted === null && void vote(i)} disabled={voted !== null}>
                {voted !== null && <i style={{ width: `${pct}%` }} />}
                <span>{tc(o)}</span>
                {voted !== null && <b>{pct}%</b>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="hint">{numberFmt(lang, poll.total)} {t("pulse.votes")}{voted !== null ? ` · ${t("pulse.thanks")}` : ""}</p>
      {voted !== null && <button className="btn" onClick={() => void shareResult()}>📲 {t("share.story")}</button>}
      <canvas ref={canvas} hidden />
    </Section>
  );
}

// ---------------------------------------------------------------- Drop your clip

interface PreviewRes { link: ParsedLink; meta: { title: string; authorName: string; thumbnail: string } | null }

export function DropSheet({ initialUrl }: { initialUrl?: string }) {
  const { t, close, me } = useApp();
  const cityName = useCityName();
  const [url, setUrl] = useState(initialUrl ?? "");
  const [city, setCity] = useState(me.city ?? "");
  const [note, setNote] = useState("");
  const [prev, setPrev] = useState<PreviewRes | null>(null);
  const [state, setState] = useState<"idle" | "checking" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");

  useEffect(() => {
    const u = extractUrl(url);
    if (!u) { setPrev(null); return; }
    setState("checking");
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/preview?url=${encodeURIComponent(u)}`);
        if (!r.ok) throw new Error(t("drop.bad_url"));
        setPrev((await r.json()) as PreviewRes);
        setErr("");
        setState("idle");
      } catch (e) {
        setPrev(null);
        setErr((e as Error).message);
        setState("error");
      }
    }, 450);
    return () => clearTimeout(id);
  }, [url, t]);

  const send = async () => {
    setState("sending");
    try {
      await postJson("/api/clips", { url, city, note, deviceId: deviceId() });
      setState("sent");
    } catch (e) {
      setErr((e as Error).message);
      setState("error");
    }
  };

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={t("drop.title")}>
      <div className="sheet-card">
        <button className="sheet-close" onClick={close} aria-label={t("clips.close")}>✕</button>
        <p className="kicker">▶ TIKTOK · INSTAGRAM · X · YOUTUBE · BLUESKY · MASTODON</p>
        <h2 className="sheet-title">{t("drop.title")}</h2>
        {state === "sent" ? (
          <>
            <p className="big-ok">✅</p>
            <p className="sec-lede">{t("drop.sent")}</p>
            <p className="hint">{t("drop.tag", { tag: `#${TAG}` })}</p>
            <button className="cta" onClick={close}>{t("common.done")}</button>
          </>
        ) : (
          <>
            <p className="sec-lede">{t("drop.lede")}</p>
            <label className="label" htmlFor="drop-url">{t("drop.url")}</label>
            <input id="drop-url" className="input" inputMode="url" placeholder="https://www.tiktok.com/@…/video/…" value={url} onChange={(e) => setUrl(e.target.value)} />
            {prev && (
              <div className="drop-prev">
                {prev.meta?.thumbnail && <span className="drop-thumb" style={{ backgroundImage: `url("${prev.meta.thumbnail}")` }} />}
                <span>
                  <span className={`plat plat-${prev.link.platform}`}>{PLATFORM_NAMES[prev.link.platform]}</span>
                  <b>{prev.meta?.authorName || prev.link.author}</b>
                  <small>{prev.meta?.title?.slice(0, 120)}</small>
                </span>
              </div>
            )}
            {err && <p className="error">{err}</p>}
            <label className="label" htmlFor="drop-city">{t("drop.city")}</label>
            <select id="drop-city" className="input" value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">—</option>
              {CITIES.map((c) => <option key={c.key} value={c.key}>{flag(c.country)} {cityName(c)}</option>)}
            </select>
            <label className="label" htmlFor="drop-note">{t("drop.note")}</label>
            <textarea id="drop-note" className="input" rows={2} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
            <ul className="tips">
              <li>🛡 {t("drop.tip_faces")}</li>
              <li>📲 {t("drop.tip_share")}</li>
            </ul>
            <button className="cta" onClick={() => void send()} disabled={!prev || state === "sending" || state === "checking"}>
              {state === "sending" ? t("common.loading") : t("drop.submit")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
