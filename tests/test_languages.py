import json
import unittest
from pathlib import Path

from worldpulse import build, classify, conflicts
from worldpulse.ai import Analyst
from worldpulse import lang as L

from test_conflicts_ai import art, data_of, fake_client, response

ROOT = Path(__file__).resolve().parent.parent
THEATERS = conflicts.Theaters(json.loads((ROOT / "config" / "conflicts.json").read_text())["theaters"])


class LanguageRules(unittest.TestCase):
    def test_normalize_cyrillic_and_diacritics(self):
        self.assertEqual(L.normalize("Ђоковић Украјина"), "Djokovic Ukrajina")
        self.assertEqual(L.normalize("Grüße aus Köln"), "Grusse aus Koln")

    def test_german_categories_regions_theaters(self):
        t = "Raketenangriff auf Kiew: Mehrere Tote"
        self.assertEqual(classify.categorize(t, "", lang="de"), ["crises", "conflict"])
        self.assertEqual(classify.regions(t, "", "de"), ["europe"])
        self.assertEqual(THEATERS.match(t, "", "de"), ["russia-ukraine"])
        self.assertEqual(conflicts.rule_signal(t, "", "de"), "escalation")

    def test_serbian_cyrillic_and_latin_match_alike(self):
        for t in ("Руска ракета погодила Кијев, погинуло 12 људи", "Ruska raketa pogodila Kijev, poginulo 12 ljudi"):
            self.assertEqual(classify.categorize(t, "", lang="sr"), ["crises", "conflict"])
            self.assertEqual(THEATERS.match(t, "", "sr"), ["russia-ukraine"])
        self.assertEqual(THEATERS.match("Примирје у Гази", "", "sr"), ["israel-palestine"])
        self.assertEqual(conflicts.rule_signal("Primirje u Gazi: Hamas pristao", "", "sr"), "de-escalation")

    def test_off_topic_and_scripts(self):
        self.assertTrue(classify.is_off_topic("Bundesliga: Bayern gewinnt", "", "de"))
        self.assertTrue(classify.is_off_topic("Partizan pobedio u Evroligi", "", "sr"))
        self.assertFalse(classify.is_off_topic("Влада усвојила буџет", "", "sr"))  # Cyrillic is fine for Serbian
        self.assertTrue(classify.is_off_topic("Влада усвојила буџет", ""))  # still dropped for English feeds

    def test_english_unchanged(self):
        self.assertEqual(classify.categorize("Drone strike kills 12 in Kharkiv", ""), ["crises", "conflict"])
        self.assertEqual(classify.categorize("Krieg war schlimm", "", lang="de"), ["crises", "conflict"])
        self.assertNotIn("conflict", classify.categorize("Es war einmal", "", lang="de"))  # German "war" is not war

    def test_normalize_keeps_lang(self):
        from datetime import datetime, timezone
        now = datetime(2026, 10, 1, tzinfo=timezone.utc)
        a = build.normalize({"title": "Poplave u Srbiji", "summary": "", "link": "https://x.rs/a"}, {"id": "x", "name": "X", "lang": "sr"}, now)
        self.assertEqual(a["lang"], "sr")
        self.assertIn("disasters", a["categories"])
        self.assertIn("europe", a["regions"])


def story_reply(kw):
    d = data_of(kw)
    lang = "sr" if "Serbian" in kw["messages"][0]["content"].split("<data>")[0] else "de" if "German" in kw["messages"][0]["content"].split("<data>")[0] else "en"
    t = {"sr": "Превод", "de": "[de] ", "en": "[en] "}[lang]
    f = (lambda x: t if lang == "sr" and x else (t + x if x else ""))
    return response({"items": [{"id": i["id"], "t": f(i["t"]), "s": f(i["s"]), "i": f(i["i"])} for i in d["items"]]})


class StoryTranslation(unittest.TestCase):
    def test_one_call_per_language_cached_and_skips_own_language(self):
        client, calls = fake_client(story_reply)
        analyst = Analyst({"model": "claude-haiku-5-5"}, client=client)
        arts = [art("a", "Strike on Kyiv", insight="Matters."), art("b", "Angriff auf Kiew", lang="de")]
        build.translate_stories(analyst, arts, ["en", "de", "sr"], 40)
        self.assertEqual(len(calls), 3)
        self.assertEqual(arts[0]["title_i18n"], {"de": "[de] Strike on Kyiv", "sr": "Превод"})
        self.assertEqual(arts[0]["insight_i18n"]["de"], "[de] Matters.")
        self.assertEqual(arts[1]["title_i18n"], {"en": "[en] Angriff auf Kiew", "sr": "Превод"})
        build.translate_stories(analyst, arts, ["en", "de", "sr"], 40)
        self.assertEqual(len(calls), 3)  # cached: nothing left to translate
        merged = build.merge(arts, [dict(arts[0], title_i18n=None)], build.from_iso(arts[0]["published_at"]), 7)
        self.assertEqual(merged[0].get("title_i18n", {}).get("de") or merged[1].get("title_i18n", {}).get("de"), "[de] Strike on Kyiv")

    def test_skips_without_ai_or_over_budget(self):
        build.translate_stories(Analyst({"enabled": False}), [art("a", "x")], ["de"], 40)
        client, calls = fake_client(story_reply)
        analyst = Analyst({"model": "claude-haiku-5-5", "budget_usd": 0}, client=client)
        a = art("a", "x")
        build.translate_stories(analyst, [a], ["de"], 40)
        self.assertEqual(calls, [])
        self.assertNotIn("title_i18n", a)

    def test_latin_serbian_rejected(self):
        client, _ = fake_client(lambda kw: response({"items": [{"id": "a", "t": "Napad na Kijev", "s": "", "i": ""}]}))
        out = Analyst({"model": "claude-haiku-5-5"}, client=client).translate_stories("sr", [art("a", "Strike on Kyiv")])
        self.assertEqual(out, {})


class StoryBriefs(unittest.TestCase):
    def test_briefs_per_language_validated_and_cached(self):
        from test_conflicts_ai import NOW

        def reply(kw):
            d = data_of(kw)
            sr = "Serbian" in kw["messages"][0]["content"].split("<data>")[0]
            p = ["Први пасус.", "Други.", "Трећи."] if sr else ["One.", "Two.", "Three 99."]  # 99 is invented
            return response({"items": [{"id": i["id"], "paragraphs": p} for i in d["items"]]})
        client, calls = fake_client(reply)
        analyst = Analyst({"model": "claude-haiku-5-5"}, client=client)
        arts = [art("a", "Strike on Kyiv", theaters=["russia-ukraine"], coverage=3), art("b", "Bakery opens", cats=())]
        build.write_story_briefs(analyst, arts, THEATERS, NOW, ["en", "sr"], 8)
        self.assertEqual(len(calls), 2)
        self.assertEqual(arts[0]["story_brief"], {"sr": ["Први пасус.", "Други.", "Трећи."]})  # en rejected: invented number
        self.assertIn("War between Russia and Ukraine", data_of(calls[0])["items"][0]["context"])
        self.assertNotIn("story_brief", arts[1])
        build.write_story_briefs(analyst, arts, THEATERS, NOW, ["sr"], 8)
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
