"""World Pulse Pro: the premium bundle, published encrypted so only valid licenses can open it.

Each build that refreshes the bundle draws a fresh random AES-256-GCM content key K, encrypts the
bundle JSON with it and wraps K to the license server's P-256 public key (GET <api_url>/pubkey):

    ephemeral P-256 key pair (e, E); Z = ECDH(e, server public key)
    KEK = HKDF-SHA256(Z, salt = E as a 65-byte uncompressed point, info = "worldpulse-pro-wrap-v1")
    wrapped_key = "v1.<bundle id>.<E>.<iv>.<AES-256-GCM(KEK, iv, K, aad = bundle id)>"  (base64url)
    ct = AES-256-GCM(K, 12-byte random iv, bundle JSON, aad = bundle id)

Only the Worker holds the private key, so no secret is needed in GitHub: the app sends wrapped_key
with a license key to POST /unlock, gets K back if the license is valid, and decrypts locally.

The bundle is rebuilt at most once a day. CI can't decrypt old bundles, so the previous ciphertext
and wrapped key are carried forward as they are, and only non-premium bookkeeping (when the bundle
was made, and a compact per-theater daily history for the trends) is kept public in pro/state.json.
Without an api_url, a reachable /pubkey or the "cryptography" package, Pro is dormant: no bundle,
and the rest of the site builds as usual.
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

from . import briefing
from .conflicts import intensity

WRAP_INFO = b"worldpulse-pro-wrap-v1"
ALG = "ECDH-ES+HKDF-SHA256+A256GCM/A256GCM"
FEATURES = ["briefing", "trends", "alerts", "watchlist", "no_nudges", "export"]
HISTORY_DAYS = 90
REFRESH_HOURS = 24
DISCLAIMER = ("AI analysis written from the linked reports. Risk levels are assessments of the evidence, "
              "not predictions; check the original sources.")


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _hours_since(stamp, now: datetime) -> float:
    try:
        return (now - datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))).total_seconds() / 3600
    except ValueError:
        return float("inf")


# -- crypto -----------------------------------------------------------------

def crypto_available() -> bool:
    try:
        import cryptography  # noqa: F401
    except ImportError:
        return False
    return True


def fetch_pubkey(api_url: str, timeout: float = 10) -> dict | None:
    """The license server's public JWK, or None when it is unset, unreachable or malformed."""
    if not api_url or not api_url.startswith("https://"):
        return None
    try:
        req = urllib.request.Request(api_url.rstrip("/") + "/pubkey", headers={"User-Agent": "WorldPulse-build"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            jwk = json.loads(resp.read(4096))
    except Exception as exc:
        print(f"  Pro: public key not reachable ({type(exc).__name__}); Pro bundle skipped", file=sys.stderr)
        return None
    if not (isinstance(jwk, dict) and jwk.get("kty") == "EC" and jwk.get("crv") == "P-256" and jwk.get("x") and jwk.get("y")):
        print("  Pro: public key malformed; Pro bundle skipped", file=sys.stderr)
        return None
    return jwk


def _public_key(jwk: dict):
    from cryptography.hazmat.primitives.asymmetric import ec

    x, y = int.from_bytes(unb64u(jwk["x"]), "big"), int.from_bytes(unb64u(jwk["y"]), "big")
    return ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1()).public_key()


def _kek(shared: bytes, epk_raw: bytes) -> bytes:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    return HKDF(algorithm=hashes.SHA256(), length=32, salt=epk_raw, info=WRAP_INFO).derive(shared)


def wrap_key(content_key: bytes, bundle_id: str, jwk: dict) -> str:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    eph = ec.generate_private_key(ec.SECP256R1())
    epk_raw = eph.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    kek = _kek(eph.exchange(ec.ECDH(), _public_key(jwk)), epk_raw)
    iv = os.urandom(12)
    ct = AESGCM(kek).encrypt(iv, content_key, bundle_id.encode())
    return ".".join(["v1", bundle_id, b64u(epk_raw), b64u(iv), b64u(ct)])


def encrypt_bundle(content: dict, jwk: dict, now: datetime) -> dict:
    """Encrypt ``content`` under a fresh content key wrapped to ``jwk``: the public bundle.json data."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    bundle_id = now.strftime("%Y%m%d%H%M") + "-" + secrets.token_hex(4)
    key = AESGCM.generate_key(bit_length=256)
    iv = os.urandom(12)
    ct = AESGCM(key).encrypt(iv, json.dumps(content, ensure_ascii=False, separators=(",", ":")).encode(), bundle_id.encode())
    return {
        "v": 1,
        "id": bundle_id,
        "alg": ALG,
        "kid": jwk.get("kid"),
        "wrapped_key": wrap_key(key, bundle_id, jwk),
        "iv": b64u(iv),
        "ct": b64u(ct),
        "generated_at": _iso(now),
    }


# -- history and trends -------------------------------------------------------

def update_history(previous: dict | None, stats: list[dict], now: datetime) -> dict:
    """Per-theater daily history {id: [[date, stories, severity], ...]} for the last 90 days.

    The last 7 days are rewritten from the live archive every build; older days are carried
    forward from the previous deployment's public pro/state.json."""
    cutoff = (now - timedelta(days=HISTORY_DAYS - 1)).date().isoformat()
    out = {}
    for t in stats:
        days = {row[0]: row for row in (previous or {}).get(t["id"], []) if isinstance(row, list) and len(row) == 3}
        for h in t.get("history", []):
            days[h["date"]] = [h["date"], int(h["stories"]), round(float(h["severity"]), 2)]
        out[t["id"]] = [days[d] for d in sorted(days) if d >= cutoff]
    return out


def _pct(now_value: float, before: float) -> float | None:
    return round(100 * (now_value - before) / before, 1) if before else None


def trends(history: dict, stats: list[dict]) -> dict:
    """30/90-day series, peaks and changes per theater, for the bundle."""
    out = []
    for t in stats:
        rows = history.get(t["id"], [])
        series = [{"date": d, "stories": s, "intensity": intensity(sev)} for d, s, sev in rows]
        if not series:
            continue
        last = lambda n, skip=0: series[max(0, len(series) - n - skip): len(series) - skip]  # noqa: E731
        avg = lambda xs: sum(x["intensity"] for x in xs) / len(xs) if xs else 0  # noqa: E731
        peak = max(series, key=lambda x: (x["intensity"], x["stories"]))
        out.append({
            "id": t["id"],
            "name": t["name"],
            "days_observed": len(series),
            "series_30": last(30),
            "series_90": series,
            "peak_90": peak,
            "avg_intensity_7d": round(avg(last(7)), 1),
            "avg_intensity_30d": round(avg(last(30)), 1),
            "change_7d_pct": _pct(avg(last(7)), avg(last(7, 7))) if len(series) >= 14 else None,
            "change_30d_pct": _pct(avg(last(30)), avg(last(30, 30))) if len(series) >= 60 else None,
            "stories_30d": sum(x["stories"] for x in last(30)),
        })
    out.sort(key=lambda x: x["avg_intensity_7d"], reverse=True)
    return {"days": HISTORY_DAYS, "theaters": out}


# -- the Pro Intelligence Briefing -------------------------------------------

RISK = {"critical": "high", "high": "high", "elevated": "medium", "watch": "low", "quiet": "low"}


def rule_briefing(stats: list[dict], leads: dict[str, list[dict]]) -> list[dict]:
    """Rule-based hotspots from the theater metrics when AI is off: measured facts only."""
    hot = sorted((t for t in stats if t["stories_24h"]), key=lambda t: (t["intensity"], t["stories_24h"]), reverse=True)[:5]
    out = []
    for t in hot:
        sig = t.get("signals_24h") or {}
        top = leads.get(t["id"], [])[:3]
        changed = f"{t['stories_24h']} reports in 24 hours; intensity {t['intensity']}/100 ({t['status']}), trend {t['trend']}."
        if top:
            changed += f" Most covered: {top[0]['title']}"
        out.append({
            "id": t["id"],
            "changed": changed[:320],
            "why": t.get("description") or "",
            "actors": [],
            "risk": {"level": RISK.get(t["status"], "low"),
                     "reason": f"Derived from measured intensity ({t['status']}) and {sig.get('escalation', 0)} escalation vs "
                               f"{sig.get('de-escalation', 0)} de-escalation reports in 24 hours."},
            "watch": "Whether report volume and escalation signals keep rising over the next 72 hours.",
            "story_ids": [a["id"] for a in top],
            "rule": {"stories_24h": t["stories_24h"], "intensity": t["intensity"], "status": t["status"], "trend": t["trend"], "signals_24h": sig},
        })
    return out


def make_briefing(articles: list[dict], stats: list[dict], now: datetime, analyst, langs: list[str], slim) -> dict:
    by_id = {a["id"]: a for a in articles}
    leads = {t["id"]: [a for a in articles if t["id"] in a.get("theaters", []) and a.get("cluster", a["id"]) == a["id"]] for t in stats}
    active = sorted((t for t in stats if t["stories_7d"]), key=lambda t: (t["intensity"], t["stories_24h"]), reverse=True)[:12]
    hotspots, source, model = None, "rules", None
    if analyst is not None and analyst.available and active:
        pool = {a["id"]: a for a in briefing.top_stories(articles, now, limit=30) if a.get("theaters")}
        for t in active:
            pool.update({a["id"]: a for a in leads[t["id"]][:6]})
        theater_input = [{k: t[k] for k in ("id", "name", "status", "trend", "intensity", "stories_24h", "stories_7d", "signals_24h", "history")}
                         for t in active]
        result = analyst.pro_briefing([briefing.story_digest(a) for a in pool.values()], theater_input)
        if result:
            hotspots, source, model = result["hotspots"], "ai", result["model"]
    if hotspots is None:
        hotspots = rule_briefing(stats, leads)
    i18n = {}
    if source == "ai":
        for lang in langs:
            tr = analyst.pro_translate(lang, hotspots)
            if tr:
                i18n[lang] = tr
    names = {t["id"]: t for t in stats}
    for h in hotspots:
        t = names[h["id"]]
        h.update({"name": t["name"], "status": t["status"], "trend": t["trend"], "intensity": t["intensity"],
                  "names_i18n": {k: v.get("name") for k, v in (t.get("i18n") or {}).items()},
                  "stories": [slim(by_id[i]) for i in h["story_ids"] if i in by_id]})
    return {"generated_at": _iso(now), "source": source, "model": model,
            "disclaimer": DISCLAIMER if source == "ai" else "Automated digest of measured coverage.",
            "hotspots": hotspots, "i18n": i18n}


# -- build hook ----------------------------------------------------------------

def build_pro(cfg: dict, articles: list[dict], stats: list[dict], now: datetime, analyst, langs: list[str],
              prev_state: dict | None, prev_bundle: dict | None, slim, jwk: dict | None = None, fetch=fetch_pubkey):
    """Return (bundle data or None, public state, index.json data.pro)."""
    cfg = cfg or {}
    api_url = (os.environ.get("WORLDPULSE_PRO_API") or cfg.get("api_url") or "").strip().rstrip("/")
    prev_state = prev_state or {}
    history = update_history(prev_state.get("history"), stats, now)
    state = {"history": history, "bundle": None, "updated_at": _iso(now)}
    bundle = None

    if not api_url:
        print("  Pro: dormant (no pro.api_url configured)", file=sys.stderr)
    elif not crypto_available():
        print("  Pro: dormant (pip install -r requirements-pro.txt)", file=sys.stderr)
    else:
        jwk = jwk or fetch(api_url)
        prev_info = prev_state.get("bundle") or {}
        age = _hours_since(prev_info.get("generated_at"), now)
        reusable = (
            jwk and prev_bundle and prev_bundle.get("id") == prev_info.get("id") and prev_bundle.get("kid") == jwk.get("kid")
            and age < REFRESH_HOURS
            # a rule-based bundle is replaced as soon as AI can write one (after a short pause)
            and (prev_info.get("source") == "ai" or not (analyst and analyst.available) or age < 3)
        )
        if reusable:
            bundle = prev_bundle
            state["bundle"] = prev_info
            print(f"  Pro: bundle reused ({age:.1f}h old)", file=sys.stderr)
        elif jwk:
            content = {"v": 1, "generated_at": _iso(now),
                       "briefing": make_briefing(articles, stats, now, analyst, langs, slim),
                       "trends": trends(history, stats)}
            bundle = encrypt_bundle(content, jwk, now)
            state["bundle"] = {"id": bundle["id"], "generated_at": bundle["generated_at"], "source": content["briefing"]["source"]}
            print(f"  Pro: new encrypted bundle ({content['briefing']['source']} briefing, "
                  f"{len(content['trends']['theaters'])} trend series)", file=sys.stderr)

    index = {
        "enabled": bool(api_url and bundle),
        "api_url": api_url or None,
        "bundle": "pro/bundle.json" if bundle else None,
        "generated_at": bundle["generated_at"] if bundle else None,
        "features": FEATURES,
    }
    return bundle, state, index
