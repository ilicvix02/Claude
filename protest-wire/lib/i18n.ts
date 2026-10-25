// UI language support. English is the source of truth (EN below); every other language lives in
// locales/<code>.json with the same keys. Serbian Cyrillic is generated from Serbian Latin.
// Missing keys fall back along FALLBACK, then to English.

import { toCyrillic } from "./translit.ts";

export interface LocaleMeta { code: string; native: string; english: string; quick?: string }

export const LOCALES: LocaleMeta[] = [
  { code: "en", native: "English", english: "English", quick: "EN" },
  { code: "sr", native: "Srpski (latinica)", english: "Serbian (Latin)", quick: "SR" },
  { code: "sr-Cyrl", native: "Српски (ћирилица)", english: "Serbian (Cyrillic)", quick: "СР" },
  { code: "sq", native: "Shqip", english: "Albanian" },
  { code: "hy", native: "Հայերեն", english: "Armenian" },
  { code: "az", native: "Azərbaycanca", english: "Azerbaijani" },
  { code: "be", native: "Беларуская", english: "Belarusian" },
  { code: "bs", native: "Bosanski", english: "Bosnian" },
  { code: "bg", native: "Български", english: "Bulgarian" },
  { code: "ca", native: "Català", english: "Catalan" },
  { code: "hr", native: "Hrvatski", english: "Croatian" },
  { code: "cs", native: "Čeština", english: "Czech" },
  { code: "da", native: "Dansk", english: "Danish" },
  { code: "nl", native: "Nederlands", english: "Dutch" },
  { code: "et", native: "Eesti", english: "Estonian" },
  { code: "fi", native: "Suomi", english: "Finnish" },
  { code: "fr", native: "Français", english: "French" },
  { code: "ka", native: "ქართული", english: "Georgian" },
  { code: "de", native: "Deutsch", english: "German" },
  { code: "el", native: "Ελληνικά", english: "Greek" },
  { code: "hu", native: "Magyar", english: "Hungarian" },
  { code: "is", native: "Íslenska", english: "Icelandic" },
  { code: "ga", native: "Gaeilge", english: "Irish" },
  { code: "it", native: "Italiano", english: "Italian" },
  { code: "lv", native: "Latviešu", english: "Latvian" },
  { code: "lt", native: "Lietuvių", english: "Lithuanian" },
  { code: "lb", native: "Lëtzebuergesch", english: "Luxembourgish" },
  { code: "mk", native: "Македонски", english: "Macedonian" },
  { code: "mt", native: "Malti", english: "Maltese" },
  { code: "cnr", native: "Crnogorski", english: "Montenegrin" },
  { code: "no", native: "Norsk", english: "Norwegian" },
  { code: "pl", native: "Polski", english: "Polish" },
  { code: "pt", native: "Português", english: "Portuguese" },
  { code: "ro", native: "Română", english: "Romanian" },
  { code: "ru", native: "Русский", english: "Russian" },
  { code: "sk", native: "Slovenčina", english: "Slovak" },
  { code: "sl", native: "Slovenščina", english: "Slovenian" },
  { code: "es", native: "Español", english: "Spanish" },
  { code: "sv", native: "Svenska", english: "Swedish" },
  { code: "tr", native: "Türkçe", english: "Turkish" },
  { code: "uk", native: "Українська", english: "Ukrainian" },
];

export const LOCALE_CODES = LOCALES.map((l) => l.code);
export type Lang = string;

/** Languages whose missing strings borrow from a close neighbour before English. */
const FALLBACK: Record<string, string> = { cnr: "bs", lb: "de" };

export function isLocale(code: string | null | undefined): code is string {
  return !!code && LOCALE_CODES.includes(code);
}

/** BCP-47 tag for <html lang> and Intl. */
export function htmlLang(code: string): string {
  if (code === "sr") return "sr-Latn";
  if (code === "no") return "nb";
  return code;
}

/** Pick the best supported locale from Accept-Language / navigator.languages. */
export function matchLocale(prefs: readonly string[]): string {
  for (const raw of prefs) {
    const p = raw.trim().split(";")[0];
    if (!p) continue;
    const lower = p.toLowerCase();
    if (lower.startsWith("sr")) return lower.includes("cyrl") ? "sr-Cyrl" : "sr";
    if (lower === "nb" || lower === "nn" || lower.startsWith("nb-") || lower.startsWith("nn-")) return "no";
    if (lower.startsWith("me") || lower === "sh") return "cnr";
    const base = lower.split("-")[0];
    const hit = LOCALE_CODES.find((c) => c.toLowerCase() === base);
    if (hit) return hit;
  }
  return "en";
}

/** The language used to store content and translations for a UI locale (Cyrillic reuses Latin Serbian). */
export function contentLang(code: string): string {
  return code === "sr-Cyrl" ? "sr" : code;
}

/** Apply script conversion for display (only Serbian Cyrillic needs it). */
export function script(code: string, text: string): string {
  return code === "sr-Cyrl" ? toCyrillic(text) : text;
}

export const EN = {
  "app.name": "Protest Wire",
  "app.tagline": "The world is rising. Watch it, join it, share it.",
  "nav.home": "Home",
  "nav.clips": "Clips",
  "nav.in": "I'm in",
  "nav.map": "Map",
  "nav.wire": "Wire",
  "header.updated": "Updated {time}",
  "header.language": "Language",

  "hero.live": "LIVE",
  "hero.headline": "The streets are *speaking*. The whole world is *listening*.",
  "hero.lede": "Raw videos from the people in the streets. No studios, no spin. From Belgrade to Lima to Kathmandu, one movement, live.",
  "hero.watch": "WATCH LIVE",
  "hero.join": "I'M IN",
  "stat.people": "people in",
  "stat.cities": "cities",
  "stat.countries": "countries",
  "stat.clips": "clips today",
  "stat.live": "live now",

  "minute.title": "The Global Minute",
  "minute.lede": "Every day at {time}, the whole world stands up for one minute. Wherever you are, tap and be counted.",
  "minute.next": "Starts in",
  "minute.now": "IT'S HAPPENING. STAND UP NOW.",
  "minute.joined": "standing right now",
  "minute.cta": "I'M STANDING",

  "in.title": "Count yourself in",
  "in.lede": "No account, no name, no tracking. Just your city on the map and your number in the movement.",
  "in.city": "Your city",
  "in.search": "Search a city…",
  "in.locate_note": "Only the nearest city is used. Your location never leaves your phone.",
  "in.button": "I'M IN",
  "in.done": "You're #{n}.",
  "in.done_city": "{city} is in. Now bring your people.",
  "in.invited": "Someone in {city} brought you here.",
  "in.already": "You're already counted. Now bring someone new.",

  "share.story": "Share to Story",
  "share.copy": "Copy invite link",
  "share.copied": "Link copied",
  "share.share": "Share",
  "share.download": "Save image",
  "share.card_line": "standing with the people in the streets",
  "share.card_cta": "Join me. Count yourself in.",
  "share.invite_text": "I'm in. {city} is standing. Are you? 👊",

  "race.title": "City race",
  "race.lede": "Which city brings the most people? Every invite counts for the city it came from.",
  "race.week": "7 days",
  "race.empty": "No cities yet. Be the first.",

  "map.title": "The world is rising",
  "map.lede": "Every dot is a city in the movement. Every line is someone who brought someone in.",
  "map.legend_clips": "videos",
  "map.legend_people": "people in",
  "map.legend_lines": "solidarity lines",

  "clips.title": "From the streets",
  "clips.lede": "Filmed by the people who were there. Swipe up for the next one.",
  "clips.open": "Open the feed",
  "clips.empty": "No clips yet. Drop the first one.",
  "clips.watch_on": "Watch on {platform}",
  "clips.archived": "Archived copy",
  "clips.angles": "{n} angles",
  "clips.cheer": "Stand with",
  "clips.report": "Report",
  "clips.reported": "Thanks. A moderator will look at it.",
  "clips.community": "Community clip · not independently verified",
  "clips.close": "Close",
  "clips.all": "All",
  "clips.europe": "Europe",
  "clips.near": "Near me",

  "live.title": "Live from the streets",
  "live.lede": "Streams from people on the ground. Tap a channel to switch.",
  "live.viewers": "{n} watching",

  "drop.title": "Drop your clip",
  "drop.lede": "Filmed a protest? Paste the link from TikTok, Instagram, X, YouTube, Bluesky or Mastodon. Your video stays on your account; we just put it in front of the world.",
  "drop.url": "Link to your post",
  "drop.city": "Where was it filmed?",
  "drop.note": "What's happening? (optional)",
  "drop.submit": "SEND IT",
  "drop.sent": "It's in. A moderator checks every clip before it goes live.",
  "drop.bad_url": "That link doesn't look like a post from a supported platform.",
  "drop.tip_faces": "Protect people: avoid faces of those who didn't agree to be filmed.",
  "drop.tip_share": "On Android, install the app and use Share → Protest Wire right from TikTok or Instagram.",
  "drop.tag": "Tag your posts with {tag} and we'll find them.",

  "flag.title": "Raise your flag",
  "flag.lede": "Put the movement on your profile. Your photo is edited on your phone and never uploaded.",
  "flag.pick": "Pick a photo",
  "flag.style": "Style",
  "flag.text": "Your line",
  "flag.default_text": "WE ARE EVERYWHERE",

  "sign.title": "Make a sign",
  "sign.lede": "Say it loud. Make a sign, post it, start a trend.",
  "sign.placeholder": "Write your sign…",
  "sign.default": "WE ARE NOT AFRAID",

  "pulse.title": "The People's Pulse",
  "pulse.lede": "One question, the whole movement answers.",
  "pulse.votes": "votes",
  "pulse.thanks": "Counted. Share the result.",

  "tags.title": "Make it trend",
  "tags.lede": "Post with the tag. Every post pulls more people in.",
  "tags.copy": "Copy",
  "tags.open": "Open on {platform}",

  "wire.title": "The Wire",
  "wire.lede": "Fast, sourced updates from protests everywhere.",
  "wire.all": "All",
  "wire.europe": "Europe",
  "wire.new": "New",
  "wire.sources": "Sources",
  "wire.more": "Load more",
  "wire.empty": "No updates match this filter yet.",
  "wire.all_countries": "All countries",
  "wire.all_cities": "All cities",

  "tag.incident": "Incident",
  "tag.alert": "Alert",
  "tag.turnout": "Turnout",
  "tag.results": "Results",
  "tag.rally": "Rally",
  "tag.official": "Official",

  "time.just_now": "just now",
  "time.min_ago": "{n} min ago",
  "time.h_ago": "{n} h ago",

  "footer.embed": "Every video is an official embed and stays on its platform. We never download or re-host footage.",
  "footer.privacy": "No accounts. No ads. Counts are anonymous and city-level only.",
  "footer.ai": "Updates are written by AI from the linked sources. Always check the source.",
  "footer.demo": "Demo mode: add the keys from the README to go live.",

  "common.loading": "Loading…",
  "common.error": "Something went wrong. Try again.",
  "common.done": "Done",
} as const;

export type Key = keyof typeof EN;
export type Dict = Partial<Record<Key, string>>;

/** Interpolate {vars} in a template. */
export function fill(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Build a translator from the dictionaries along the fallback chain (most specific first). */
export function makeT(lang: string, chain: Dict[]) {
  return (key: Key, vars?: Record<string, string | number>): string => {
    let s: string | undefined;
    for (const d of chain) { s = d[key]; if (s) break; }
    // English fallbacks are never converted to Cyrillic letters.
    return s ? script(lang, fill(s, vars)) : fill(EN[key], vars);
  };
}

/** Rough check that untranslated text is Serbian/Bosnian/Croatian Latin (so Cyrillic conversion makes sense). */
export function looksSerbianLatin(text: string): boolean {
  if (/[čćšžđ]/i.test(text)) return true;
  return (text.match(/\b(je|i|u|na|se|da|za|od|su|sa|kao|što|nije|posle|protiv)\b/gi) ?? []).length >= 2;
}

/** Locale codes whose dictionaries are needed for `lang`, most specific first (English is implicit). */
export function chainFor(lang: string): string[] {
  const out: string[] = [];
  let cur: string | undefined = contentLang(lang);
  while (cur && cur !== "en" && !out.includes(cur)) {
    out.push(cur);
    cur = FALLBACK[cur];
  }
  return out;
}

export function numberFmt(lang: string, n: number): string {
  try { return new Intl.NumberFormat(htmlLang(lang)).format(n); } catch { return String(n); }
}
