"""Build the static site and JSON API.

    python -m worldpulse.build --out public [--previous https://example.org/api/v1/all.json]

Everything is written as static files, so the result can be hosted for free on
GitHub Pages, Cloudflare Pages, Netlify or any web server.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape

from . import briefing, classify, cluster, conflicts, feeds, pro
from .ai import Analyst

ROOT = Path(__file__).resolve().parent.parent
API_VERSION = "v1"
AI_FIELDS = ("theaters", "severity", "signal", "insight", "analysis", "ai_model")
REPO_URL = f'{os.environ.get("GITHUB_SERVER_URL", "https://github.com")}/{os.environ.get("GITHUB_REPOSITORY", "ilicvix02/Claude")}'

STOPWORDS = set(
    """a an and are as at be been but by for from has have he her his how in into is it its
    of on or over says said she than that the their them they this to up was we were what when
    who will with after about new more amid could would can not no after before out under against
    us via why you your our year years day week first two three one live latest news update says
    report reports least just still back calls call make makes made many most other some""".split()
)


# ---------------------------------------------------------------------------
# helpers


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def from_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def canonical_url(url: str) -> str:
    """Strip tracking parameters and fragments so the same story dedupes."""
    parts = urllib.parse.urlsplit(url.strip())
    query = [
        (k, v)
        for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
        if not k.lower().startswith(("utm_", "at_", "cmp", "ns_", "ocid", "fbclid", "gclid"))
    ]
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc.lower(), parts.path, urllib.parse.urlencode(query), "")
    )


def article_id(url: str) -> str:
    return hashlib.sha1(canonical_url(url).encode()).hexdigest()[:16]


def title_key(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------------------
# collection


def normalize(raw: dict, source: dict, fetched_at: datetime) -> dict:
    published = raw.get("published") or fetched_at
    if published > fetched_at:  # clamp clock skew / bogus future dates
        published = fetched_at
    cats = classify.categorize(raw["title"], raw["summary"], source.get("categories"))
    return {
        "id": article_id(raw["link"]),
        "title": raw["title"],
        "url": canonical_url(raw["link"]),
        "summary": raw["summary"],
        "image": raw.get("image") or None,
        "source": {"id": source["id"], "name": source["name"]},
        "published_at": iso(published),
        "fetched_at": iso(fetched_at),
        "categories": cats,
        "regions": classify.regions(raw["title"], raw["summary"]),
        "tone": classify.sentiment(cats),
    }


def collect(sources: list[dict], fetched_at: datetime, fetcher=feeds.fetch) -> tuple[list[dict], list[dict]]:
    def run(source):
        try:
            entries = feeds.parse(fetcher(source["url"]))
            entries = entries[: source.get("max_items", 60)]
            entries = [e for e in entries if not classify.is_off_topic(e["title"], e["summary"])]
            return source, [normalize(e, source, fetched_at) for e in entries], None
        except Exception as exc:  # one broken feed must never break the build
            return source, [], f"{type(exc).__name__}: {exc}"

    articles, status = [], []
    with ThreadPoolExecutor(max_workers=8) as pool:
        for source, items, error in pool.map(run, sources):
            articles.extend(items)
            status.append(
                {
                    "id": source["id"],
                    "name": source["name"],
                    "homepage": source.get("homepage"),
                    "feed": source["url"],
                    "ok": error is None,
                    "items": len(items),
                    "error": error,
                    "checked_at": iso(fetched_at),
                }
            )
            print(f"  {'ok ' if error is None else 'ERR'} {source['id']:<20} {len(items):>3} {error or ''}", file=sys.stderr)
    return articles, status


def _sibling(location: str, name: str) -> str:
    """Location of another API file next to the previous all.json (URL or path)."""
    return location.rsplit("/", 1)[0] + "/" + name if "/" in location else name


class PreviousUnavailable(Exception):
    """The last deployment exists but could not be read; publishing now would reset its state."""


RETRY_DELAYS = (3, 10)  # seconds between attempts to read the previous deployment


def load_previous(location: str | None, name: str = "all.json"):
    """Load a file from the previously published API.

    Returns None when there is nothing to load (no location, or the file doesn't exist yet, e.g. on
    the first deploy). Raises PreviousUnavailable when it exists but can't be read after retries:
    the archive and the AI spend counter live there, so the build must not overwrite them blind.
    """
    if not location:
        return None
    where = location if name == "all.json" else _sibling(location, name)
    error = None
    for delay in (0, *RETRY_DELAYS):
        time.sleep(delay)
        try:
            if where.startswith(("http://", "https://")):
                payload = json.loads(feeds.fetch(where))
            else:
                payload = load_json(Path(where))
            print(f"  loaded previous {name} from {where}", file=sys.stderr)
            return payload
        except FileNotFoundError:
            return None
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                print(f"  no previous {name} (first deploy?); starting fresh", file=sys.stderr)
                return None
            error = exc
        except Exception as exc:  # timeouts, 5xx, truncated JSON: worth a retry
            error = exc
        print(f"  previous {name} not readable yet ({type(error).__name__}: {error})", file=sys.stderr)
    raise PreviousUnavailable(f"{where}: {type(error).__name__}: {error}")


def merge(previous: list[dict], fresh: list[dict], now: datetime, retention_days: int) -> list[dict]:
    """Merge by id (fresh wins, original fetch time kept), drop expired, dedupe by title."""
    by_id: dict[str, dict] = {a["id"]: a for a in previous if "id" in a and "published_at" in a}
    for a in fresh:
        old = by_id.get(a["id"])
        if old:
            a = {**a, "fetched_at": old.get("fetched_at", a["fetched_at"]), "published_at": old["published_at"]}
            if old.get("analysis") == "ai":  # keep paid-for AI judgements across builds
                a.update({k: old[k] for k in AI_FIELDS if k in old})
        by_id[a["id"]] = a
    cutoff = now - timedelta(days=retention_days)
    items = sorted(
        (a for a in by_id.values() if from_iso(a["published_at"]) >= cutoff),
        key=lambda a: (a["published_at"], a["id"]),
        reverse=True,
    )
    seen, out = set(), []
    for a in items:
        key = title_key(a["title"])
        if key in seen:
            continue
        seen.add(key)
        out.append(a)
    return out


# ---------------------------------------------------------------------------
# analytics


def tension(crises: int, deals: int) -> int:
    """0 = all dealmaking, 100 = all crisis. 50 when there is no signal."""
    total = crises + deals
    return round(100 * crises / total) if total else 50


MOODS = {
    "crisis_dominated": "Crisis-dominated",
    "tense": "Tense",
    "balanced": "Balanced",
    "constructive": "Constructive",
    "dealmaking_dominated": "Dealmaking-dominated",
}


def mood_key(index: int) -> str:
    """Stable id of the mood for a tension index; apps localize it, `mood()` is the English label."""
    if index >= 75:
        return "crisis_dominated"
    if index >= 58:
        return "tense"
    if index > 42:
        return "balanced"
    if index > 25:
        return "constructive"
    return "dealmaking_dominated"


def mood(index: int) -> str:
    return MOODS[mood_key(index)]


def trending_terms(articles: list[dict], limit: int = 15) -> list[dict]:
    counts: Counter = Counter()
    for a in articles:
        words = {w for w in re.findall(r"[A-Za-z][A-Za-z'-]{2,}", a["title"]) if w.lower() not in STOPWORDS}
        counts.update(w.lower() for w in words)
    return [{"term": t, "count": c} for t, c in counts.most_common(limit) if c > 1]


def state_of_world(articles: list[dict], now: datetime) -> dict:
    day_ago = now - timedelta(hours=24)
    recent = [a for a in articles if from_iso(a["published_at"]) >= day_ago] or articles[:100]

    cat_counts = Counter(c for a in recent for c in a["categories"])
    regions = []
    for slug, meta in classify.REGIONS.items():
        rs = [a for a in recent if slug in a["regions"]]
        c = sum("crises" in a["categories"] for a in rs)
        d = sum("deals" in a["categories"] for a in rs)
        regions.append(
            {"id": slug, "label": meta["label"], "articles": len(rs), "crises": c, "deals": d, "tension": tension(c, d)}
        )
    regions.sort(key=lambda r: r["articles"], reverse=True)

    days = []
    for offset in range(6, -1, -1):
        start = (now - timedelta(days=offset)).replace(hour=0, minute=0, second=0)
        end = start + timedelta(days=1)
        ds = [a for a in articles if start <= from_iso(a["published_at"]) < end]
        c = sum("crises" in a["categories"] for a in ds)
        d = sum("deals" in a["categories"] for a in ds)
        days.append({"date": start.date().isoformat(), "articles": len(ds), "crises": c, "deals": d, "tension": tension(c, d)})

    index = tension(cat_counts.get("crises", 0), cat_counts.get("deals", 0))
    pick = lambda cat: [slim(a) for a in recent if cat in a["categories"]][:5]  # noqa: E731
    return {
        "window_hours": 24,
        "articles": len(recent),
        "tension_index": index,
        "mood": mood(index),
        "mood_key": mood_key(index),
        "explanation": "Share of crisis coverage among crisis + deal coverage in the last 24h (0 = all deals, 100 = all crises).",
        "explanation_key": "tension_index",
        "categories": [
            {"id": slug, "label": meta["label"], "articles": cat_counts.get(slug, 0)}
            for slug, meta in classify.CATEGORIES.items()
        ],
        "regions": regions,
        "history": days,
        "trending": trending_terms(recent),
        "top_crises": pick("crises"),
        "top_deals": pick("deals"),
    }


SLIM_FIELDS = ("id", "title", "url", "source", "published_at", "categories", "regions", "theaters", "severity", "coverage")


def slim(a: dict) -> dict:
    return {k: a[k] for k in SLIM_FIELDS if k in a}


# ---------------------------------------------------------------------------
# output


def meta(site: dict, generated_at: datetime, base_url: str, count: int | None = None, **extra) -> dict:
    m = {
        "api_version": API_VERSION,
        "generated_at": iso(generated_at),
        "docs": f"{base_url}/docs.html" if base_url else "docs.html",
        "source_code": REPO_URL,
        "license": "Code: MIT. Headlines and excerpts belong to their publishers; always link to the original url.",
    }
    if count is not None:
        m["count"] = count
    m.update(extra)
    return m


# ---------------------------------------------------------------------------
# revenue settings


def http_url(value) -> str | None:
    value = (value or "").strip() if isinstance(value, str) else ""
    parts = urllib.parse.urlsplit(value)
    return value if parts.scheme in ("http", "https") and parts.netloc else None


def _handle(value: str, host: str) -> str | None:
    """'name', '@name' or a profile URL on `host` → 'name'."""
    value = re.sub(rf"^(https?://)?(www\.)?{re.escape(host)}/", "", value.strip(), flags=re.I).lstrip("@")
    value = value.split("/")[0].split("?")[0]
    return value if re.fullmatch(r"[A-Za-z0-9_.-]{2,40}", value) else None


def plan_i18n(value) -> dict:
    """A plan's translations from config, {lang: {name, blurb, features, cta}}, keeping only text."""
    out = {}
    for lang, t in (value.items() if isinstance(value, dict) else ()):
        if not (isinstance(t, dict) and re.fullmatch(r"[a-z]{2,3}(-[A-Za-z0-9]{2,8})?", str(lang))):
            continue
        entry = {k: t[k].strip() for k in ("name", "blurb", "cta") if isinstance(t.get(k), str) and t[k].strip()}
        features = [f.strip() for f in t.get("features") or [] if isinstance(f, str) and f.strip()] if isinstance(t.get("features"), list) else []
        if features:
            entry["features"] = features
        if entry:
            out[lang] = entry
    return out


def resolve_revenue(revenue: dict, env=os.environ) -> dict:
    """The revenue settings the app and API show: config/site.json, overridden by the repository
    Variables passed in as WORLDPULSE_* (see README → Revenue). Links must be http(s); a plan is only
    listed once it has somewhere to pay (its own url, the Ko-fi page, or the contact email). `pricing`
    lists every plan's price, checkout or not, for places that only show prices (the promo video)."""
    revenue = revenue or {}
    var = lambda name: (env.get(name) or "").strip()  # noqa: E731
    kofi = _handle(var("WORLDPULSE_KOFI") or revenue.get("kofi") or "", "ko-fi.com")
    kofi_url = f"https://ko-fi.com/{kofi}" if kofi else None
    email = var("WORLDPULSE_CONTACT_EMAIL") or revenue.get("advertise_email") or ""
    email = email if re.fullmatch(r"[^@\s<>\"']+@[^@\s<>\"']+\.[A-Za-z]{2,}", email) else None
    tiktok = _handle(var("WORLDPULSE_TIKTOK") or (revenue.get("social") or {}).get("tiktok") or "", "tiktok.com")

    donate = []
    for d in revenue.get("donate", []):
        url = http_url(d.get("url")) or (kofi_url if d.get("label", "").lower() == "ko-fi" else None)
        if url:
            donate.append({"label": d["label"], "url": url})

    plans, pricing = [], []
    for p in revenue.get("plans", []):
        i18n = plan_i18n(p.get("i18n"))
        pricing.append({k: p.get(k) for k in ("id", "name", "price", "period")} | {"i18n": i18n})
        url = http_url(p.get("url"))
        if not url and kofi_url and p.get("kofi"):
            url = f"{kofi_url}/{p['kofi'].strip('/')}"
        if not url and email and p.get("email_subject"):
            url = f"mailto:{email}?subject={urllib.parse.quote(p['email_subject'])}"
        if url:
            plans.append({k: p.get(k) for k in ("id", "name", "price", "period", "blurb", "features", "cta")} | {"url": url, "i18n": i18n})

    return {
        "ethicalads_publisher": revenue.get("ethicalads_publisher") or None,
        "donate": donate,
        "plans": plans,
        "pricing": pricing,
        "kofi_url": kofi_url,
        "newsletter_url": http_url(var("WORLDPULSE_NEWSLETTER_URL") or revenue.get("newsletter_url")),
        "advertise_email": email,
        "social": {"tiktok": f"https://www.tiktok.com/@{tiktok}" if tiktok else None},
    }


def rss(title: str, link: str, self_url: str, description: str, articles: list[dict], generated_at: datetime) -> str:
    from email.utils import format_datetime

    items = []
    for a in articles[:100]:
        cats = "".join(f"<category>{escape(c)}</category>" for c in a["categories"])
        items.append(
            "<item>"
            f"<title>{escape(a['title'])}</title>"
            f"<link>{escape(a['url'])}</link>"
            f"<guid isPermaLink=\"false\">{a['id']}</guid>"
            f"<pubDate>{format_datetime(from_iso(a['published_at']))}</pubDate>"
            f"<source url=\"{escape(a['url'])}\">{escape(a['source']['name'])}</source>"
            f"<description>{escape(a['summary'])}</description>{cats}"
            "</item>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>'
        f"<title>{escape(title)}</title><link>{escape(link)}</link>"
        f"<description>{escape(description)}</description>"
        f'<atom:link href="{escape(self_url)}" rel="self" type="application/rss+xml"/>'
        f"<lastBuildDate>{format_datetime(generated_at)}</lastBuildDate>"
        + "".join(items)
        + "</channel></rss>\n"
    )


def openapi(site: dict, base_url: str, theater_ids: list[str]) -> dict:
    def path(summary, desc, params=None):
        op = {"summary": summary, "description": desc, "responses": {"200": {"description": "OK"}}}
        if params:
            op["parameters"] = params
        return {"get": op}

    slug = lambda name, enum: [{"name": name, "in": "path", "required": True, "schema": {"type": "string", "enum": enum}}]  # noqa: E731
    return {
        "openapi": "3.0.3",
        "info": {
            "title": f"{site['title']} API",
            "version": API_VERSION,
            "description": site["tagline"] + " Static JSON, CORS-enabled, no key required. Refreshed hourly.",
            "license": {"name": "MIT", "url": f"{REPO_URL}/blob/main/LICENSE"},
        },
        "servers": [{"url": f"{base_url}/api/v1" if base_url else "/api/v1"}],
        "paths": {
            "/index.json": path("Discovery", "Endpoints, categories, regions, theaters (with i18n names), site info and revenue. "
                                "revenue.plans lists plans with a checkout url; revenue.pricing lists every plan's id, name, price, "
                                "period and i18n ({lang: {name, blurb, features, cta}}), checkout or not. ai.brief_translations "
                                "lists the languages the current brief is translated into."),
            "/latest.json": path("Latest articles", "Most recent articles across all sources."),
            "/all.json": path("Rolling archive", f"Every article from the last {site.get('retention_days', 7)} days."),
            "/state.json": path("State of the world", "Tension index, mood, category and region breakdowns, 7-day history, trending terms. "
                                "mood is an English label; mood_key (crisis_dominated, tense, balanced, constructive, dealmaking_dominated) "
                                "and explanation_key (tension_index) are stable ids for translating it."),
            "/brief.json": path("World brief", "AI-written (or automated) summary of the last 24h with cited stories. "
                                "disclaimer_key is the source (ai or rules). When source is rules, rule holds the inputs of the English "
                                "headline and watch line: {mood_key, active_conflicts, escalating, watch: {theater, stories_24h, trend} or null}; "
                                "the bullets are original headlines. When source is ai, i18n holds translations by language code "
                                "({de, sr}: {headline, bullets: [text, in the order of bullets], watch}); a missing language means English only."),
            "/conflicts.json": path("Conflict tracker", "Every tracked conflict theater: intensity, status, trend, 7-day history, situation summary, latest stories. "
                                    "i18n holds the theater's name and description by language ({de, sr}: {name, description}). "
                                    "analysis.rule (source rules) is {key: recent_reports or no_recent_reports, stories_24h, stories_7d, trend}; "
                                    "analysis.i18n (source ai) is {lang: {summary, outlook, developments: [text] or null}}."),
            "/conflicts/{theater}.json": path("Conflict theater", "One theater with all its stories from the last 7 days, with the same fields as in conflicts.json.",
                                              slug("theater", theater_ids)),
            "/sources.json": path("Sources", "Feed list with health status from the last build."),
            "/categories/{category}.json": path("Articles by category", "Filter by topic.", slug("category", list(classify.CATEGORIES))),
            "/regions/{region}.json": path("Articles by region", "Filter by world region.", slug("region", list(classify.REGIONS))),
        },
    }


def hours_since(stamp: str | None, now: datetime) -> float:
    if not stamp:
        return float("inf")
    try:
        return (now - from_iso(stamp)).total_seconds() / 3600
    except ValueError:
        return float("inf")


def ai_candidates(articles: list[dict], limit: int) -> list[dict]:
    """Stories still on rule-based values that are worth an AI read: conflict-related, newest first."""
    pending = [
        a for a in articles
        if a.get("analysis") != "ai" and (a.get("theaters") or {"conflict", "crises"} & set(a["categories"]))
    ]
    pending.sort(key=lambda a: (bool(a.get("theaters")), a["published_at"]), reverse=True)
    return pending[:limit]


def translate_briefing(analyst, langs, brief, summaries, stats) -> None:
    """Add AI translations to an AI brief and its theater summaries, in place, under "i18n": one call
    per language that isn't translated yet, so a reused brief keeps its translations for free. A
    failed or rejected translation only means the app shows that text in English."""
    for lang in langs:
        if lang in brief.get("i18n", {}) or not analyst.available:
            continue
        try:
            names = {t["id"]: (t.get("i18n") or {}).get(lang, {}).get("name") for t in stats}
            result = analyst.translate(lang, brief, summaries, names)
            if not result:
                continue
            if result["brief"]:
                brief.setdefault("i18n", {})[lang] = result["brief"]
            for tid, tr in result["theaters"].items():
                summaries[tid].setdefault("i18n", {})[lang] = tr
            print(f"  AI translated the brief into {lang} ({len(result['theaters'])} theater summaries)", file=sys.stderr)
        except Exception as exc:  # never let a translation break the build
            print(f"  AI translation ({lang}) skipped: {type(exc).__name__}: {exc}", file=sys.stderr)


def make_briefing(articles, stats, now, mood_label, analyst, ai_cfg, previous):
    """Return (brief, theater_summaries, source, model, generated_at), reusing recent AI output."""
    stories = briefing.top_stories(articles, now)
    active = [t for t in stats if t["stories_7d"]]
    per_theater = {}
    for t in active:
        leads = [a for a in articles if t["id"] in a.get("theaters", []) and a.get("cluster", a["id"]) == a["id"]]
        per_theater[t["id"]] = leads[:6]

    prev_brief = (load_previous(previous, "brief.json") or {}).get("data") if previous else None
    prev_conf = (load_previous(previous, "conflicts.json") or {}).get("data") if previous else None
    prev_ok = prev_brief and prev_brief.get("source") == "ai"
    prev_age = hours_since(prev_brief.get("generated_at"), now) if prev_ok else float("inf")
    langs = [lang for lang in ai_cfg.get("translate", ["de", "sr"]) or [] if isinstance(lang, str)]

    def reuse():
        summaries = {}
        for t in (prev_conf or {}).get("theaters", []):
            an = t.get("analysis") or {}
            if an.get("source") == "ai":
                summaries[t["id"]] = {
                    "summary": an.get("summary"), "outlook": an.get("outlook"),
                    "developments": [{"text": d["text"], "story_id": d["story"]["id"]} for d in an.get("developments", []) if d.get("story")],
                    "i18n": {k: v for k, v in (an.get("i18n") or {}).items() if k in langs},
                }
        brief = {
            "headline": prev_brief["headline"],
            "bullets": [{"text": b["text"], "story_ids": [s["id"] for s in b.get("stories", [])]} for b in prev_brief["bullets"]],
            "watch": prev_brief.get("watch"),
            "i18n": {k: v for k, v in (prev_brief.get("i18n") or {}).items() if k in langs},
        }
        translate_briefing(analyst, langs, brief, summaries, stats)  # only languages the last run missed
        return brief, summaries, "ai", prev_brief.get("model"), prev_brief["generated_at"]

    if prev_ok and prev_age < float(ai_cfg.get("brief_every_hours", 3)):
        print(f"  AI brief reused ({prev_age:.1f}h old)", file=sys.stderr)
        return reuse()

    if analyst.available and stories:
        pool = {a["id"]: a for a in stories}
        for leads in per_theater.values():
            pool.update({a["id"]: a for a in leads})
        theater_input = [
            {k: t[k] for k in ("id", "name", "status", "trend", "intensity", "stories_24h", "stories_7d", "signals_24h")}
            | {"story_ids": [a["id"] for a in per_theater[t["id"]]]}
            for t in active
        ]
        result = analyst.brief([briefing.story_digest(a) for a in pool.values()], theater_input)
        if result:
            translate_briefing(analyst, langs, result["brief"], result["theaters"], stats)
            return result["brief"], result["theaters"], "ai", result["model"], iso(now)

    if prev_ok and prev_age < 12:  # AI temporarily unavailable: a few-hours-old AI brief beats rules
        print(f"  AI unavailable; reusing {prev_age:.1f}h-old AI brief", file=sys.stderr)
        return reuse()

    summaries = {t["id"]: briefing.rule_theater_summary(t, per_theater.get(t["id"], [])) for t in stats}
    brief = briefing.rule_brief(stories, stats, mood_label)
    return brief, summaries, "rules", None, iso(now)


def build(out: Path, previous: str | None, fetcher=feeds.fetch, now: datetime | None = None, analyst: Analyst | None = None) -> dict:
    now = now or now_utc()
    site = load_json(ROOT / "config" / "site.json")
    site["revenue"] = resolve_revenue(site.get("revenue", {}))
    sources =load_json(ROOT / "config" / "sources.json")["sources"]
    theaters = conflicts.Theaters(load_json(ROOT / "config" / "conflicts.json")["theaters"])
    ai_cfg = site.get("ai", {})
    analyst = analyst or Analyst(ai_cfg)
    base_url = (os.environ.get("WORLDPULSE_BASE_URL") or site.get("base_url") or "").rstrip("/")

    print(f"Fetching {len(sources)} sources…", file=sys.stderr)
    fresh, status = collect(sources, now, fetcher)
    prev_all = load_previous(previous) or {}
    articles = merge(prev_all.get("data", []), fresh, now, int(site.get("retention_days", 7)))
    if not articles:
        raise SystemExit("No articles collected — refusing to publish an empty site.")

    # AI spend so far (the counter is carried from deploy to deploy, like the archive)
    prev_ledger = (load_previous(previous, "ai-usage.json") or {}).get("data") or {}
    analyst.spent = float(prev_ledger.get("spent_usd") or 0)
    if analyst.client is not None and analyst.over_budget:
        analyst.reason = f"budget reached (${analyst.spent:.2f} of ${analyst.budget:.2f} spent); raise ai.budget_usd to resume"

    # 1. rule-based conflict tagging for everything not already judged by AI
    for a in articles:
        if a.get("analysis") != "ai":
            conflicts.annotate(a, theaters)
    # 2. AI judgements for new conflict-related stories (only stories never analysed before)
    if analyst.available:
        batch = ai_candidates(articles, int(ai_cfg.get("max_articles_per_run", 40)))
        results = analyst.analyze(batch, theaters.items)
        for a in articles:
            if a["id"] in results:
                a.update(results[a["id"]])
        print(f"  AI analysed {len(results)}/{len(batch)} stories", file=sys.stderr)
    else:
        print(f"  AI off: {analyst.reason}", file=sys.stderr)
    # 3. group coverage of the same event
    cluster.assign(articles)

    latest = articles[: int(site.get("latest_limit", 300))]
    by_id = {a["id"]: a for a in articles}
    state = state_of_world(articles, now)
    since = conflicts.observed_since(articles)
    stats = [conflicts.theater_metrics(t, articles, now, since) for t in theaters.items]
    brief, summaries, brief_source, brief_model, brief_at = make_briefing(
        articles, stats, now, state["mood"], analyst, ai_cfg, previous
    )

    def cite(ids):
        return [slim(by_id[i]) for i in ids if i in by_id]

    brief_doc = {
        "headline": brief["headline"],
        "bullets": [{"text": b["text"], "stories": cite(b["story_ids"])} for b in brief["bullets"]],
        "watch": brief.get("watch"),
        "source": brief_source,
        "model": brief_model,
        "generated_at": brief_at,
        "disclaimer": "Written by AI from the linked reports; it can make mistakes. Check the original sources."
        if brief_source == "ai" else "Automated digest of the most-covered stories.",
        "disclaimer_key": brief_source,
        # Inputs of the rule-based headline and watch line, so apps can write them in any language.
        "rule": (brief["rule"] | {"mood_key": state["mood_key"]}) if brief_source == "rules" else None,
        "i18n": (brief.get("i18n") or {}) if brief_source == "ai" else {},
    }
    conflict_docs = []
    for t in stats:
        items = [a for a in articles if t["id"] in a.get("theaters", [])]
        leads = [a for a in items if a.get("cluster", a["id"]) == a["id"]]
        s, src = summaries.get(t["id"]), brief_source
        if not s:  # AI wrote summaries only for theaters with coverage
            s, src = briefing.rule_theater_summary(t, leads), "rules"
        devs = s.get("developments", [])
        keep = [i for i, d in enumerate(devs) if d.get("story_id") in by_id]
        i18n = {}
        for lang, tr in ((s.get("i18n") or {}) if src == "ai" else {}).items():
            tdevs = tr.get("developments")
            i18n[lang] = {
                "summary": tr["summary"], "outlook": tr.get("outlook"),
                # same length and order as "developments", or None when they can't be matched up
                "developments": [tdevs[i] for i in keep] if isinstance(tdevs, list) and len(tdevs) == len(devs) else None,
            }
        analysis = {
            "summary": s["summary"],
            "outlook": s.get("outlook"),
            "developments": [{"text": devs[i]["text"], "story": slim(by_id[devs[i]["story_id"]])} for i in keep],
            "source": src,
            "model": brief_model if src == "ai" else None,
            "generated_at": brief_at if src == "ai" else iso(now),
            "rule": s.get("rule") if src == "rules" else None,
            "i18n": i18n,
        }
        conflict_docs.append({**t, "analysis": analysis, "latest": [slim(a) for a in leads[:8]], "_items": items})
    conflict_docs.sort(key=lambda t: (t["intensity"], t["stories_7d"]), reverse=True)
    overview = {
        "active": sum(1 for t in stats if t["stories_24h"]),
        "critical": sum(1 for t in stats if t["status"] == "critical"),
        "escalating": sum(1 for t in stats if t["trend"] == "escalating"),
        "de_escalating": sum(1 for t in stats if t["trend"] == "de-escalating"),
    }
    state["conflicts"] = overview | {"hotspots": [{k: t[k] for k in ("id", "name", "status", "trend", "intensity")} for t in conflict_docs[:5]]}

    # World Pulse Pro: the daily encrypted bundle (dormant until the license server is deployed)
    pro_bundle, pro_state, pro_index = pro.build_pro(
        site.get("pro"), articles, stats, now, analyst,
        [lang for lang in ai_cfg.get("translate", ["de", "sr"]) or [] if isinstance(lang, str)],
        (load_previous(previous, "pro/state.json") or {}).get("data") if previous else None,
        (load_previous(previous, "pro/bundle.json") or {}).get("data") if previous else None,
        slim,
    )

    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "web", out)
    api = out / "api" / API_VERSION
    M = lambda count=None, **kw: meta(site, now, base_url, count, **kw)  # noqa: E731

    write_json(api / "latest.json", {"meta": M(len(latest)), "data": latest})
    write_json(api / "all.json", {"meta": M(len(articles), retention_days=site.get("retention_days", 7)), "data": articles})
    write_json(api / "state.json", {"meta": M(), "data": state})
    write_json(api / "sources.json", {"meta": M(len(status)), "data": status})
    write_json(api / "brief.json", {"meta": M(), "data": brief_doc})
    write_json(
        api / "conflicts.json",
        {"meta": M(len(conflict_docs)), "data": {"overview": overview, "theaters": [{k: v for k, v in t.items() if k != "_items"} for t in conflict_docs]}},
    )
    for t in conflict_docs:
        doc = {k: v for k, v in t.items() if k != "_items"}
        write_json(api / "conflicts" / f"{t['id']}.json", {"meta": M(len(t["_items"]), theater=t["id"]), "data": doc | {"stories": t["_items"]}})

    link = base_url or "."
    conflict_items = [a for a in articles if a.get("theaters")]
    (api / "conflicts.xml").write_text(
        rss(f"{site['title']} – Conflicts", link, f"{link}/api/v1/conflicts.xml", "Reports from tracked conflict theaters.", conflict_items, now),
        encoding="utf-8",
    )
    cat_index, region_index = [], []
    for slug, c in classify.CATEGORIES.items():
        items = [a for a in articles if slug in a["categories"]]
        write_json(api / "categories" / f"{slug}.json", {"meta": M(len(items), category=slug), "data": items[:300]})
        (api / "categories" / f"{slug}.xml").write_text(
            rss(f"{site['title']} – {c['label']}", link, f"{link}/api/v1/categories/{slug}.xml", c["description"], items, now),
            encoding="utf-8",
        )
        cat_index.append({"id": slug, "label": c["label"], "description": c["description"], "count": len(items),
                          "json": f"categories/{slug}.json", "rss": f"categories/{slug}.xml"})
    for slug, r in classify.REGIONS.items():
        items = [a for a in articles if slug in a["regions"]]
        write_json(api / "regions" / f"{slug}.json", {"meta": M(len(items), region=slug), "data": items[:300]})
        region_index.append({"id": slug, "label": r["label"], "count": len(items), "json": f"regions/{slug}.json"})

    (out / "feed.xml").write_text(
        rss(site["title"], link, f"{link}/feed.xml", site["tagline"], latest, now), encoding="utf-8"
    )
    write_json(api / "openapi.json", openapi(site, base_url, theaters.ids()))
    write_json(api / "pro" / "state.json", {"meta": M(), "data": pro_state})
    if pro_bundle:
        write_json(api / "pro" / "bundle.json", {"meta": M(), "data": pro_bundle})

    write_json(
        api / "index.json",
        {
            "meta": M(len(articles)),
            "data": {
                "site": {"title": site["title"], "tagline": site["tagline"], "base_url": base_url},
                "endpoints": {
                    "latest": "latest.json", "all": "all.json", "state": "state.json", "brief": "brief.json",
                    "conflicts": "conflicts.json", "sources": "sources.json", "openapi": "openapi.json",
                    "rss": "../../feed.xml", "conflicts_rss": "conflicts.xml",
                },
                "categories": cat_index,
                "regions": region_index,
                "theaters": [{"id": t["id"], "name": t["name"], "i18n": {k: v["name"] for k, v in (t.get("i18n") or {}).items()},
                              "json": f"conflicts/{t['id']}.json"} for t in theaters.items],
                "ai": {
                    "enabled": analyst.available,
                    "model": analyst.model if analyst.available else None,
                    "brief_source": brief_source,
                    "brief_translations": sorted(brief_doc["i18n"]),
                    "analysed_stories": sum(1 for a in articles if a.get("analysis") == "ai"),
                },
                "sources_ok": sum(s["ok"] for s in status),
                "sources_total": len(status),
                "revenue": site["revenue"],
                "pro": pro_index,
            },
        },
    )

    # App shell: API location (absolute for native builds) and a build id that refreshes the offline cache.
    build_id = now.strftime("%Y%m%d%H%M%S")
    app_api = os.environ.get("WORLDPULSE_APP_API_BASE", "api/v1/")
    (out / "config.js").write_text(
        "window.WP_CONFIG = " + json.dumps({"apiBase": app_api, "bundledApi": "api/v1/", "build": build_id}) + ";\n", encoding="utf-8"
    )
    # Social previews and search engines need absolute URLs.
    for page in ("index.html", "docs.html"):
        f = out / page
        f.write_text(f.read_text(encoding="utf-8").replace("%BASE_URL%", base_url or "."), encoding="utf-8")
    if base_url:
        (out / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {base_url}/sitemap.xml\n", encoding="utf-8")
    sw = out / "sw.js"
    sw.write_text(sw.read_text(encoding="utf-8").replace("__BUILD__", build_id), encoding="utf-8")

    if base_url:
        urls = ["/", "/docs.html", "/feed.xml"]
        (out / "sitemap.xml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            + "".join(f"<url><loc>{escape(base_url + u)}</loc><lastmod>{iso(now)}</lastmod></url>" for u in urls)
            + "</urlset>\n",
            encoding="utf-8",
        )
    (out / ".nojekyll").write_text("")
    u = analyst.usage
    ledger = {
        "budget_usd": analyst.budget,
        "spent_usd": round(analyst.spent, 6),
        "remaining_usd": round(max(0.0, analyst.budget - analyst.spent), 6) if analyst.budget is not None else None,
        "paused": analyst.client is not None and analyst.over_budget,
        "model": analyst.model,
        "calls": int(prev_ledger.get("calls") or 0) + u["calls"],
        "input_tokens": int(prev_ledger.get("input_tokens") or 0) + u["input_tokens"],
        "output_tokens": int(prev_ledger.get("output_tokens") or 0) + u["output_tokens"],
        "last_run_usd": round(u["cost_usd"], 6),
        "since": prev_ledger.get("since") or (iso(now) if u["calls"] else None),
        "updated_at": iso(now),
    }
    write_json(api / "ai-usage.json", {"meta": M(), "data": ledger})
    if u["calls"]:
        budget = f" of ${analyst.budget:.2f}" if analyst.budget is not None else ""
        print(f"  AI usage: {u['calls']} calls, {u['input_tokens']} input / {u['output_tokens']} output tokens, "
              f"${u['cost_usd']:.4f} this run, ${analyst.spent:.4f}{budget} total ({analyst.model})", file=sys.stderr)
    print(f"Built {len(articles)} articles ({len(fresh)} fresh), brief: {brief_source} → {out}", file=sys.stderr)
    return {
        "articles": len(articles), "fresh": len(fresh), "sources_ok": sum(s["ok"] for s in status),
        "brief_source": brief_source, "ai_analysed": sum(1 for a in articles if a.get("analysis") == "ai"),
        "ai_spent_usd": ledger["spent_usd"],
    }


def load_dotenv(path: Path = ROOT / ".env") -> None:
    """Read KEY=VALUE lines from a local, git-ignored .env file. Real environment variables win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip().removeprefix("export ").strip(), value.strip().strip("'\"")
        if key and value and key not in os.environ:
            os.environ[key] = value


def main(argv=None) -> None:
    load_dotenv()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", default="public", type=Path, help="output directory (default: public)")
    p.add_argument("--previous", help="URL or path of a previous all.json to merge, keeping a rolling archive")
    args = p.parse_args(argv)
    try:
        build(args.out, args.previous)
    except PreviousUnavailable as exc:
        raise SystemExit(
            f"Could not read the previous deployment ({exc}). Not publishing, so the live site, its archive "
            "and the AI spend counter stay as they are. The next scheduled run will try again."
        )


if __name__ == "__main__":
    main()
