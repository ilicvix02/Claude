"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { drawStory, ready } from "@/lib/cards.ts";
import { copy, deviceId, inviteUrl, postJson, shareImage, shareLink } from "@/lib/client.ts";
import type { Stats } from "@/lib/repo.ts";
import { CITIES, type City, city as cityByKey, flag, nearestCity } from "@/lib/geo.ts";
import { numberFmt, script } from "@/lib/i18n.ts";
import { useApp } from "./AppContext.tsx";
import { RiseMark, Section, SectionHead } from "./Chrome.tsx";

export function useCityName() {
  const { lang } = useApp();
  const local = ["sr", "sr-Cyrl", "bs", "hr", "cnr"].includes(lang);
  return (c: City | undefined) => (c ? script(lang, local ? c.sr : c.en) : "");
}

function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

// ---------------------------------------------------------------- The Global Minute

export function MinuteCard() {
  const { t, data, open, time, lang, mounted } = useApp();
  const now = useNow(mounted);
  const start = new Date(data.minute.startsAt).getTime();
  const end = new Date(data.minute.endsAt).getTime();
  const active = mounted ? now >= start && now < end : data.minute.active;
  return (
    <Section id="minute" className={`minute ${active ? "is-live" : ""}`}>
      <div className="minute-card">
        <p className="kicker">⏱ {t("minute.title")}</p>
        {active ? (
          <>
            <h2 className="minute-now">{t("minute.now")}</h2>
            <p className="minute-count"><b>{numberFmt(lang, data.stats.minuteNow)}</b> {t("minute.joined")}</p>
          </>
        ) : (
          <>
            <p className="minute-label">{t("minute.next")}</p>
            <p className="minute-clock" suppressHydrationWarning>{mounted ? hms(start - now) : "--:--:--"}</p>
          </>
        )}
        <p className="sec-lede" suppressHydrationWarning>{t("minute.lede", { time: mounted ? time(data.minute.startsAt) : `${data.minute.startsAt.slice(11, 16)} UTC` })}</p>
        <button className={`cta ${active ? "" : "ghost"}`} onClick={() => open({ name: "in", kind: active ? "minute" : "in" })} disabled={!mounted}>
          <RiseMark size={22} /> {active ? t("minute.cta") : t("hero.join")}
        </button>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- City picker

function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "dj");
}

function CityPicker({ value, onChange }: { value: string | null; onChange: (key: string) => void }) {
  const { t, country } = useApp();
  const cityName = useCityName();
  const [q, setQ] = useState("");
  const [locating, setLocating] = useState(false);
  const list = useMemo(() => {
    const f = fold(q.trim());
    const hits = f ? CITIES.filter((c) => fold(`${c.en} ${c.sr} ${country(c.country)}`).includes(f)) : CITIES;
    return hits.slice(0, 60);
  }, [q, country]);

  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { onChange(nearestCity(pos.coords.latitude, pos.coords.longitude).key); setLocating(false); },
      () => setLocating(false),
      { maximumAge: 600_000, timeout: 10_000, enableHighAccuracy: false },
    );
  };

  const selected = cityByKey(value);
  return (
    <div className="picker">
      <label className="label" htmlFor="city-q">{t("in.city")}</label>
      {selected && <p className="picked">{flag(selected.country)} <b>{cityName(selected)}</b> · {country(selected.country)}</p>}
      <div className="picker-row">
        <input id="city-q" className="input" placeholder={t("in.search")} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        <button className="btn" onClick={locate} disabled={locating}>{locating ? "…" : "📍"}</button>
      </div>
      <p className="hint">{t("in.locate_note")}</p>
      <ul className="picker-list" role="listbox" aria-label={t("in.city")}>
        {list.map((c) => (
          <li key={c.key}>
            <button role="option" aria-selected={c.key === value} className={c.key === value ? "on" : ""} onClick={() => onChange(c.key)}>
              <span>{flag(c.country)}</span> {cityName(c)} <small>{country(c.country)}</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- I'm in

export function InSheet({ kind }: { kind: "in" | "minute" }) {
  const { t, close, me, setMe, data, setData, lang, country } = useApp();
  const cityName = useCityName();
  const [cityKey, setCityKey] = useState<string | null>(me.city);
  const [result, setResult] = useState<{ n: number; isNew: boolean } | null>(kind === "in" && me.n ? { n: me.n, isNew: false } : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const c = cityByKey(cityKey ?? me.city);

  const submit = async () => {
    if (!cityKey) { setErr(t("in.city")); return; }
    setBusy(true); setErr("");
    try {
      const r = await postJson<{ n: number; isNew: boolean; stats: Stats }>("/api/in", { city: cityKey, ref: me.ref, deviceId: deviceId(), kind });
      setResult({ n: r.n, isNew: r.isNew });
      setData({ ...data, stats: r.stats });
      if (kind === "in") setMe({ city: cityKey, n: r.n });
      else setMe({ city: cityKey });
    } catch (e) {
      setErr((e as Error).message || t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const invite = inviteUrl(c?.key ?? null, result?.n);
  const placeLine = c ? `${flag(c.country)} ${cityName(c).toUpperCase()} · ${country(c.country).toUpperCase()}` : "";

  useEffect(() => {
    if (!result || !canvas.current) return;
    void ready().then(() => {
      if (!canvas.current) return;
      drawStory(canvas.current, {
        number: `#${numberFmt(lang, result.n)}`,
        line: kind === "minute" ? t("minute.now") : t("share.card_line"),
        cityLine: placeLine,
        cta: t("share.card_cta"),
        url: invite.split("?")[0],
      });
    });
  }, [result, lang, kind, placeLine, invite, t]);

  const text = t("share.invite_text", { city: c ? cityName(c) : "" });
  const flash = (s: string) => { setNote(s); setTimeout(() => setNote(""), 2200); };

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={t("in.title")}>
      <div className="sheet-card">
        <button className="sheet-close" onClick={close} aria-label={t("clips.close")}>✕</button>
        {!result ? (
          <>
            <p className="kicker">{kind === "minute" ? `⏱ ${t("minute.title")}` : "👊 PROTEST WIRE"}</p>
            <h2 className="sheet-title">{kind === "minute" ? t("minute.now") : t("in.title")}</h2>
            <p className="sec-lede">{t("in.lede")}</p>
            <CityPicker value={cityKey} onChange={setCityKey} />
            {err && <p className="error">{err}</p>}
            <button className="cta sticky" onClick={() => void submit()} disabled={busy || !cityKey}>
              <RiseMark size={24} /> {busy ? t("common.loading") : kind === "minute" ? t("minute.cta") : t("in.button")}
            </button>
          </>
        ) : (
          <>
            <p className="kicker">{result.isNew ? "✅" : "👊"} PROTEST WIRE</p>
            <h2 className="sheet-title big">{kind === "minute" ? `${numberFmt(lang, data.stats.minuteNow)} ${t("minute.joined")}` : t("in.done", { n: numberFmt(lang, result.n) })}</h2>
            <p className="sec-lede">{!result.isNew && kind === "in" ? t("in.already") : t("in.done_city", { city: c ? cityName(c) : "" })}</p>
            <canvas ref={canvas} className="story-preview" aria-label={t("share.story")} />
            <div className="share-row">
              <button className="cta" onClick={() => canvas.current && void shareImage(canvas.current, "protest-wire.png", text, invite)}>📲 {t("share.story")}</button>
              <button className="btn" onClick={async () => flash((await copy(invite)) ? t("share.copied") : t("common.error"))}>🔗 {t("share.copy")}</button>
              <button className="btn" onClick={async () => { const r = await shareLink(text, invite); if (r === "copied") flash(t("share.copied")); }}>↗ {t("share.share")}</button>
            </div>
            {note && <p className="toast inline" role="status">{note}</p>}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- City race

export function CityRace() {
  const { t, data, lang, open, country } = useApp();
  const cityName = useCityName();
  const rows = data.race;
  const max = Math.max(1, ...rows.map((r) => r.score));
  return (
    <Section id="race">
      <SectionHead kicker={`🏁 ${t("race.week")}`} title={t("race.title")} lede={t("race.lede")} />
      {rows.length === 0 ? (
        <div className="empty"><p>{t("race.empty")}</p><button className="cta small" onClick={() => open({ name: "in" })}>{t("hero.join")}</button></div>
      ) : (
        <ol className="race">
          {rows.map((r, i) => {
            const c = cityByKey(r.cityKey);
            return (
              <li key={r.cityKey}>
                <span className="race-pos">{i + 1}</span>
                <span className="race-name">{c ? `${flag(c.country)} ${cityName(c)}` : r.cityKey}<small>{c ? country(c.country) : ""}</small></span>
                <span className="race-bar"><i style={{ width: `${(r.score / max) * 100}%` }} /></span>
                <span className="race-n">{numberFmt(lang, r.score)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
