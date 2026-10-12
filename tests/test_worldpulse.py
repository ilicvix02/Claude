import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from worldpulse import build, classify, feeds
from worldpulse.ai import Analyst

NOW = datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)

RSS = b"""<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>T</title>
<item><title>EU and Japan sign landmark trade deal</title><link>https://ex.org/a?utm_source=rss</link>
<description>&lt;p&gt;The agreement cuts tariffs.&lt;/p&gt;</description><pubDate>Sun, 11 Oct 2026 10:00:00 GMT</pubDate>
<media:thumbnail url="https://ex.org/a.jpg"/></item>
<item><title>Earthquake kills dozens in Turkey</title><link>https://ex.org/b</link>
<description>Rescue teams search rubble.</description><pubDate>Sun, 11 Oct 2026 11:00:00 GMT</pubDate></item>
<item><title>Striker scores hat-trick in Premier League thriller</title><link>https://ex.org/sport</link>
<pubDate>Sun, 11 Oct 2026 11:30:00 GMT</pubDate></item>
<item><title>No link item</title></item>
</channel></rss>"""

ATOM = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
<entry><title>WHO declares cholera outbreak emergency in Sudan</title>
<link rel="alternate" href="https://ex.org/c"/><updated>2026-10-11T09:00:00Z</updated>
<summary>Thousands of cases reported.</summary></entry></feed>"""

RDF = b"""<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"
 xmlns:dc="http://purl.org/dc/elements/1.1/">
<item><title>Germany agrees investment pact with India</title><link>https://ex.org/d</link>
<description>Partnership on chips.</description><dc:date>2026-10-11T08:00:00Z</dc:date></item></rdf:RDF>"""


class FeedParsing(unittest.TestCase):
    def test_rss(self):
        items = feeds.parse(RSS)
        self.assertEqual(len(items), 3)  # item without link dropped
        self.assertEqual(items[0]["summary"], "The agreement cuts tariffs.")
        self.assertEqual(items[0]["image"], "https://ex.org/a.jpg")
        self.assertEqual(items[0]["published"], datetime(2026, 10, 11, 10, tzinfo=timezone.utc))

    def test_atom_and_rdf(self):
        self.assertEqual(feeds.parse(ATOM)[0]["link"], "https://ex.org/c")
        rdf = feeds.parse(RDF)[0]
        self.assertEqual(rdf["title"], "Germany agrees investment pact with India")
        self.assertEqual(rdf["published"].hour, 8)

    def test_clean_text_truncates(self):
        self.assertTrue(feeds.clean_text("word " * 200, 50).endswith("…"))


class Classification(unittest.TestCase):
    def test_deal(self):
        cats = classify.categorize("EU and Japan sign landmark trade deal", "The agreement cuts tariffs.")
        self.assertIn("deals", cats)
        self.assertIn("economy", cats)
        self.assertEqual(classify.sentiment(cats), "deal")

    def test_crisis(self):
        cats = classify.categorize("Earthquake kills dozens in Turkey", "")
        self.assertEqual(cats[:2], ["crises", "disasters"])
        self.assertEqual(classify.regions("Earthquake kills dozens in Turkey", ""), ["middle-east"])

    def test_acronyms_are_case_sensitive(self):
        self.assertNotIn("health", classify.categorize("Who will win?", "People who voted"))
        self.assertIn("health", classify.categorize("WHO warns on outbreak", ""))

    def test_region_names_case_sensitive(self):
        self.assertEqual(classify.regions("Talks with us", "chad said"), [])
        self.assertIn("americas", classify.regions("US imposes tariffs", ""))

    def test_off_topic(self):
        self.assertTrue(classify.is_off_topic("Striker scores in Premier League", ""))
        self.assertFalse(classify.is_off_topic("Ceasefire agreed in Gaza", ""))


class Build(unittest.TestCase):
    def fetcher(self, url):
        return {"rss": RSS, "atom": ATOM, "rdf": RDF}.get(url.split("//")[1].split(".")[0], RSS)

    def test_merge_dedupes_and_expires(self):
        old = {"id": "x", "title": "Old", "url": "u", "published_at": build.iso(NOW - timedelta(days=30))}
        keep = {"id": "y", "title": "Same Title!", "url": "u", "published_at": build.iso(NOW - timedelta(hours=2))}
        dup = {"id": "z", "title": "same title", "url": "u2", "published_at": build.iso(NOW - timedelta(hours=3))}
        merged = build.merge([old, keep], [dup], NOW, 7)
        self.assertEqual([a["id"] for a in merged], ["y"])

    def test_canonical_url_strips_tracking(self):
        self.assertEqual(build.canonical_url("https://Ex.org/a?utm_source=x&id=2#top"), "https://ex.org/a?id=2")

    def test_tension(self):
        self.assertEqual(build.tension(0, 0), 50)
        self.assertEqual(build.tension(3, 1), 75)
        self.assertEqual(build.mood(80), "Crisis-dominated")

    def test_full_build(self):
        sources = [{"id": s, "name": s.upper(), "url": f"https://{s}.test/feed"} for s in ("rss", "atom", "rdf", "broken")]

        def fetcher(url):
            if "broken" in url:
                raise OSError("down")
            return self.fetcher(url)

        orig = build.load_json
        build.load_json = lambda p: {"sources": sources} if p.name == "sources.json" else orig(p)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp) / "site"
                result = build.build(out, None, fetcher=fetcher, now=NOW, analyst=Analyst({"enabled": False}))
                api = out / "api" / "v1"
                latest = json.loads((api / "latest.json").read_text())
                state = json.loads((api / "state.json").read_text())["data"]
                srcs = json.loads((api / "sources.json").read_text())["data"]
                deals = json.loads((api / "categories" / "deals.json").read_text())["data"]
                self.assertTrue((out / "index.html").exists())
                self.assertTrue((out / "feed.xml").read_text().startswith("<?xml"))
                feeds.parse((api / "categories" / "crises.xml").read_bytes())  # valid RSS
                json.loads((api / "openapi.json").read_text())

                # duplicate titles from the RSS fixture served by 'broken'-free sources collapse to one copy
                titles = [a["title"] for a in latest["data"]]
                self.assertEqual(len(titles), len(set(titles)))
                self.assertNotIn("Striker scores hat-trick in Premier League thriller", titles)
                self.assertEqual(result["sources_ok"], 3)
                self.assertFalse(next(s for s in srcs if s["id"] == "broken")["ok"])
                self.assertIn("Germany agrees investment pact with India", [a["title"] for a in deals])
                self.assertEqual(len(state["history"]), 7)
                self.assertEqual(latest["data"][0]["url"].count("utm_"), 0)

                # second build merges the previous archive
                result2 = build.build(Path(tmp) / "site2", str(api / "all.json"), fetcher=lambda u: RSS, now=NOW, analyst=Analyst({"enabled": False}))
                self.assertEqual(result2["articles"], result["articles"])
        finally:
            build.load_json = orig

    def test_refuses_empty_site(self):
        orig = build.load_json
        build.load_json = lambda p: {"sources": []} if p.name == "sources.json" else orig(p)
        try:
            with tempfile.TemporaryDirectory() as tmp, self.assertRaises(SystemExit):
                build.build(Path(tmp) / "out", None, fetcher=lambda u: b"", now=NOW, analyst=Analyst({"enabled": False}))
        finally:
            build.load_json = orig


class TestRevenue(unittest.TestCase):
    CONFIG = {**json.loads((build.ROOT / "config" / "site.json").read_text())["revenue"], "kofi": "", "advertise_email": ""}
    IDS = [p["id"] for p in CONFIG["plans"]]

    def test_hidden_until_configured(self):
        r = build.resolve_revenue(self.CONFIG, env={})
        self.assertEqual((r["plans"], r["donate"], r["kofi_url"]), ([], [], None))
        self.assertIsNone(r["social"]["tiktok"])

    def test_pricing_lists_every_plan_without_a_checkout(self):
        r = build.resolve_revenue(self.CONFIG, env={})
        self.assertEqual([p["id"] for p in r["pricing"]], self.IDS)
        first = r["pricing"][0]
        self.assertEqual(set(first), {"id", "name", "price", "period", "i18n"})
        self.assertEqual((first["name"], first["price"]), (self.CONFIG["plans"][0]["name"], self.CONFIG["plans"][0]["price"]))

    def test_plan_translations_pass_through_cleaned(self):
        plans = [{**self.CONFIG["plans"][0], "i18n": {
            "de": {"name": " Pro ", "blurb": "Unabhängig bleiben.", "features": ["Werbefrei", 3, ""], "cta": "Pro holen", "url": "javascript:x"},
            "sr": {"name": "Про", "features": "not a list"},
            "<b>": {"name": "x"}, "fr": "not an object",
        }}]
        r = build.resolve_revenue({**self.CONFIG, "plans": plans}, env={"WORLDPULSE_KOFI": "worldpulse"})
        want = {"de": {"name": "Pro", "blurb": "Unabhängig bleiben.", "cta": "Pro holen", "features": ["Werbefrei"]}, "sr": {"name": "Про"}}
        self.assertEqual(r["plans"][0]["i18n"], want)
        self.assertEqual(r["pricing"][0]["i18n"], want)

    def test_kofi_page_turns_on_plans_and_tips(self):
        r = build.resolve_revenue(self.CONFIG, env={"WORLDPULSE_KOFI": " https://ko-fi.com/worldpulse/ "})
        self.assertEqual({p["id"]: p["url"] for p in r["plans"]}, {i: "https://ko-fi.com/worldpulse/tiers" for i in self.IDS})
        self.assertIn({"label": "Ko-fi", "url": "https://ko-fi.com/worldpulse"}, r["donate"])
        self.assertNotIn("kofi", r["plans"][0])  # config-only keys stay out of the API
        self.assertEqual(r["plans"][0]["i18n"], {})

    def test_email_is_a_checkout_fallback(self):
        plans = [{"id": "x", "name": "X", "price": "$1", "period": "month", "email_subject": "World Pulse X"}]
        r = build.resolve_revenue({**self.CONFIG, "plans": plans}, env={"WORLDPULSE_CONTACT_EMAIL": "ads@example.org"})
        self.assertEqual(r["plans"][0]["url"], "mailto:ads@example.org?subject=World%20Pulse%20X")
        self.assertEqual(r["advertise_email"], "ads@example.org")
        self.assertEqual(build.resolve_revenue({**self.CONFIG, "plans": plans}, env={"WORLDPULSE_CONTACT_EMAIL": "x@y"})["plans"], [])

    def test_rejects_unsafe_values(self):
        r = build.resolve_revenue(self.CONFIG, env={
            "WORLDPULSE_KOFI": "a b/../c", "WORLDPULSE_NEWSLETTER_URL": "ftp://x.org", "WORLDPULSE_CONTACT_EMAIL": 'a@b.co"><x',
        })
        self.assertEqual((r["kofi_url"], r["newsletter_url"], r["advertise_email"]), (None, None, None))

    def test_no_sponsor_anywhere(self):
        r = build.resolve_revenue(self.CONFIG, env={"WORLDPULSE_SPONSOR_TEXT": "Acme VPN", "WORLDPULSE_SPONSOR_URL": "https://acme.example",
                                                    "WORLDPULSE_TIKTOK": "https://www.tiktok.com/@world.pulse?lang=en"})
        self.assertEqual(r["social"]["tiktok"], "https://www.tiktok.com/@world.pulse")
        self.assertNotIn("sponsor", r)
        self.assertNotIn("sponsor", build.meta({"revenue": r}, NOW, ""))
        self.assertNotIn("sponsor", self.IDS)
        self.assertNotIn("sponsor", self.CONFIG)


class Localization(unittest.TestCase):
    THEATERS = json.loads((build.ROOT / "config" / "conflicts.json").read_text())["theaters"]

    def test_every_theater_has_german_and_serbian(self):
        for t in self.THEATERS:
            for lang in ("de", "sr"):
                entry = t["i18n"][lang]
                self.assertTrue(entry["name"] and entry["description"], (t["id"], lang))
                self.assertEqual("–" in t["name"], "–" in entry["name"], (t["id"], lang))  # en dashes kept
            sr = t["i18n"]["sr"]["name"] + t["i18n"]["sr"]["description"]
            self.assertNotRegex(sr, r"[A-Za-z]", t["id"])  # Cyrillic; the app makes the Latin script itself

    def test_mood_keys(self):
        self.assertEqual([build.mood_key(i) for i in (80, 60, 50, 30, 10)],
                         ["crisis_dominated", "tense", "balanced", "constructive", "dealmaking_dominated"])
        self.assertEqual(build.mood(60), "Tense")


if __name__ == "__main__":
    unittest.main()
