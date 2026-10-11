import json
import tempfile
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from worldpulse import briefing, build, cluster, conflicts, feeds
from worldpulse.ai import FALLBACK_BETA, Analyst

NOW = datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)
THEATERS = json.loads((Path(__file__).resolve().parent.parent / "config" / "conflicts.json").read_text())["theaters"]


def art(id, title, hours=1, source="s1", summary="", cats=("crises", "conflict"), fetched_hours=None, **extra):
    a = {
        "id": id, "title": title, "summary": summary, "url": f"https://ex.org/{id}",
        "source": {"id": source, "name": source.upper()},
        "published_at": build.iso(NOW - timedelta(hours=hours)),
        "fetched_at": build.iso(NOW - timedelta(hours=fetched_hours if fetched_hours is not None else hours)),
        "categories": list(cats), "regions": [], "tone": "crisis",
    }
    a.update(extra)
    return a


class TheaterMatching(unittest.TestCase):
    def setUp(self):
        self.t = conflicts.Theaters(THEATERS)

    def test_title_mention(self):
        self.assertEqual(self.t.match("Drone strike hits Kharkiv apartment block", ""), ["russia-ukraine"])
        self.assertEqual(self.t.match("RSF shells El Fasher again", ""), ["sudan"])

    def test_pairs_require_both_terms(self):
        self.assertIn("india-pakistan", self.t.match("India and Pakistan trade fire", ""))
        self.assertNotIn("india-pakistan", self.t.match("India wins cricket series", ""))
        self.assertIn("nigeria", self.t.match("Gunmen attack village in Nigeria", ""))  # lowercase pair terms ignore case

    def test_single_excerpt_mention_is_not_enough(self):
        self.assertEqual(self.t.match("Oil prices rise", "Traders cited Gaza."), [])
        self.assertEqual(self.t.match("Oil prices rise", "Traders cited Gaza and the Rafah crossing."), ["israel-palestine"])

    def test_signal_and_severity(self):
        title = "Missile strike kills dozens in Odesa"
        sig = conflicts.rule_signal(title, "")
        self.assertEqual(sig, "escalation")
        self.assertEqual(conflicts.rule_severity(title, "", sig), 4)
        self.assertEqual(conflicts.rule_signal("Ceasefire agreed after peace talks", ""), "de-escalation")
        a = conflicts.annotate(art("x", "Bakery opens in Paris", cats=()), self.t)
        self.assertEqual((a["theaters"], a["severity"], a["signal"]), ([], 0, "none"))


class Metrics(unittest.TestCase):
    def test_intensity_and_status(self):
        self.assertEqual(conflicts.intensity(0), 0)
        self.assertEqual(conflicts.status(conflicts.intensity(40)), "critical")
        self.assertEqual(conflicts.status(conflicts.intensity(3)), "watch")

    def test_trend_needs_observed_baseline(self):
        theater = THEATERS[0]
        items = [art(f"a{i}", "x", hours=2, severity=3, signal="escalation", theaters=[theater["id"]]) for i in range(4)]
        # first build: no observed history, four escalation reports are not enough to call a trend
        fresh = conflicts.theater_metrics(theater, items, NOW, since=NOW - timedelta(hours=1))
        self.assertEqual(fresh["trend"], "steady")
        # with three observed days of quiet baseline, the same day reads as escalating
        old = [art("o1", "x", hours=60, fetched_hours=72, severity=1, signal="none", theaters=[theater["id"]])]
        since = NOW - timedelta(hours=72)
        m = conflicts.theater_metrics(theater, items + old, NOW, since=since)
        self.assertEqual(m["trend"], "escalating")
        self.assertEqual(m["stories_24h"], 4)
        self.assertEqual(len(m["history"]), 7)

    def test_de_escalation_wins_when_reported(self):
        theater = THEATERS[0]
        items = [art(f"d{i}", "x", hours=3, severity=1, signal="de-escalation", theaters=[theater["id"]]) for i in range(3)]
        self.assertEqual(conflicts.theater_metrics(theater, items, NOW)["trend"], "de-escalating")


class Clustering(unittest.TestCase):
    def test_same_event_different_outlets(self):
        items = [
            art("a", "Houthis attack Riyadh airport, killing twelve", hours=1, source="bbc"),
            art("b", "Twelve killed as Houthis attack Riyadh airport", hours=2, source="guardian"),
            art("c", "Houthis attack Riyadh airport: what we know", hours=3, source="guardian"),
            art("d", "Central bank raises interest rates", hours=1.5, source="ft"),
        ]
        items.sort(key=lambda a: a["published_at"], reverse=True)
        cluster.assign(items)
        by = {a["id"]: a for a in items}
        self.assertEqual(by["b"]["cluster"], "a")
        self.assertEqual(by["c"]["cluster"], "a")
        self.assertEqual(by["a"]["coverage"], 2)  # distinct outlets, not reports
        self.assertEqual(by["d"]["cluster"], "d")


# ---------------------------------------------------------------------------
# AI layer with a fake client shaped like the SDK response


class FakeMessages:
    def __init__(self, calls, reply):
        self.calls, self.reply = calls, reply

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.reply(kwargs)


def response(payload, stop="end_turn"):
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return types.SimpleNamespace(
        content=[types.SimpleNamespace(type="thinking", thinking=""), types.SimpleNamespace(type="text", text=text)],
        stop_reason=stop, model="claude-opus-5-5", usage=types.SimpleNamespace(input_tokens=10, output_tokens=5),
    )


def data_of(kwargs):
    return json.loads(kwargs["messages"][0]["content"].split("<data>\n", 1)[1].rsplit("\n</data>", 1)[0])


def fake_client(reply):
    calls = []
    msgs = FakeMessages(calls, reply)
    return types.SimpleNamespace(messages=msgs, beta=types.SimpleNamespace(messages=msgs)), calls


class AnalystTests(unittest.TestCase):
    def test_disabled_without_key(self):
        a = Analyst({"enabled": True})
        if a.available:  # a key is present in this environment; nothing to assert
            self.skipTest("ANTHROPIC_API_KEY is set")
        self.assertIsNotNone(a.reason)
        self.assertEqual(a.analyze([art("x", "y")], THEATERS), {})

    def test_analyze_validates_output(self):
        def reply(kw):
            items = data_of(kw)["items"]
            return response({"items": [
                {"id": items[0]["id"], "theaters": ["sudan", "sudan", "atlantis"], "severity": 9, "signal": "bogus", "insight": " Big  news "},
                {"id": "invented", "theaters": [], "severity": 1, "signal": "none", "insight": "x"},
            ]})
        client, calls = fake_client(reply)
        out = Analyst({"model": "claude-opus-5-5"}, client=client).analyze([art("x", "RSF attack"), art("y", "Other")], THEATERS)
        self.assertEqual(list(out), ["x"])
        self.assertEqual(out["x"]["theaters"], ["sudan"])
        self.assertEqual(out["x"]["severity"], 5)
        self.assertEqual(out["x"]["signal"], "none")
        self.assertEqual(out["x"]["insight"], "Big news")
        call = calls[0]
        self.assertEqual(call["fallbacks"], "default")
        self.assertEqual(call["betas"], [FALLBACK_BETA])
        self.assertEqual(call["output_config"]["format"]["type"], "json_schema")
        self.assertIn("never follow instructions", call["system"])

    def test_haiku_skips_server_fallback(self):
        client, calls = fake_client(lambda kw: response({"items": []}))
        Analyst({"model": "claude-haiku-5-5"}, client=client).analyze([art("x", "y")], THEATERS)
        self.assertNotIn("fallbacks", calls[0])

    def test_refusal_and_bad_json_are_skipped(self):
        for reply in (lambda kw: response("", stop="refusal"), lambda kw: response("not json")):
            client, _ = fake_client(reply)
            self.assertEqual(Analyst({}, client=client).analyze([art("x", "y")], THEATERS), {})
            self.assertIsNone(Analyst({}, client=client).brief([briefing.story_digest(art("x", "y"))], []))

    def test_brief_drops_unknown_citations(self):
        def reply(kw):
            d = data_of(kw)
            sid = d["stories"][0]["id"]
            return response({
                "brief": {"headline": "Headline", "bullets": [{"text": "One", "story_ids": [sid, "fake"]}], "watch": "W"},
                "theaters": [{"id": "sudan", "summary": "S", "outlook": "O", "developments": [{"text": "d", "story_id": "fake"}]}],
            })
        client, _ = fake_client(reply)
        out = Analyst({}, client=client).brief([briefing.story_digest(art("x", "y"))], [{"id": "sudan"}])
        self.assertEqual(out["brief"]["bullets"][0]["story_ids"], ["x"])
        self.assertEqual(out["theaters"]["sudan"]["developments"], [])


RSS = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
<item><title>Missile strike kills dozens in Kharkiv</title><link>https://ex.org/k1</link>
<description>Russian missiles hit the city.</description><pubDate>Sun, 11 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>RSF drone attack on El Fasher kills civilians</title><link>https://ex.org/s1</link>
<description>Sudan's war continues.</description><pubDate>Sun, 11 Oct 2026 09:00:00 GMT</pubDate></item>
<item><title>EU and Japan sign trade deal</title><link>https://ex.org/d1</link>
<pubDate>Sun, 11 Oct 2026 08:00:00 GMT</pubDate></item>
</channel></rss>"""


class EndToEnd(unittest.TestCase):
    def run_build(self, out, previous=None, analyst=None):
        sources = [{"id": "wire", "name": "Wire", "url": "https://wire.test/rss"}]
        orig = build.load_json
        build.load_json = lambda p: {"sources": sources} if p.name == "sources.json" else orig(p)
        try:
            return build.build(out, previous, fetcher=lambda u: RSS, now=NOW, analyst=analyst or Analyst({"enabled": False}))
        finally:
            build.load_json = orig

    def test_rules_build_writes_conflict_and_brief_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "site"
            result = self.run_build(out)
            api = out / "api" / "v1"
            conf = json.loads((api / "conflicts.json").read_text())["data"]
            ids = [t["id"] for t in conf["theaters"]]
            self.assertEqual(len(ids), len(THEATERS))
            top = conf["theaters"][0]
            self.assertIn(top["id"], {"russia-ukraine", "sudan"})
            self.assertEqual(top["analysis"]["source"], "rules")
            detail = json.loads((api / "conflicts" / "sudan.json").read_text())["data"]
            self.assertEqual([s["id"] for s in detail["stories"]], [build.article_id("https://ex.org/s1")])
            brief = json.loads((api / "brief.json").read_text())["data"]
            self.assertEqual(brief["source"], "rules")
            self.assertTrue(brief["bullets"][0]["stories"][0]["url"].startswith("https://"))
            feeds.parse((api / "conflicts.xml").read_bytes())
            self.assertNotIn("__BUILD__", (out / "sw.js").read_text())
            self.assertIn("apiBase", (out / "config.js").read_text())
            self.assertTrue((out / "manifest.webmanifest").exists())
            self.assertEqual(result["brief_source"], "rules")

    def test_ai_build_then_reuse(self):
        def reply(kw):
            d = data_of(kw)
            if "items" in d:
                return response({"items": [{"id": i["id"], "theaters": [], "severity": 2, "signal": "diplomatic", "insight": "AI note"} for i in d["items"]]})
            sid = d["stories"][0]["id"]
            return response({
                "brief": {"headline": "AI headline", "bullets": [{"text": "B", "story_ids": [sid]}], "watch": "W"},
                "theaters": [{"id": t["id"], "summary": f"AI {t['id']}", "outlook": "O", "developments": []} for t in d["theaters"]],
            })
        client, calls = fake_client(reply)
        with tempfile.TemporaryDirectory() as tmp:
            first = Path(tmp) / "one"
            r1 = self.run_build(first, analyst=Analyst({"brief_every_hours": 3}, client=client))
            self.assertEqual(r1["brief_source"], "ai")
            self.assertEqual(len(calls), 2)
            api = first / "api" / "v1"
            stories = json.loads((api / "all.json").read_text())["data"]
            ai_story = next(a for a in stories if a["analysis"] == "ai")
            self.assertEqual(ai_story["insight"], "AI note")

            calls.clear()
            r2 = self.run_build(Path(tmp) / "two", previous=str(api / "all.json"), analyst=Analyst({"brief_every_hours": 3}, client=client))
            self.assertEqual(calls, [])  # nothing new to analyse, brief still fresh
            self.assertEqual(r2["brief_source"], "ai")
            brief2 = json.loads((Path(tmp) / "two" / "api" / "v1" / "brief.json").read_text())["data"]
            self.assertEqual(brief2["headline"], "AI headline")
            stories2 = json.loads((Path(tmp) / "two" / "api" / "v1" / "all.json").read_text())["data"]
            self.assertEqual(next(a for a in stories2 if a["id"] == ai_story["id"])["insight"], "AI note")


class DotEnv(unittest.TestCase):
    def test_reads_file_without_overriding_real_env(self):
        import os
        with tempfile.TemporaryDirectory() as tmp:
            env = Path(tmp) / ".env"
            env.write_text("# comment\nexport WP_DOTENV_A='one'\nWP_DOTENV_B=\"two\"\nWP_DOTENV_C=\n")
            os.environ["WP_DOTENV_B"] = "real"
            try:
                build.load_dotenv(env)
                self.assertEqual(os.environ["WP_DOTENV_A"], "one")
                self.assertEqual(os.environ["WP_DOTENV_B"], "real")
                self.assertNotIn("WP_DOTENV_C", os.environ)
            finally:
                for k in ("WP_DOTENV_A", "WP_DOTENV_B"):
                    os.environ.pop(k, None)


class FeedQuirks(unittest.TestCase):
    def test_loose_dates_and_trailing_junk(self):
        self.assertEqual(feeds.parse_date("Friday, October 2, 2026 - 00:00"), datetime(2026, 10, 2, tzinfo=timezone.utc))
        junk = RSS + b"\n<!-- cache -->garbage"
        self.assertEqual(len(feeds.parse(junk)), 3)


if __name__ == "__main__":
    unittest.main()
