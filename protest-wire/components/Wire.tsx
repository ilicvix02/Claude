"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { city as cityByKey, flag } from "@/lib/geo.ts";
import type { Item } from "@/lib/repo.ts";
import { useApp } from "./AppContext.tsx";
import { Section, SectionHead } from "./Chrome.tsx";
import { EUROPE } from "./Clips.tsx";

type Tab = "all" | "europe" | "mine";

export function Wire() {
  const { t, tc, data, time, mounted, me, country, lang, mergeTr } = useApp();
  const [older, setOlder] = useState<Item[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  const [cc, setCc] = useState<string>("");
  const [place, setPlace] = useState<string>("");
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [end, setEnd] = useState(false);
  const seen = useRef<Set<string> | null>(null);

  // Items that arrive through polling get highlighted.
  useEffect(() => {
    const ids = data.items.map((i) => i.id);
    if (seen.current) {
      const added = ids.filter((id) => !seen.current!.has(id));
      if (added.length) setFresh((cur) => new Set([...cur, ...added]));
    }
    seen.current = new Set(ids);
  }, [data.items]);

  const items = useMemo(() => {
    const ids = new Set(data.items.map((i) => i.id));
    return [...data.items, ...older.filter((i) => !ids.has(i.id))];
  }, [data.items, older]);

  const myCountry = cityByKey(me.city)?.country ?? "";
  const inTab = items.filter((i) => tab === "all" || (tab === "europe" ? EUROPE.has(i.country) : i.country === myCountry));
  const countries = useMemo(() => {
    const n = new Map<string, number>();
    for (const i of inTab) if (i.country) n.set(i.country, (n.get(i.country) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c);
  }, [inTab]);
  const byCountry = cc ? inTab.filter((i) => i.country === cc) : inTab;
  const places = useMemo(() => {
    const n = new Map<string, number>();
    for (const i of byCountry) if (i.place) n.set(i.place, (n.get(i.place) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([p]) => p);
  }, [byCountry]);
  const shown = place ? byCountry.filter((i) => i.place === place) : byCountry;

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/wire?lang=${lang}&before=${encodeURIComponent(last.publishedAt)}`);
      const j = (await r.json()) as { items: Item[]; tr: Record<string, string> };
      if (!j.items.length) setEnd(true);
      setOlder((cur) => [...cur, ...j.items]);
      mergeTr(j.tr);
    } finally {
      setLoading(false);
    }
  };

  const tabs: Array<[Tab, string]> = [["all", t("wire.all")], ["europe", t("wire.europe")]];
  if (myCountry) tabs.push(["mine", `${flag(myCountry)} ${country(myCountry)}`]);

  return (
    <Section id="wire">
      <SectionHead kicker="⚡ THE WIRE" title={t("wire.title")} lede={t("wire.lede")} />
      <div className="tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => { setTab(k); setCc(""); setPlace(""); }}>{label}</button>
        ))}
      </div>
      {countries.length > 1 && (
        <div className="chipbar" aria-label="Countries">
          <button className={!cc ? "on" : ""} onClick={() => { setCc(""); setPlace(""); }}>{t("wire.all_countries")}</button>
          {countries.map((c) => (
            <button key={c} className={cc === c ? "on" : ""} onClick={() => { setCc(c); setPlace(""); }}>{flag(c)} {country(c)}</button>
          ))}
        </div>
      )}
      {cc && places.length > 1 && (
        <div className="chipbar small" aria-label="Cities">
          <button className={!place ? "on" : ""} onClick={() => setPlace("")}>{t("wire.all_cities")}</button>
          {places.map((p) => (
            <button key={p} className={place === p ? "on" : ""} onClick={() => setPlace(p)}>{tc(p)}</button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="empty">{t("wire.empty")}</p>
      ) : (
        <ol className="timeline">
          {shown.map((i) => {
            const isNew = mounted && Date.now() - new Date(i.publishedAt).getTime() < 3600_000;
            return (
              <li key={i.id} className={`entry ${fresh.has(i.id) ? "fresh" : ""}`}>
                <div className="entry-meta">
                  <time dateTime={i.publishedAt} suppressHydrationWarning>{time(i.publishedAt)}</time>
                  {isNew && <span className="new-dot" title={t("wire.new")} aria-label={t("wire.new")} />}
                  <span className={`tag tag-${i.tag}`}>{t(`tag.${i.tag}`)}</span>
                  {(i.place || i.country) && <span className="entry-place">{flag(i.country)} {i.place ? tc(i.place) : country(i.country)}</span>}
                </div>
                <h3 className="entry-title">{tc(i.title)}</h3>
                {i.body && <p className="entry-body">{tc(i.body)}</p>}
                <p className="entry-src">
                  {t("wire.sources")}:{" "}
                  {i.sources.map((s, k) => (
                    <span key={s.url}>{k > 0 && " · "}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.name} ↗</a></span>
                  ))}
                </p>
              </li>
            );
          })}
        </ol>
      )}
      {!end && items.length >= 20 && (
        <button className="btn wide" onClick={() => void loadMore()} disabled={loading}>{loading ? t("common.loading") : t("wire.more")}</button>
      )}
    </Section>
  );
}
