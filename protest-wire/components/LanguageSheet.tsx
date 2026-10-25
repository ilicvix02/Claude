"use client";

import { LOCALES } from "@/lib/i18n.ts";
import { useApp } from "./AppContext.tsx";

export function LanguageSheet() {
  const { t, lang, setLang, close } = useApp();
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={t("header.language")}>
      <div className="sheet-card">
        <button className="sheet-close" onClick={close} aria-label={t("clips.close")}>✕</button>
        <p className="kicker">🌐</p>
        <h2 className="sheet-title">{t("header.language")}</h2>
        <ul className="langgrid">
          {LOCALES.map((l) => (
            <li key={l.code}>
              <button
                lang={l.code}
                className={l.code === lang ? "on" : ""}
                aria-pressed={l.code === lang}
                onClick={async () => { await setLang(l.code); close(); }}
              >
                <b>{l.native}</b>
                <small>{l.english}</small>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
