"""Pick the stories that matter most and build rule-based briefs (used when AI is off or fails)."""

from __future__ import annotations

from datetime import datetime, timedelta


def _age_hours(a: dict, now: datetime) -> float:
    return (now - datetime.fromisoformat(a["published_at"].replace("Z", "+00:00"))).total_seconds() / 3600


def story_score(a: dict, now: datetime) -> float:
    score = 2.0 * a.get("coverage", 1) + 1.5 * a.get("severity", 0)
    if "crises" in a["categories"] or "deals" in a["categories"]:
        score += 1.5
    if a.get("theaters"):
        score += 1
    if len(a["title"].split()) < 4:  # "Morning recap", "Live updates": low information
        score -= 4
    return score - _age_hours(a, now) / 8  # gently prefer recent stories


def top_stories(articles: list[dict], now: datetime, limit: int = 40) -> list[dict]:
    """Lead article of each event in the last 24h, most significant first."""
    day_ago = now - timedelta(hours=24)
    leads = [
        a for a in articles
        if a.get("cluster", a["id"]) == a["id"]
        and datetime.fromisoformat(a["published_at"].replace("Z", "+00:00")) >= day_ago
    ]
    leads.sort(key=lambda a: story_score(a, now), reverse=True)
    return leads[:limit]


def story_digest(a: dict) -> dict:
    """Compact view of a story for the AI brief prompt."""
    return {
        "id": a["id"],
        "headline": a["title"],
        "excerpt": a["summary"][:240],
        "source": a["source"]["name"],
        "outlets": a.get("coverage", 1),
        "published_at": a["published_at"],
        "topics": a["categories"],
        "theaters": a.get("theaters", []),
        "severity": a.get("severity", 0),
        "signal": a.get("signal", "none"),
    }


def rule_brief(stories: list[dict], theaters: list[dict], mood: str) -> dict:
    active = [t for t in theaters if t["stories_24h"]]
    escalating = [t for t in active if t["trend"] == "escalating"]
    headline = f"{mood} day: {len(active)} conflicts in the news"
    if escalating:
        headline += f", {len(escalating)} escalating"
    bullets = []
    for s in stories[:5]:
        bullets.append({"text": s["title"], "story_ids": [s["id"]]})
    hottest = max(active, key=lambda t: t["intensity"], default=None)
    watch = f"{hottest['name']}: {hottest['stories_24h']} reports in the last 24 hours, trend {hottest['trend']}." if hottest else None
    return {"headline": headline, "bullets": bullets, "watch": watch}


def rule_theater_summary(stats: dict, latest: list[dict]) -> dict:
    if not stats["stories_24h"]:
        text = f"No new reports in the last 24 hours. {stats['stories_7d']} reports over the past week."
    else:
        text = f"{stats['stories_24h']} reports in the last 24 hours and {stats['stories_7d']} this week. Trend: {stats['trend']}."
    return {"summary": text, "outlook": None, "developments": [{"text": a["title"], "story_id": a["id"]} for a in latest[:3]]}
