import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { EN, LOCALES, chainFor, makeT, matchLocale, looksSerbianLatin } from "../lib/i18n.ts";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("every locale file exists and has every key with the same placeholders", () => {
  const files = readdirSync("locales").map((f) => f.replace(/\.json$/, ""));
  for (const l of LOCALES) {
    if (l.code === "en" || l.code === "sr-Cyrl") continue;
    assert.ok(files.includes(l.code), `missing locales/${l.code}.json`);
    const dict = JSON.parse(readFileSync(`locales/${l.code}.json`, "utf8")) as Record<string, string>;
    for (const [key, en] of Object.entries(EN)) {
      if (key === "app.name") continue;
      assert.ok(dict[key], `${l.code}: missing ${key}`);
      assert.equal(placeholders(dict[key]), placeholders(en), `${l.code}: placeholders differ in ${key}`);
    }
    for (const key of Object.keys(dict)) assert.ok(key in EN, `${l.code}: unknown key ${key}`);
    assert.equal((dict["hero.headline"].match(/\*/g) ?? []).length % 2, 0, `${l.code}: unbalanced *highlights*`);
  }
});

test("Serbian Cyrillic is generated from Serbian Latin; English fallbacks stay Latin", () => {
  const sr = JSON.parse(readFileSync("locales/sr.json", "utf8"));
  const t = makeT("sr-Cyrl", [sr]);
  assert.equal(t("nav.map"), "Мапа");
  assert.equal(t("hero.join"), "ТУ САМ");
  const tMissing = makeT("sr-Cyrl", [{}]);
  assert.equal(tMissing("nav.map"), "Map");
  assert.deepEqual(chainFor("sr-Cyrl"), ["sr"]);
  assert.deepEqual(chainFor("cnr"), ["cnr", "bs"]);
});

test("language detection", () => {
  assert.equal(matchLocale(["sr-RS"]), "sr");
  assert.equal(matchLocale(["sr-Cyrl-RS"]), "sr-Cyrl");
  assert.equal(matchLocale(["nb-NO", "en"]), "no");
  assert.equal(matchLocale(["de-AT"]), "de");
  assert.equal(matchLocale(["ja-JP", "fr-FR"]), "fr");
  assert.equal(matchLocale(["ja-JP"]), "en");
  assert.equal(looksSerbianLatin("Studenti su blokirali most u Novom Sadu"), true);
  assert.equal(looksSerbianLatin("Students block the bridge"), false);
});
