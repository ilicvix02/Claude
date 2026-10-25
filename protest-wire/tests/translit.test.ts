import { test } from "node:test";
import assert from "node:assert/strict";
import { toCyrillic, toLatin } from "../lib/translit.ts";

test("Latin to Cyrillic with digraphs", () => {
  assert.equal(toCyrillic("Ljubljana i Njegoš, džep"), "Љубљана и Његош, џеп");
  assert.equal(toCyrillic("LJUBAV NJIVA DŽEM"), "ЉУБАВ ЊИВА ЏЕМ");
  assert.equal(toCyrillic("Đorđe, ćevapi, šuma, žena, čaša"), "Ђорђе, ћевапи, шума, жена, чаша");
  assert.equal(toCyrillic("Studenti u blokadi, Novi Sad!"), "Студенти у блокади, Нови Сад!");
});

test("words with w, q, x or y stay as they are; URLs, handles and hashtags too", () => {
  assert.equal(toCyrillic("Gledaj na YouTube-u i X-u"), "Гледај на YouTube-u и X-u");
  assert.equal(toCyrillic("Protest Wire"), "Протест Wire");
  assert.equal(toCyrillic("vidi https://n1info.rs/vesti @studenti #protest"), "види https://n1info.rs/vesti @studenti #protest");
});

test("prefix exceptions keep two letters", () => {
  assert.equal(toCyrillic("injekcija"), "инјекција");
  assert.equal(toCyrillic("nadživeti"), "надживети");
  assert.equal(toCyrillic("konjunkcija"), "конјункција");
});

test("Cyrillic to Latin round trip", () => {
  assert.equal(toLatin("Љубав и Његош у Београду"), "Ljubav i Njegoš u Beogradu");
  assert.equal(toLatin("ЉУБАВ"), "LJUBAV");
  for (const s of ["Студенти траже правду", "Џеп пун ђинђува"]) assert.equal(toCyrillic(toLatin(s)), s);
});
