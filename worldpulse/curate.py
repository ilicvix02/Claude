"""Turn thousands of raw headlines into a short list of curated news items.

The 1000+ feeds are raw input. Each build groups their stories into events (cluster.assign), ranks
the events by importance and publishes only the top ones as news items (api/v1/news.json), each
citing its sources. With AI on, every new item gets a neutral headline and summary written from all
of its reports, in every app language at once; without AI (or over budget) the item uses its lead
report's own headline, and the app shows it only to readers of that language.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta

CRISIS_CATS = {"crises", "conflict", "deals"}


def _ts(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp.replace("Z", "+00:00"))


def group(articles: list[dict], now: datetime, window_hours: int = 36) -> list[list[dict]]:
    """Events (lists of member stories, newest first) whose newest report is within the window."""
    cutoff = now - timedelta(hours=window_hours)
    groups: dict[str, list[dict]] = {}
    for a in articles:  # articles are newest first, so members stay newest first
        groups.setdefault(a.get("cluster") or a["id"], []).append(a)
    return [m for m in groups.values() if _ts(m[0]["published_at"]) >= cutoff]


def score(members: list[dict], now: datetime, source_meta: dict[str, dict]) -> float:
    """Importance of one event: breadth of coverage (sources, countries, languages), official
    confirmation, conflict severity, crisis/deal topics, and freshness."""
    sources = {m["source"]["id"] for m in members}
    countries = {(source_meta.get(s) or {}).get("country") or "int" for s in sources}
    langs = {m.get("lang", "en") for m in members}
    official = any((source_meta.get(s) or {}).get("type") == "official" for s in sources)
    severity = max((m.get("severity") or 0) for m in members)
    cats = set().union(*(set(m.get("categories") or []) for m in members))
    theaters = any(m.get("theaters") for m in members)
    age_h = max(0.0, (now - _ts(members[0]["published_at"])).total_seconds() / 3600)
    return (3.0 * math.log2(1 + len(sources)) + 1.5 * math.log2(1 + len(countries)) + 1.0 * (len(langs) - 1)
            + (2.0 if official else 0) + 1.5 * severity + (1.0 if cats & CRISIS_CATS else 0) + (1.0 if theaters else 0)
            - age_h / 6)


def event_id(members: list[dict]) -> str:
    """Stable id: the earliest report's id, so the item keeps its id (and its cached AI text and
    translations) while newer reports join the event."""
    return "e" + min(members, key=lambda m: (m["published_at"], m["id"]))["id"]


def make_item(members: list[dict], now: datetime, source_meta: dict[str, dict], value: float) -> dict:
    lead = members[0]
    srcs, seen = [], set()
    for m in members:
        sid = m["source"]["id"]
        if sid in seen:
            continue
        seen.add(sid)
        meta = source_meta.get(sid) or {}
        srcs.append({"id": sid, "name": m["source"]["name"], "url": m["url"], "title": m["title"], "lang": m.get("lang", "en"),
                     "country": meta.get("country"), "type": meta.get("type", "news"), "published_at": m["published_at"]})
    cats, regions, theaters = [], [], []
    for m in members:
        cats += [c for c in m.get("categories") or [] if c not in cats]
        regions += [r for r in m.get("regions") or [] if r not in regions]
        theaters += [t for t in m.get("theaters") or [] if t not in theaters]
    official = next((s for s in srcs if s["type"] == "official"), None)
    return {
        "id": event_id(members),
        "cluster": None,  # filled in below: every item is its own lead
        "title": lead["title"],
        "summary": lead.get("summary") or "",
        "lang": lead.get("lang", "en"),
        "url": lead["url"],
        "source": lead["source"],
        "image": next((m["image"] for m in members if m.get("image")), None),
        "published_at": lead["published_at"],
        "first_seen": min(m["published_at"] for m in members),
        "categories": cats[:4],
        "regions": regions[:3],
        "theaters": theaters,
        "severity": max((m.get("severity") or 0) for m in members),
        "tone": lead.get("tone"),
        "signal": lead.get("signal"),
        "coverage": len(srcs),
        "countries": len({s["country"] or "int" for s in srcs}),
        "official": bool(official),
        "sources": srcs[:8],
        "members": [m["id"] for m in members][:40],
        "score": round(value, 2),
        "written_by": "rules",
    }


def select(articles: list[dict], now: datetime, source_meta: dict[str, dict], limit: int = 40,
           per_theater: int = 4, window_hours: int = 36) -> list[dict]:
    """The top ``limit`` events plus up to ``per_theater`` per tracked conflict (so every conflict
    page has curated items), as news items sorted by importance."""
    ranked = sorted(((score(m, now, source_meta), m) for m in group(articles, now, window_hours)),
                    key=lambda x: x[0], reverse=True)
    chosen = ranked[:limit]
    per: dict[str, int] = {}
    for value, m in chosen:
        for t in {t for x in m for t in x.get("theaters") or []}:
            per[t] = per.get(t, 0) + 1
    for value, m in ranked[limit:]:
        ts = {t for x in m for t in x.get("theaters") or []}
        if any(per.get(t, 0) < per_theater for t in ts):
            chosen.append((value, m))
            for t in ts:
                per[t] = per.get(t, 0) + 1
    items = [make_item(m, now, source_meta, v) for v, m in chosen]
    for it in items:
        it["cluster"] = it["id"]
    return items


CACHED = ("title", "summary", "lang", "title_i18n", "summary_i18n", "story_brief", "written_by", "ai_model", "written_coverage")


def reuse(items: list[dict], previous: list[dict]) -> None:
    """Carry AI-written text and translations over from the last build, per item id, forever:
    an event is rewritten only when its coverage has at least doubled since it was written."""
    old = {p["id"]: p for p in previous if isinstance(p, dict) and "id" in p}
    for it in items:
        p = old.get(it["id"])
        if not p:
            continue
        if p.get("written_by") == "ai" and it["coverage"] >= 2 * max(1, p.get("written_coverage") or 1) and it["coverage"] >= 4:
            keep = ("story_brief",)  # rewrite the item, keep nothing else
        else:
            keep = CACHED
        it.update({k: p[k] for k in keep if p.get(k)})


def needs_writing(items: list[dict], limit: int) -> list[dict]:
    return [it for it in items if it.get("written_by") != "ai"][:limit]
