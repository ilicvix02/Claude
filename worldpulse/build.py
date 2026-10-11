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
import urllib.parse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape

from . import classify, feeds

ROOT = Path(__file__).resolve().parent.parent
API_VERSION = "v1"
REPO_URL = "https://github.com/ilicvix02/Claude"

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


def load_previous(location: str | None) -> list[dict]:
    if not location:
        return []
    try:
        if location.startswith(("http://", "https://")):
            payload = json.loads(feeds.fetch(location))
        else:
            payload = load_json(Path(location))
        items = payload.get("data", [])
        print(f"  loaded {len(items)} previous articles from {location}", file=sys.stderr)
        return items
    except Exception as exc:
        print(f"  previous store unavailable ({exc}); starting fresh", file=sys.stderr)
        return []


def merge(previous: list[dict], fresh: list[dict], now: datetime, retention_days: int) -> list[dict]:
    """Merge by id (fresh wins, original fetch time kept), drop expired, dedupe by title."""
    by_id: dict[str, dict] = {a["id"]: a for a in previous if "id" in a and "published_at" in a}
    for a in fresh:
        old = by_id.get(a["id"])
        if old:
            a = {**a, "fetched_at": old.get("fetched_at", a["fetched_at"]), "published_at": old["published_at"]}
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


def mood(index: int) -> str:
    if index >= 75:
        return "Crisis-dominated"
    if index >= 58:
        return "Tense"
    if index > 42:
        return "Balanced"
    if index > 25:
        return "Constructive"
    return "Dealmaking-dominated"


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
        "explanation": "Share of crisis coverage among crisis + deal coverage in the last 24h (0 = all deals, 100 = all crises).",
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


def slim(a: dict) -> dict:
    return {k: a[k] for k in ("id", "title", "url", "source", "published_at", "categories", "regions")}


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
    sponsor = site.get("revenue", {}).get("sponsor", {})
    if sponsor.get("text") and sponsor.get("url"):
        m["sponsor"] = {"text": sponsor["text"], "url": sponsor["url"]}
    m.update(extra)
    return m


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


def openapi(site: dict, base_url: str) -> dict:
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
            "/index.json": path("Discovery", "Endpoints, categories, regions, site info."),
            "/latest.json": path("Latest articles", "Most recent articles across all sources."),
            "/all.json": path("Rolling archive", f"Every article from the last {site.get('retention_days', 7)} days."),
            "/state.json": path("State of the world", "Tension index, mood, category and region breakdowns, 7-day history, trending terms."),
            "/sources.json": path("Sources", "Feed list with health status from the last build."),
            "/categories/{category}.json": path("Articles by category", "Filter by topic.", slug("category", list(classify.CATEGORIES))),
            "/regions/{region}.json": path("Articles by region", "Filter by world region.", slug("region", list(classify.REGIONS))),
        },
    }


def build(out: Path, previous: str | None, fetcher=feeds.fetch, now: datetime | None = None) -> dict:
    now = now or now_utc()
    site = load_json(ROOT / "config" / "site.json")
    sources = load_json(ROOT / "config" / "sources.json")["sources"]
    base_url = (os.environ.get("WORLDPULSE_BASE_URL") or site.get("base_url") or "").rstrip("/")

    print(f"Fetching {len(sources)} sources…", file=sys.stderr)
    fresh, status = collect(sources, now, fetcher)
    articles = merge(load_previous(previous), fresh, now, int(site.get("retention_days", 7)))
    if not articles:
        raise SystemExit("No articles collected — refusing to publish an empty site.")
    latest = articles[: int(site.get("latest_limit", 300))]

    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "web", out)
    api = out / "api" / API_VERSION
    M = lambda count=None, **kw: meta(site, now, base_url, count, **kw)  # noqa: E731

    state = state_of_world(articles, now)
    write_json(api / "latest.json", {"meta": M(len(latest)), "data": latest})
    write_json(api / "all.json", {"meta": M(len(articles), retention_days=site.get("retention_days", 7)), "data": articles})
    write_json(api / "state.json", {"meta": M(), "data": state})
    write_json(api / "sources.json", {"meta": M(len(status)), "data": status})

    link = base_url or "."
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
    write_json(api / "openapi.json", openapi(site, base_url))

    revenue = site.get("revenue", {})
    write_json(
        api / "index.json",
        {
            "meta": M(len(articles)),
            "data": {
                "site": {"title": site["title"], "tagline": site["tagline"], "base_url": base_url},
                "endpoints": {
                    "latest": "latest.json", "all": "all.json", "state": "state.json", "sources": "sources.json",
                    "openapi": "openapi.json", "rss": "../../feed.xml",
                },
                "categories": cat_index,
                "regions": region_index,
                "sources_ok": sum(s["ok"] for s in status),
                "sources_total": len(status),
                "revenue": {
                    "sponsor": revenue.get("sponsor") if revenue.get("sponsor", {}).get("url") else None,
                    "ethicalads_publisher": revenue.get("ethicalads_publisher") or None,
                    "donate": [d for d in revenue.get("donate", []) if d.get("url")],
                    "newsletter_url": revenue.get("newsletter_url") or None,
                    "advertise_email": revenue.get("advertise_email") or None,
                },
            },
        },
    )
    if base_url:
        urls = ["/", "/docs.html", "/feed.xml"]
        (out / "sitemap.xml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            + "".join(f"<url><loc>{escape(base_url + u)}</loc><lastmod>{iso(now)}</lastmod></url>" for u in urls)
            + "</urlset>\n",
            encoding="utf-8",
        )
    (out / ".nojekyll").write_text("")
    print(f"Built {len(articles)} articles ({len(fresh)} fresh) → {out}", file=sys.stderr)
    return {"articles": len(articles), "fresh": len(fresh), "sources_ok": sum(s["ok"] for s in status)}


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", default="public", type=Path, help="output directory (default: public)")
    p.add_argument("--previous", help="URL or path of a previous all.json to merge, keeping a rolling archive")
    args = p.parse_args(argv)
    build(args.out, args.previous)


if __name__ == "__main__":
    main()
