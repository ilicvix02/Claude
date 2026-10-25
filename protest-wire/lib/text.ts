// Text helpers: protest keyword matching (many languages), hashtags, hashing, similarity, number checks.

import { createHash } from "node:crypto";
import { toLatin } from "./translit.ts";

export function sha(text: string, len = 16): string {
  return createHash("sha256").update(text).digest("hex").slice(0, len);
}

export function fold(text: string): string {
  return toLatin(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "dj");
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#8230;|&hellip;/g, "…")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${sp > max * 0.6 ? cut.slice(0, sp) : cut}…`;
}

// Word stems that signal a protest in the languages of Europe and beyond. Matching runs on
// folded text (Cyrillic transliterated, accents removed), so "протест" and "protèst" both hit.
const PROTEST_STEMS = [
  // English
  "protest", "demonstrat", "rally", "rallies", "riot", "tear gas", "teargas", "march on", "marched", "marchers",
  "sit-in", "walkout", "general strike", "strikers", "uprising", "blockade", "civil disobedience", "genz", "gen z",
  // Serbian / Croatian / Bosnian / Montenegrin
  "protesti", "studenti u blokadi", "blokad", "demonstrac", "strajk", "suzavac", "zbor", "pumpaj", "skup podrske",
  // Spanish / Catalan / Portuguese / Italian / French
  "protesta", "manifestac", "manifestaci", "marcha", "huelga", "vaga", "protesto", "greve", "manifestazion",
  "sciopero", "corteo", "manifestation", "manif ", "greve generale", "emeute",
  // German / Dutch / Nordic
  "kundgebung", "streik", "demonstration", "demonstratie", "staking", "betoging", "mielenosoitus", "lakko",
  "mielenilmaus", "demonstrasjon", "demonstration",
  // Central & Eastern Europe
  "demonstracja", "strajk", "tuntetes", "demonstrace", "demonstracia", "manifestatie", "greva", "miting",
  "mitinh", "protestuval", "protestuj", "protestir", "protestoval",
  // Greek (transliterated by fold? no: Greek stays) — matched separately below
  // Turkish / Caucasus
  "protesto", "eylem", "yuruyus", "gosteri", "aksiya", "akcija",
  // Asia-Pacific & Africa
  "unjuk rasa", "aksi massa", "rally", "andolan", "hartal", "maandamano",
];

const GREEK = ["διαδήλωση", "διαδηλωτ", "απεργία", "συλλαλητήριο"];
const GEORGIAN = ["აქცია", "პროტესტ"];
const ARMENIAN = ["բողոք", "ցույց"];

const STEM_RE = new RegExp(PROTEST_STEMS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");

export function isProtestText(text: string): boolean {
  if (!text) return false;
  if (STEM_RE.test(fold(text))) return true;
  const lower = text.toLowerCase();
  return [...GREEK, ...GEORGIAN, ...ARMENIAN].some((w) => lower.includes(w));
}

// Serbian-specific terms the wire keeps from Serbian outlets (elections, gatherings, students).
const SERBIA_RE = /\b(protest\w*|demonstra\w*|blokad\w*|studen\w*|izbor\w*|skup(a|u|om|ovi|ova)?|zbor\w*|strajk\w*|suzav\w*|policij\w*|incident\w*|okupljan\w*|mars\w*|pumpaj)\b/i;

export function isSerbianProtestText(text: string): boolean {
  return SERBIA_RE.test(fold(text)) || isProtestText(text);
}

export function hashtags(text: string): string[] {
  const tags = new Set<string>();
  for (const m of text.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_]{2,50})/gu)) tags.add(m[1]);
  return [...tags].slice(0, 20);
}

// --- similarity (for de-duplication before we spend AI tokens) ---

function tokens(text: string): Set<string> {
  return new Set(fold(text).replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length > 2));
}

export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter);
}

// --- number check: AI output may only contain numbers that appear in the source ---

function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d[\d.,\s]*\d|\d/g)) {
    const digits = m[0].replace(/[.,\s]/g, "");
    if (digits) out.push(digits.replace(/^0+(?=\d)/, ""));
  }
  return out;
}

/** Returns the numbers in `output` that do not appear in `source` (so the item can be held for review). */
export function unverifiedNumbers(output: string, source: string): string[] {
  const src = numbersIn(source);
  const bad: string[] = [];
  for (const n of numbersIn(output)) {
    // "10 thousand" written from "10.000" / "10,000": accept a leading match followed by zeros.
    const ok = src.some((s) => s === n || (s.startsWith(n) && /^0+$/.test(s.slice(n.length))));
    if (!ok) bad.push(n);
  }
  return bad;
}
