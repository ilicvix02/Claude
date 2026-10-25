"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HomeData } from "@/lib/data.ts";
import { setLangCookie, store } from "@/lib/client.ts";
import { city as cityByKey } from "@/lib/geo.ts";
import { type Dict, htmlLang, isLocale, matchLocale } from "@/lib/i18n.ts";
import { type AppCtx, Ctx, type Sheet, buildHelpers, useMounted } from "./AppContext.tsx";
import { AnnouncementBar, BottomNav, Footer, Header, InviteBanner } from "./Chrome.tsx";
import { ClipFeed, ClipRail } from "./Clips.tsx";
import { CityRace, InSheet, MinuteCard } from "./Join.tsx";
import { LanguageSheet } from "./LanguageSheet.tsx";
import { Hero } from "./Hero.tsx";
import { LiveSection } from "./Live.tsx";
import { MapSection } from "./MapSection.tsx";
import { DropSheet, FlagSheet, MakeItSpread, Pulse, SignSheet } from "./Spread.tsx";
import { Wire } from "./Wire.tsx";

export interface AppProps {
  lang: string;
  chain: Dict[];
  data: HomeData;
  /** Open the clip feed at this clip (shared clip links). */
  openClip?: string;
  /** Pre-filled link from the share target (/drop?url=...). */
  dropUrl?: string;
}

export function App(props: AppProps) {
  const mounted = useMounted();
  const [lang, setLangState] = useState(props.lang);
  const [chain, setChain] = useState<Dict[]>(props.chain);
  const [data, setData] = useState<HomeData>(props.data);
  const [tr, setTr] = useState<Record<string, string>>(props.data.tr);
  const [sheet, setSheet] = useState<Sheet>(props.openClip ? { name: "feed", start: props.openClip } : props.dropUrl !== undefined ? { name: "drop", url: props.dropUrl } : null);
  const [me, setMeState] = useState<AppCtx["me"]>({ city: null, n: null, ref: null });
  const langRef = useRef(lang);
  langRef.current = lang;

  const helpers = useMemo(() => buildHelpers(lang, chain, tr, mounted), [lang, chain, tr, mounted]);

  const mergeTr = useCallback((more: Record<string, string>) => setTr((cur) => ({ ...cur, ...more })), []);

  const refresh = useCallback(async (forLang = langRef.current) => {
    try {
      const res = await fetch(`/api/home?lang=${encodeURIComponent(forLang)}`);
      if (!res.ok) return;
      const next = (await res.json()) as HomeData;
      if (forLang !== langRef.current) return;
      setData(next);
      setTr((cur) => ({ ...cur, ...next.tr }));
    } catch {
      // offline: keep what we have
    }
  }, []);

  const setLang = useCallback(async (code: string) => {
    if (!isLocale(code)) return;
    const res = await fetch(`/api/i18n/${encodeURIComponent(code)}`);
    const json = (await res.json()) as { chain: Dict[] };
    setChain(json.chain);
    setLangState(code);
    setTr({});
    store("pw-lang", code);
    setLangCookie(code);
    document.documentElement.lang = htmlLang(code);
    await refresh(code);
  }, [refresh]);

  // First visit: remember or detect the language, the invite source and this device's check-in.
  useEffect(() => {
    const saved = store("pw-lang");
    const wanted = isLocale(saved) ? saved : matchLocale(navigator.languages ?? [navigator.language]);
    if (wanted !== props.lang) void setLang(wanted);
    else { store("pw-lang", wanted); setLangCookie(wanted); }

    const params = new URLSearchParams(window.location.search);
    const from = params.get("from");
    if (from && cityByKey(from) && !store("pw-ref")) store("pw-ref", from);
    const n = Number(store("pw-n"));
    setMeState({ city: store("pw-city"), n: Number.isFinite(n) && n > 0 ? n : null, ref: store("pw-ref") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Installable app: needed for "Share → Protest Wire" from TikTok / Instagram on Android.
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  // Live updates: poll every 30 s while the tab is visible.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => { timer = setInterval(() => void refresh(), 30_000); };
    const onVis = () => {
      clearInterval(timer);
      if (document.visibilityState === "visible") { void refresh(); start(); }
    };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [refresh]);

  // Android back button closes sheets.
  useEffect(() => {
    if (!sheet) return;
    history.pushState({ sheet: true }, "");
    const onPop = () => setSheet(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [sheet]);

  const close = useCallback(() => {
    if (history.state?.sheet) history.back();
    else setSheet(null);
  }, []);

  const setMe = useCallback((m: Partial<AppCtx["me"]>) => {
    setMeState((cur) => {
      const next = { ...cur, ...m };
      if (m.city !== undefined) store("pw-city", m.city);
      if (m.n !== undefined) store("pw-n", m.n ? String(m.n) : null);
      return next;
    });
  }, []);

  const ctx: AppCtx = {
    lang, ...helpers, mounted, data, setData, mergeTr, setLang, sheet,
    open: (s) => setSheet(s), close, me, setMe,
  };

  // Escape closes sheets on desktop.
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, close]);

  // Body scroll lock while a sheet is open.
  useEffect(() => {
    document.body.classList.toggle("locked", Boolean(sheet));
  }, [sheet]);

  return (
    <Ctx.Provider value={ctx}>
      <AnnouncementBar />
      <Header />
      <main id="top">
        <Hero />
        <InviteBanner />
        <MinuteCard />
        <LiveSection />
        <ClipRail />
        <CityRace />
        <MapSection />
        <MakeItSpread />
        <Pulse />
        <Wire />
      </main>
      <Footer />
      <BottomNav />
      {sheet?.name === "feed" && <ClipFeed start={sheet.start} />}
      {sheet?.name === "in" && <InSheet kind={sheet.kind ?? "in"} />}
      {sheet?.name === "lang" && <LanguageSheet />}
      {sheet?.name === "drop" && <DropSheet initialUrl={sheet.url} />}
      {sheet?.name === "flag" && <FlagSheet />}
      {sheet?.name === "sign" && <SignSheet />}
    </Ctx.Provider>
  );
}

