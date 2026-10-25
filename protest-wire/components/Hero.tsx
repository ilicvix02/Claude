"use client";

import { numberFmt } from "@/lib/i18n.ts";
import { useApp } from "./AppContext.tsx";
import { Lime, RiseMark } from "./Chrome.tsx";

function Chevrons() {
  // Concentric chevrons pointing outwards, like a stage set. Drawn once, mirrored with CSS.
  const rows = [0, 1, 2, 3];
  return (
    <svg className="chevrons" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <filter id="chev-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g filter="url(#chev-glow)" fill="none" stroke="currentColor" strokeLinejoin="miter">
        <path d="M150 40 200 15 250 40v220l-50 25-50-25Z" strokeWidth="3" opacity=".9" />
        {rows.map((i) => (
          <g key={i} opacity={0.85 - i * 0.17} strokeWidth={6 - i}>
            <path d={`M${120 - i * 34} 30 L${70 - i * 34} 150 L${120 - i * 34} 270`} />
            <path d={`M${280 + i * 34} 30 L${330 + i * 34} 150 L${280 + i * 34} 270`} />
          </g>
        ))}
      </g>
    </svg>
  );
}

export function Hero() {
  const { t, tc, data, lang, open, country } = useApp();
  const s = data.settings;
  const st = data.stats;

  const places: string[] = [];
  for (const c of [...data.live, ...data.clips]) {
    const p = (c.place ? tc(c.place) : country(c.country)).toUpperCase();
    if (p && !places.includes(p)) places.push(p);
    if (places.length === 3) break;
  }
  const event = s.event ? tc(s.event) : places.join(" · ");

  const watch = () => {
    if (data.live.length) {
      document.getElementById("live")?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.dispatchEvent(new CustomEvent("pw:play"));
    } else {
      open({ name: "feed" });
    }
  };

  const chips: Array<[number, string]> = [
    [st.people, t("stat.people")],
    [st.cities, t("stat.cities")],
    [st.countries, t("stat.countries")],
    [st.clipsToday, t("stat.clips")],
  ];
  if (st.live) chips.splice(1, 0, [st.live, t("stat.live")]);

  return (
    <section className="hero">
      <div className="stage" aria-hidden="true">
        <div className="truss" />
        <div className="beams"><i /><i /><i /><i /><i /><i /></div>
        <Chevrons />
        <div className="floor" />
      </div>
      <div className="hero-inner">
        <div className="emblem"><RiseMark size={112} glow /></div>
        <div className="lockup">
          <span className="lockup-name">PROTEST<b>WIRE</b></span>
          <span className="lockup-bar" />
          <span className="lockup-tag">LIVE<br />MOVEMENT</span>
        </div>
        <p className="pill">
          <span className="dot" />
          <span className="pill-k">{t("hero.live")}:</span>
          <span className="pill-v">{event || "🌍"}</span>
        </p>
        <h1 className="headline"><Lime text={s.headline ? tc(s.headline) : t("hero.headline")} /></h1>
        <p className="lede">{s.lede ? tc(s.lede) : t("hero.lede")}</p>
        <ul className="chips">
          {chips.map(([n, label]) => (
            <li key={label}><b>{numberFmt(lang, n)}</b> {label}</li>
          ))}
        </ul>
        <button className="cta" onClick={watch}>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z" fill="currentColor" /></svg>
          {t("hero.watch")}
        </button>
        <button className="cta ghost" onClick={() => open({ name: "in" })}>
          <RiseMark size={22} /> {t("hero.join")}
        </button>
      </div>
    </section>
  );
}
