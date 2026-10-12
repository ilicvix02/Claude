"""Collection at scale, curated news items, AI news writing and the source finder."""

import json
import sys
import threading
import time
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from worldpulse import build, cluster, curate  # noqa: E402
from worldpulse.ai import Analyst  # noqa: E402
import find_sources  # noqa: E402

NOW = datetime(2026, 10, 12, 12, 0, tzinfo=timezone.utc)
RSS = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
<item><title>Ceasefire talks resume in Doha</title><link>https://a.test/1</link><pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate></item>
</channel></rss>"""


def story(i, title, source, hours=1, lang="en", **kw):
    return {"id": f"id{i}", "title": title, "url": f"https://x.test/{i}", "summary": "", "lang": lang,
            "source": {"id": source, "name": source.upper()}, "published_at": build.iso(NOW - timedelta(hours=hours)),
            "categories": kw.get("categories", ["world"]), "regions": [], "theaters": kw.get("theaters", []),
            "severity": kw.get("severity", 0)}


class Collect(unittest.TestCase):
    def test_per_host_limit_deadline_and_skip(self):
        active, peak, lock = [0], [0], threading.Lock()

        def fetcher(url, timeout=None):
            with lock:
                active[0] += 1
                peak[0] = max(peak[0], active[0])
            time.sleep(0.02)
            with lock:
                active[0] -= 1
            return RSS

        sources = [{"id": f"s{i}", "name": f"S{i}", "url": f"https://one.host/{i}"} for i in range(20)]
        arts, status = build.collect(sources, NOW, fetcher, workers=16, skip={"s3"})
        self.assertLessEqual(peak[0], build.HOST_LIMIT)
        self.assertEqual(sum(s["ok"] for s in status), 19)
        self.assertIn("skipped", next(s for s in status if s["id"] == "s3")["error"])
        _, status = build.collect(sources[:3], NOW, fetcher, deadline_s=-1)
        self.assertTrue(all("deadline" in s["error"] for s in status))

    def test_failing_sources_retried_every_sixth_hour(self):
        prev = [{"id": "a", "ok": False, "fails": 3}, {"id": "b", "ok": False, "fails": 1}, {"id": "c", "ok": True}]
        self.assertEqual(build.failing_sources(prev, NOW.replace(hour=13)), {"a"})
        self.assertEqual(build.failing_sources(prev, NOW.replace(hour=12)), set())

    def test_merge_caps_per_source_and_total(self):
        fresh = [story(i, f"Headline number {i} about things", "a" if i % 2 else "b", hours=i / 10) for i in range(50)]
        out = build.merge([], fresh, NOW, 7, per_source=10, total=15)
        self.assertEqual(len(out), 15)
        self.assertLessEqual(max(sum(1 for a in out if a["source"]["id"] == s) for s in "ab"), 10)


class Cluster(unittest.TestCase):
    def test_index_clusters_matching_headlines_only(self):
        arts = [story(1, "Earthquake strikes northern Chile coast, tsunami warning issued", "a"),
                story(2, "Tsunami warning issued after earthquake strikes northern Chile", "b", hours=2),
                story(3, "Central bank raises interest rates again", "c", hours=3)]
        cluster.assign(arts)
        self.assertEqual(arts[1]["cluster"], "id1")
        self.assertEqual(arts[2]["cluster"], "id3")


class Curate(unittest.TestCase):
    def setUp(self):
        self.meta = {"a": {"country": "us"}, "b": {"country": "de"}, "c": {"country": "fr", "type": "official"}, "d": {"country": "us"}}
        self.arts = [story(1, "Big event A", "a"), story(2, "Big event A", "b"), story(3, "Big event A", "c"),
                     story(4, "Small story", "d", hours=2), story(5, "Old story", "d", hours=80)]
        for a in self.arts[:3]:
            a["cluster"] = "id1"

    def test_rank_select_and_sources(self):
        items = curate.select(self.arts, NOW, self.meta, limit=5)
        self.assertEqual([i["title"] for i in items], ["Big event A", "Small story"])  # old one is out of window
        top = items[0]
        self.assertEqual((top["coverage"], top["countries"], top["official"]), (3, 3, True))
        self.assertEqual(top["id"], curate.event_id(self.arts[:3]))
        self.assertEqual(top["cluster"], top["id"])
        self.assertEqual(len(top["sources"]), 3)

    def test_per_theater_extras(self):
        arts = [story(i, f"Unrelated headline {i} words here", f"s{i}") for i in range(6)]
        arts[5]["theaters"] = ["sudan"]
        items = curate.select(arts, NOW, {}, limit=2, per_theater=1)
        self.assertTrue(any("sudan" in i["theaters"] for i in items))
        self.assertLessEqual(len(items), 3)

    def test_reuse_keeps_ai_text_until_coverage_doubles(self):
        item = curate.select(self.arts, NOW, self.meta, limit=1)[0]
        prev = [{**item, "title": "AI title", "written_by": "ai", "written_coverage": 3, "title_i18n": {"de": "KI-Titel"}}]
        fresh = dict(item)
        curate.reuse([fresh], prev)
        self.assertEqual((fresh["title"], fresh["title_i18n"]["de"]), ("AI title", "KI-Titel"))
        grown = {**item, "coverage": 6}
        curate.reuse([grown], prev)
        self.assertEqual(grown["title"], "Big event A")
        self.assertEqual(curate.needs_writing([fresh, grown], 5), [grown])


class FakeMessages:
    def __init__(self, reply):
        self.reply, self.calls = reply, []

    def create(self, **kw):
        self.calls.append(kw)
        text = json.dumps(self.reply(kw))
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=text)], stop_reason="end_turn",
                                     model="claude-haiku-5-5", usage=types.SimpleNamespace(input_tokens=100, output_tokens=50))


class WriteNews(unittest.TestCase):
    def test_one_call_all_languages_with_validation(self):
        def reply(kw):
            data = json.loads(kw["messages"][0]["content"].split("<data>\n", 1)[1].rsplit("\n</data>", 1)[0])
            out = []
            for e in data["events"]:
                out.append({"id": e["id"], "en": {"t": "Talks resume in Doha", "s": "Delegations met."},
                            "de": {"t": "Gespräche in Doha", "s": "Delegationen trafen sich."},
                            "sr": {"t": "Talks in Doha 999", "s": ""}})  # Latin script and an invented number
            return {"items": out}
        msgs = FakeMessages(reply)
        an = Analyst({"model": "claude-haiku-5-5", "budget_usd": 18}, client=types.SimpleNamespace(messages=msgs))
        items = [{"id": "e1", "summary": "", "sources": [{"name": "A", "title": "Ceasefire talks resume in Doha"}]}]
        got = an.write_news(items, ["en", "de", "sr"])
        self.assertEqual(len(msgs.calls), 1)
        self.assertEqual(set(got["e1"]), {"en", "de"})

    def test_build_publishes_curated_news(self):
        sources = [{"id": "rss", "name": "RSS", "url": "https://rss.test/feed", "lang": "en", "country": "us", "type": "news"}]
        orig = build.load_json
        build.load_json = lambda p: {"sources": sources} if p.name == "sources.json" else orig(p)
        try:
            import tempfile
            with tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp) / "site"
                build.build(out, None, fetcher=lambda u: RSS, now=NOW, analyst=Analyst({"enabled": False}))
                news = json.loads((out / "api" / "v1" / "news.json").read_text())["data"]
                self.assertEqual(news[0]["title"], "Ceasefire talks resume in Doha")
                self.assertEqual(news[0]["sources"][0]["country"], "us")
                self.assertIn("news", json.loads((out / "api" / "v1" / "index.json").read_text())["data"]["endpoints"])
        finally:
            build.load_json = orig


class FindSources(unittest.TestCase):
    def test_verify_keeps_fresh_feeds_only(self):
        orig = find_sources.feeds.fetch
        try:
            find_sources.feeds.fetch = lambda url, timeout=None: RSS
            fresh = find_sources.verify({"url": "https://a.test/f"}, timedelta(days=36500), 5)
            stale = find_sources.verify({"url": "https://a.test/f"}, timedelta(days=0), 5)
            find_sources.feeds.fetch = lambda url, timeout=None: b"<html>no feed</html>"
            junk = find_sources.verify({"url": "https://a.test/f"}, timedelta(days=36500), 5)
        finally:
            find_sources.feeds.fetch = orig
        self.assertIsNotNone(fresh)
        self.assertIsNone(stale)
        self.assertIsNone(junk)

    def test_candidates_are_tagged(self):
        for c in find_sources.curated_candidates() + find_sources.family_candidates():
            self.assertIn(c["type"], ("news", "official"))
            self.assertTrue(c["lang"] and c["country"])

    def test_config_has_1000_tagged_sources(self):
        srcs = json.loads((ROOT / "config" / "sources.json").read_text())["sources"]
        self.assertGreaterEqual(len(srcs), 1000)
        self.assertEqual(len({s["id"] for s in srcs}), len(srcs))
        self.assertTrue(all(s.get("lang") and s.get("country") and s.get("type") for s in srcs))


if __name__ == "__main__":
    unittest.main()
