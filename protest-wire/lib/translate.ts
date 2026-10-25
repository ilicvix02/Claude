// Content translation (captions, wire stories, poll questions). Written once in English, translated
// by Claude the first time someone reads it in a language, then cached forever in the translations table.

import { aiAvailable, translateTexts } from "./ai.ts";
import type { Db } from "./db.ts";
import { LOCALES, contentLang } from "./i18n.ts";
import { getTranslations, saveTranslations } from "./repo.ts";
import { sha } from "./text.ts";

export function textKey(text: string): string {
  return sha(text.trim(), 20);
}

/** Returns translations that already exist, plus the texts still missing. English is returned as-is. */
export async function lookup(db: Db, uiLang: string, texts: string[]): Promise<{ map: Map<string, string>; missing: string[] }> {
  const lang = contentLang(uiLang);
  const unique = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (lang === "en") {
    for (const t of unique) map.set(t, t);
    return { map, missing: [] };
  }
  const found = await getTranslations(db, unique.map(textKey), lang);
  const missing: string[] = [];
  for (const t of unique) {
    const hit = found.get(textKey(t));
    if (hit) map.set(t, hit);
    else missing.push(t);
  }
  return { map, missing };
}

const inFlight = new Set<string>();

/** Translates up to `max` missing texts into a language and stores them. Safe to call concurrently. */
export async function fill(db: Db, uiLang: string, missing: string[], max = 40): Promise<number> {
  const lang = contentLang(uiLang);
  const meta = LOCALES.find((l) => l.code === lang);
  if (lang === "en" || !meta || !missing.length || !(await aiAvailable(db))) return 0;
  const todo = missing.filter((t) => !inFlight.has(`${lang}:${t}`)).slice(0, max);
  if (!todo.length) return 0;
  todo.forEach((t) => inFlight.add(`${lang}:${t}`));
  try {
    const out = await translateTexts(db, todo, meta.english);
    await saveTranslations(db, lang, todo.map((t, i) => [textKey(t), out[i]]));
    return todo.length;
  } finally {
    todo.forEach((t) => inFlight.delete(`${lang}:${t}`));
  }
}
