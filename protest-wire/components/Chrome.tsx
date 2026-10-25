"use client";

import type { ReactNode } from "react";
import { city as cityByKey, flag } from "@/lib/geo.ts";
import { LOCALES, numberFmt, script } from "@/lib/i18n.ts";
import { useApp } from "./AppContext.tsx";

/** The movement's mark: three rising chevrons in a hexagon ("Rise"). Original artwork, free to reuse. */
export function RiseMark({ size = 32, glow = false }: { size?: number; glow?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={glow ? "mark glow" : "mark"}>
      <path d="M32 3 57 17.5v29L32 61 7 46.5v-29Z" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <path d="M19 42 32 31l13 11M19 33 32 22l13 11M19 24 32 13l13 11" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Squiggle() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" className="squiggle">
      <path d="M3 9c3-4 6 4 9 0s6 4 9 0M3 17c3-4 6 4 9 0s6 4 9 0" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/** Highlight *words* in lime. */
export function Lime({ text }: { text: string }) {
  const parts = text.split(/\*([^*]+)\*/g);
  return <>{parts.map((p, i) => (i % 2 ? <em key={i} className="lime">{p}</em> : <span key={i}>{p}</span>))}</>;
}

export function SectionHead({ kicker, title, lede, id }: { kicker?: string; title: string; lede?: string; id?: string }) {
  return (
    <header className="sec-head" id={id}>
      {kicker && <p className="kicker">{kicker}</p>}
      <h2 className="sec-title"><Lime text={title} /></h2>
      {lede && <p className="sec-lede">{lede}</p>}
    </header>
  );
}

export function Section({ id, children, className = "" }: { id?: string; children: ReactNode; className?: string }) {
  return <section id={id} className={`sec ${className}`}>{children}</section>;
}

export function AnnouncementBar() {
  const { data, tc, t, open, me } = useApp();
  const text = data.settings.announcement ? tc(data.settings.announcement) : t("app.tagline");
  return (
    <div className="topbar">
      <div className="topbar-line">
        <Squiggle />
        {data.settings.announcementUrl ? <a href={data.settings.announcementUrl} target="_blank" rel="noopener noreferrer">{text}</a> : <span>{text}</span>}
        <Squiggle />
      </div>
      <button className="topbar-btn" onClick={() => open({ name: "in" })}>
        <RiseMark size={20} /> {me.n ? `#${numberFmt("en", me.n)} · ${t("share.share")}` : t("hero.join")}
      </button>
    </div>
  );
}

export function Header() {
  const { t, lang, setLang, open, data, time, mounted } = useApp();
  return (
    <div className="header">
      <a href="#top" className="logo" aria-label={t("app.name")}>
        <RiseMark size={26} />
        <span>PROTEST<b>WIRE</b></span>
      </a>
      {data.updatedAt && <span className="updated" suppressHydrationWarning>{mounted ? t("header.updated", { time: time(data.updatedAt) }) : ""}</span>}
      <div className="langs" role="group" aria-label={t("header.language")}>
        {LOCALES.filter((l) => l.quick).map((l) => (
          <button key={l.code} className={l.code === lang ? "on" : ""} onClick={() => void setLang(l.code)} lang={l.code} aria-pressed={l.code === lang}>
            {l.quick}
          </button>
        ))}
        <button className={LOCALES.find((l) => l.code === lang)?.quick ? "" : "on"} onClick={() => open({ name: "lang" })} aria-label={t("header.language")}>
          {LOCALES.find((l) => l.code === lang)?.quick ? "🌐" : `🌐 ${lang.toUpperCase()}`}
        </button>
      </div>
    </div>
  );
}

export function InviteBanner() {
  const { me, t, lang } = useApp();
  const c = cityByKey(me.ref);
  if (!c || me.n) return null;
  return (
    <div className="invite">
      <span className="invite-flag">{flag(c.country)}</span>
      <span>{t("in.invited", { city: script(lang, lang === "en" ? c.en : c.sr) })}</span>
    </div>
  );
}

export function BottomNav() {
  const { t, open } = useApp();
  return (
    <nav className="bottomnav" aria-label="Main">
      <a href="#top"><NavIcon d="M4 11 12 4l8 7v9h-5v-6H9v6H4z" />{t("nav.home")}</a>
      <button onClick={() => open({ name: "feed" })}><NavIcon d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 6v6l5-3z" />{t("nav.clips")}</button>
      <button className="nav-in" onClick={() => open({ name: "in" })}>
        <span className="nav-in-btn"><RiseMark size={30} /></span>
        {t("nav.in")}
      </button>
      <a href="#map"><NavIcon d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />{t("nav.map")}</a>
      <a href="#wire"><NavIcon d="M4 5h16M4 10h16M4 15h10M4 20h7" />{t("nav.wire")}</a>
    </nav>
  );
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Footer() {
  const { t, data } = useApp();
  const demo = !data.setup.db || !data.setup.ai;
  return (
    <footer className="footer">
      <div className="footer-logo"><RiseMark size={36} glow /> <span>PROTEST<b>WIRE</b></span></div>
      <p>{t("footer.embed")}</p>
      <p>{t("footer.privacy")}</p>
      <p>{t("footer.ai")}</p>
      {demo && <p className="demo">{t("footer.demo")}</p>}
    </footer>
  );
}
