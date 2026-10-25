"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { HomeData } from "@/lib/data.ts";
import { countryName } from "@/lib/geo.ts";
import { type Dict, type Key, htmlLang, looksSerbianLatin, makeT, script } from "@/lib/i18n.ts";

export type Sheet =
  | { name: "in"; kind?: "in" | "minute" }
  | { name: "feed"; start?: string }
  | { name: "lang" }
  | { name: "drop"; url?: string }
  | { name: "flag" }
  | { name: "sign" }
  | null;

export interface AppCtx {
  lang: string;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  /** Content text (captions, wire): cached translation if we have one, then script conversion. */
  tc: (text: string) => string;
  country: (code: string) => string;
  time: (iso: string) => string;
  mounted: boolean;
  data: HomeData;
  setData: (d: HomeData) => void;
  mergeTr: (tr: Record<string, string>) => void;
  setLang: (code: string) => Promise<void>;
  sheet: Sheet;
  open: (s: Sheet) => void;
  close: () => void;
  me: { city: string | null; n: number | null; ref: string | null };
  setMe: (m: Partial<AppCtx["me"]>) => void;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}

export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

export function buildHelpers(lang: string, chain: Dict[], tr: Record<string, string>, mounted: boolean) {
  const t = makeT(lang, chain);
  const tc = (text: string) => {
    if (!text) return "";
    const hit = tr[text.trim()];
    if (hit) return script(lang, hit);
    // Untranslated: convert to Cyrillic only if it's already Serbian Latin.
    return lang === "sr-Cyrl" && looksSerbianLatin(text) ? script(lang, text) : text;
  };
  const tag = htmlLang(lang);
  let names: Intl.DisplayNames | null = null;
  const country = (code: string) => {
    if (!code) return "";
    if (lang === "en") return countryName(code, "en");
    if (["sr", "sr-Cyrl", "bs", "hr", "cnr"].includes(lang)) return script(lang, countryName(code, "sr"));
    try {
      names ??= new Intl.DisplayNames([tag], { type: "region" });
      return code === "XK" ? countryName(code, "en") : names.of(code) ?? code;
    } catch {
      return countryName(code, "en");
    }
  };
  const time = (iso: string) => {
    if (!iso) return "";
    try {
      // Server and first client render use UTC so the HTML matches; after mount we switch to local time.
      return new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", timeZone: mounted ? undefined : "UTC" }).format(new Date(iso));
    } catch {
      return iso.slice(11, 16);
    }
  };
  return { t, tc, country, time };
}
