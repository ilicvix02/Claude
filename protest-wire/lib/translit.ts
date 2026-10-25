// Serbian Latin <-> Cyrillic transliteration.
// Content is stored in English and Serbian Latin; Cyrillic is generated with toCyrillic().

const LAT_TO_CYR: Record<string, string> = {
  a: "а", b: "б", c: "ц", "č": "ч", "ć": "ћ", d: "д", "đ": "ђ", e: "е", f: "ф", g: "г",
  h: "х", i: "и", j: "ј", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", r: "р",
  s: "с", "š": "ш", t: "т", u: "у", v: "в", z: "з", "ž": "ж",
};

// Words where the letter pair is two sounds, not one digraph (in-jekcija, nad-živeti).
const SPLIT_PREFIXES: Array<[RegExp, number]> = [
  [/^injekc/i, 2], [/^konjug/i, 3], [/^konjunk/i, 3], [/^injunk/i, 2],
  [/^nadžive/i, 3], [/^nadžnje/i, 3], [/^podžanr/i, 3], [/^podžupan/i, 3], [/^nadžup/i, 3],
];

const FOREIGN = /[wqxyWQXY]/;
// Tokens that must never be transliterated: URLs, e-mails, @handles and #hashtags.
const PROTECTED = /^(?:https?:\/\/|www\.|[@#])|@.+\./;

function upperLike(src: string, out: string): string {
  return src === src.toUpperCase() && src !== src.toLowerCase() ? out.toUpperCase() : out;
}

function convertWord(word: string): string {
  if (FOREIGN.test(word) || PROTECTED.test(word)) return word;
  let splitAt = -1;
  for (const [re, idx] of SPLIT_PREFIXES) {
    if (re.test(word)) { splitAt = idx; break; }
  }
  let out = "";
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    const next = word[i + 1] ?? "";
    const pair = (ch + next).toLowerCase();
    if (i !== splitAt - 1 && (pair === "lj" || pair === "nj" || pair === "dž")) {
      const cyr = pair === "lj" ? "љ" : pair === "nj" ? "њ" : "џ";
      // "Lj" (title case) and "LJ" (all caps) both map to the capital letter.
      out += ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? cyr.toUpperCase() : cyr;
      i++;
      continue;
    }
    const lower = ch.toLowerCase();
    const mapped = LAT_TO_CYR[lower];
    out += mapped ? upperLike(ch, mapped) : ch;
  }
  return out;
}

/** Serbian Latin -> Cyrillic. Words containing w, q, x or y (foreign words, brands) stay as they are. */
export function toCyrillic(text: string): string {
  if (!text) return text;
  // Split on whitespace but keep it, so spacing and line breaks survive.
  return text
    .split(/(\s+)/)
    .map((token) => (/^\s+$/.test(token) ? token : convertToken(token)))
    .join("");
}

function convertToken(token: string): string {
  if (PROTECTED.test(token)) return token;
  // Convert letter runs separately so punctuation such as "(Novi" or "Sad," is handled.
  return token.replace(/[A-Za-zČčĆćĐđŠšŽžWwQqXxYy]+/g, (w) => (FOREIGN.test(token) ? w : convertWord(w)));
}

const CYR_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "đ", е: "e", ж: "ž", з: "z", и: "i", ј: "j",
  к: "k", л: "l", љ: "lj", м: "m", н: "n", њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t",
  ћ: "ć", у: "u", ф: "f", х: "h", ц: "c", ч: "č", џ: "dž", ш: "š",
};

/** Serbian Cyrillic -> Latin (used to normalise Cyrillic sources before keyword matching). */
export function toLatin(text: string): string {
  if (!text) return text;
  let out = "";
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const lower = ch.toLowerCase();
    const mapped = CYR_TO_LAT[lower];
    if (!mapped) { out += ch; continue; }
    if (ch === lower) { out += mapped; continue; }
    // Capital digraph: "Љубав" -> "Ljubav", "ЉУБАВ" -> "LJUBAV".
    const nextCh = chars[i + 1] ?? "";
    const nextIsUpper = nextCh !== "" && nextCh === nextCh.toUpperCase() && nextCh !== nextCh.toLowerCase();
    out += mapped.length > 1 && !nextIsUpper ? mapped[0].toUpperCase() + mapped.slice(1) : mapped.toUpperCase();
  }
  return out;
}
