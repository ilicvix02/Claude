import json
import re
import shutil
import subprocess
import tempfile
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from worldpulse import build, pro
from worldpulse.ai import Analyst

ROOT = Path(__file__).resolve().parent.parent
NOW = datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)
HAVE_CRYPTO = pro.crypto_available()


def test_keys():
    """A throwaway P-256 key pair as JWKs (private, public), like the Worker's."""
    from cryptography.hazmat.primitives.asymmetric import ec

    priv = ec.generate_private_key(ec.SECP256R1())
    n = priv.private_numbers()
    x, y = (pro.b64u(v.to_bytes(32, "big")) for v in (n.public_numbers.x, n.public_numbers.y))
    public = {"kty": "EC", "crv": "P-256", "x": x, "y": y, "kid": "testkid"}
    return priv, {"kty": "EC", "crv": "P-256", "x": x, "y": y, "d": pro.b64u(n.private_value.to_bytes(32, "big"))}, public


def open_bundle(priv, bundle):
    """Do what the Worker (unwrap) and the app (decrypt) do, in Python."""
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    v, bid, epk, iv, ct = bundle["wrapped_key"].split(".")
    epk_raw = pro.unb64u(epk)
    eph = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), epk_raw)
    kek = pro._kek(priv.exchange(ec.ECDH(), eph), epk_raw)
    key = AESGCM(kek).decrypt(pro.unb64u(iv), pro.unb64u(ct), bid.encode())
    return json.loads(AESGCM(key).decrypt(pro.unb64u(bundle["iv"]), pro.unb64u(bundle["ct"]), bundle["id"].encode()))


def theater(tid, level, stories=6, history=None):
    return {"id": tid, "name": tid.title(), "status": "critical" if level >= 75 else "high", "trend": "escalating",
            "intensity": level, "stories_24h": stories, "stories_7d": stories * 3, "severity_24h": 30.0,
            "signals_24h": {"escalation": 3, "de-escalation": 0, "humanitarian": 1, "diplomatic": 0},
            "description": f"The {tid} conflict.", "i18n": {"de": {"name": f"{tid}-de"}},
            "history": history or [{"date": (NOW - timedelta(days=6 - i)).date().isoformat(), "stories": i, "severity": i * 2.0} for i in range(7)]}


ARTICLES = [
    {"id": f"s{i}", "title": f"Story {i}", "summary": "Shelling reported.", "url": f"https://ex.org/{i}", "source": {"name": "Ex"},
     "published_at": (NOW - timedelta(hours=i)).isoformat().replace("+00:00", "Z"), "categories": ["conflict"],
     "theaters": ["alpha" if i % 2 else "beta"], "severity": 3, "signal": "escalation", "coverage": 2}
    for i in range(8)
]
STATS = [theater("alpha", 80), theater("beta", 55)]
slim = lambda a: {"id": a["id"], "title": a["title"], "url": a["url"]}  # noqa: E731


class FakeMessages:
    def __init__(self, reply):
        self.calls, self.reply = [], reply

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.reply(kwargs)


def response(payload):
    return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(payload))], stop_reason="end_turn",
                                 model="test-model", usage=types.SimpleNamespace(input_tokens=1000, output_tokens=500))


def pro_reply(kw):
    data = json.loads(kw["messages"][0]["content"].split("<data>\n", 1)[1].rsplit("\n</data>", 1)[0])
    if "hotspots" in data:  # a translation
        return response({"hotspots": [{"id": h["id"], **{f: f"[de] {h[f]}" if h[f] else "" for f in ("changed", "why", "risk_reason", "watch")}}
                                      for h in data["hotspots"]]})
    ids = [s["id"] for s in data["stories"]]
    return response({"hotspots": [
        {"id": "alpha", "changed": "Fighting spread to the north.", "why": "Supply routes are at stake.", "actors": ["Army", "Militia", "Army"],
         "risk_level": "high", "risk_reason": "Both sides are reinforcing.", "watch": "Talks on Friday.", "story_ids": ids[:2] + ["bogus"]},
        {"id": "nope", "changed": "x", "why": "", "actors": [], "risk_level": "low", "risk_reason": "", "watch": "", "story_ids": []},
    ]})


def analyst(reply=pro_reply, **cfg):
    msgs = FakeMessages(reply)
    client = types.SimpleNamespace(messages=msgs, beta=types.SimpleNamespace(messages=msgs))
    a = Analyst({"budget_usd": 5, **cfg}, client=client)
    a.model = "claude-haiku-test"  # takes the plain create() path
    return a, msgs


@unittest.skipUnless(HAVE_CRYPTO, "pip install -r requirements-pro.txt")
class Bundle(unittest.TestCase):
    def setUp(self):
        self.priv, self.priv_jwk, self.jwk = test_keys()

    def run_pro(self, ai=None, prev_state=None, prev_bundle=None, now=NOW, api="https://pro.example.workers.dev"):
        return pro.build_pro({"api_url": api}, ARTICLES, STATS, now, ai, ["de"], prev_state, prev_bundle, slim, jwk=self.jwk)

    def test_encrypts_with_a_fresh_key_and_opens_with_the_worker_key(self):
        bundle, state, index = self.run_pro()
        self.assertEqual(set(bundle), {"v", "id", "alg", "kid", "wrapped_key", "iv", "ct", "generated_at"})
        self.assertEqual(len(pro.unb64u(bundle["iv"])), 12)
        content = open_bundle(self.priv, bundle)
        self.assertEqual(content["briefing"]["source"], "rules")
        self.assertEqual([h["id"] for h in content["briefing"]["hotspots"]], ["alpha", "beta"])
        self.assertEqual(content["trends"]["theaters"][0]["days_observed"], 7)
        self.assertNotIn("Fighting", json.dumps(bundle))
        self.assertTrue(index["enabled"])
        self.assertEqual(index["features"], ["briefing", "trends", "alerts", "watchlist", "no_nudges", "export"])
        # a different bundle id or tampering breaks decryption
        other, _, _ = self.run_pro()
        self.assertNotEqual(other["wrapped_key"], bundle["wrapped_key"])
        with self.assertRaises(Exception):
            open_bundle(self.priv, {**bundle, "id": other["id"]})

    def test_ai_briefing_validated_translated_and_budgeted(self):
        ai, msgs = analyst()
        bundle, state, _ = self.run_pro(ai)
        b = open_bundle(self.priv, bundle)["briefing"]
        self.assertEqual(b["source"], "ai")
        self.assertEqual(len(msgs.calls), 2)  # one briefing + one translation
        h = b["hotspots"]
        self.assertEqual([x["id"] for x in h], ["alpha"])  # unknown theater dropped
        self.assertEqual(h[0]["actors"], ["Army", "Militia"])
        self.assertNotIn("bogus", h[0]["story_ids"])
        self.assertEqual(h[0]["risk"], {"level": "high", "reason": "Both sides are reinforcing."})
        self.assertEqual(b["i18n"]["de"]["alpha"]["changed"], "[de] Fighting spread to the north.")
        self.assertIn("not predictions", b["disclaimer"])
        self.assertEqual(state["bundle"]["source"], "ai")

        # budget stop: an exhausted budget means no call and the rule-based briefing
        ai2, msgs2 = analyst()
        ai2.spent = 5
        bundle2, _, _ = self.run_pro(ai2)
        self.assertEqual(msgs2.calls, [])
        self.assertEqual(open_bundle(self.priv, bundle2)["briefing"]["source"], "rules")

    def test_carry_forward_for_24h_then_new_key(self):
        ai, msgs = analyst()
        bundle, state, _ = self.run_pro(ai)
        ai2, msgs2 = analyst()
        again, state2, _ = self.run_pro(ai2, state, bundle, now=NOW + timedelta(hours=23))
        self.assertIs(again, bundle)
        self.assertEqual(msgs2.calls, [])
        self.assertEqual(state2["bundle"], state["bundle"])
        fresh, state3, _ = self.run_pro(ai2, state2, again, now=NOW + timedelta(hours=25))
        self.assertNotEqual(fresh["id"], bundle["id"])
        self.assertNotEqual(fresh["wrapped_key"], bundle["wrapped_key"])
        # a new server key also forces a new bundle
        _, _, other = test_keys()
        rekeyed, _, _ = pro.build_pro({"api_url": "https://x.example"}, ARTICLES, STATS, NOW + timedelta(hours=1), None, [], state, bundle, slim,
                                      jwk={**other, "kid": "newkid"})
        self.assertNotEqual(rekeyed["id"], bundle["id"])

    def test_history_is_carried_and_capped_at_90_days(self):
        old = {"alpha": [[(NOW - timedelta(days=d)).date().isoformat(), 1, 1.0] for d in range(200, 6, -1)]}
        h = pro.update_history(old, STATS, NOW)
        self.assertEqual(len(h["alpha"]), 90)
        self.assertEqual(h["alpha"][-1], [NOW.date().isoformat(), 6, 12.0])
        t = pro.trends(h, STATS)["theaters"]
        alpha = next(x for x in t if x["id"] == "alpha")
        self.assertEqual(len(alpha["series_30"]), 30)
        self.assertEqual(alpha["peak_90"]["date"], NOW.date().isoformat())
        self.assertIsNotNone(alpha["change_30d_pct"])

    def test_dormant_without_api_url_or_public_key(self):
        bundle, state, index = pro.build_pro({"api_url": ""}, ARTICLES, STATS, NOW, None, [], None, None, slim)
        self.assertIsNone(bundle)
        self.assertFalse(index["enabled"])
        self.assertIn("alpha", state["history"])  # trends keep accumulating while dormant
        bundle, _, index = pro.build_pro({"api_url": "https://down.example"}, ARTICLES, STATS, NOW, None, [], None, None, slim, fetch=lambda u: None)
        self.assertIsNone(bundle)
        self.assertEqual(index, {"enabled": False, "api_url": "https://down.example", "bundle": None, "generated_at": None,
                                 "features": pro.FEATURES})

    @unittest.skipUnless(shutil.which("node") and (ROOT / "node_modules" / "playwright").exists(), "needs node and playwright")
    def test_browser_webcrypto_unlocks_and_decrypts(self):
        bundle, _, _ = self.run_pro()
        with tempfile.TemporaryDirectory() as tmp:
            bpath, kpath = Path(tmp) / "bundle.json", Path(tmp) / "key.json"
            bpath.write_text(json.dumps({"meta": {}, "data": bundle}))
            kpath.write_text(json.dumps(self.priv_jwk))
            out = subprocess.run(["node", str(ROOT / "worker" / "scripts" / "browser_unlock.mjs"), str(bpath), str(kpath)],
                                 capture_output=True, text=True, timeout=120)
        self.assertEqual(out.returncode, 0, out.stderr[-2000:])
        result = json.loads(out.stdout.strip().splitlines()[-1])
        self.assertEqual(result["good"]["status"], 200)
        self.assertEqual(result["good"]["content"]["briefing"]["hotspots"][0]["id"], "alpha")
        self.assertTrue(result["good"]["topic"].startswith("wp-pro-"))
        self.assertEqual(result["bad"]["status"], 403)


class BuildIntegration(unittest.TestCase):
    def test_index_reports_pro_dormant_and_writes_public_state(self):
        sources = [{"id": "rss", "name": "RSS", "url": "https://rss.test/feed"}]
        rss = (ROOT / "tests" / "test_worldpulse.py").read_text()
        feed = re.search(r'RSS = b"""(.*?)"""', rss, re.S).group(1).encode()
        orig = build.load_json
        build.load_json = lambda p: {"sources": sources} if p.name == "sources.json" else orig(p)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp) / "site"
                build.build(out, None, fetcher=lambda u: feed, now=NOW, analyst=Analyst({"enabled": False}))
                api = out / "api" / "v1"
                index = json.loads((api / "index.json").read_text())["data"]
                self.assertFalse(index["pro"]["enabled"])
                self.assertIn("briefing", index["pro"]["features"])
                self.assertFalse((api / "pro" / "bundle.json").exists())
                self.assertIn("history", json.loads((api / "pro" / "state.json").read_text())["data"])
        finally:
            build.load_json = orig


class NoSecrets(unittest.TestCase):
    def test_no_key_material_or_unlock_code_in_the_repo(self):
        files = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=ROOT, capture_output=True, text=True).stdout.split()
        pem = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")
        jwk_d = re.compile(r'"d"\s*:\s*"[A-Za-z0-9_-]{40,}"')
        live_key = re.compile(r"\bWP(?:-[0-9A-HJKMNP-TV-Z]{4}){7}\b")
        fixtures = {"WP-ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345", "WP-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ"}  # the browser test's
        for name in files:
            path = ROOT / name
            if not path.is_file() or path.suffix in {".woff2", ".png", ".jpg", ".mp3", ".mp4", ".ico", ".webp"} or "node_modules" in name:
                continue
            text = path.read_text(errors="ignore")
            self.assertIsNone(pem.search(text), name)
            self.assertIsNone(jwk_d.search(text), name)
            self.assertEqual([k for k in live_key.findall(text) if k not in fixtures], [], name)
            self.assertNotRegex(text, r"(?i)unlock[_ ]?code\s*[:=]\s*['\"][^'\"]+", name)


if __name__ == "__main__":
    unittest.main()
