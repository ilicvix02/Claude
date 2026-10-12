"""Conflict theater tracking: rule-based tagging, severity, signals and per-theater metrics.

Rules give every story a baseline; when AI analysis is enabled its per-article judgements
(theaters, severity, signal) replace the rule values for that story.
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timedelta

SIGNALS = ["escalation", "de-escalation", "humanitarian", "diplomatic", "none"]

_SIGNAL_WORDS = {
    "escalation": [
        "attack*", "airstrike*", "air strike*", "strike*", "shelling", "shelled", "offensive", "missile*",
        "drone*", "bombard*", "bombing*", "killed", "kills", "dead", "massacre", "invasion", "invade*",
        "clashes", "fighting", "advance*", "captured", "seize*", "mobili*", "escalat*", "incursion*",
        "ambush*", "raid*", "explosion*", "assault",
    ],
    "de-escalation": [
        "ceasefire", "cease-fire", "truce", "peace deal", "peace talks", "peace plan", "peace agreement",
        "prisoner exchange", "prisoner swap", "hostage release", "released hostages", "withdraw*",
        "de-escalat*", "armistice", "pullback", "disarm*",
    ],
    "humanitarian": [
        "humanitarian", "aid", "famine", "starvation", "hunger", "displaced", "refugee*", "cholera",
        "malnutrition", "evacuat*", "civilians", "shelter*",
    ],
    "diplomatic": [
        "talks", "summit*", "envoy*", "negotiat*", "sanction*", "diplomat*", "mediat*", "resolution",
        "security council", "minister*",
    ],
}
_CASUALTY = re.compile(r"\b(killed|kills|dead|deaths|death toll|massacre|casualt\w*|wounded|injured)\b", re.I)
_SCALE = re.compile(r"\b(dozens|hundreds|thousands|scores|mass)\b|\b\d{2,}\s+(?:people|civilians|killed|dead|soldiers)", re.I)


def _kw(words: list[str]) -> re.Pattern:
    parts = []
    for w in words:
        body = re.escape(w.rstrip("*")).replace(r"\ ", r"\s+")
        parts.append(rf"\b{body}\w*" if w.endswith("*") else rf"\b{body}\b")
    return re.compile("|".join(parts), re.I)


_SIGNAL_RE = {k: _kw(v) for k, v in _SIGNAL_WORDS.items()}


def _term(term: str) -> re.Pattern:
    # Capitalised terms are proper nouns (case-sensitive); lowercase terms match any case.
    flags = 0 if term != term.lower() else re.I
    return re.compile(r"(?<![\w.])" + re.escape(term) + r"(?![\w])", flags)


class Theaters:
    def __init__(self, theaters: list[dict]):
        self.items = theaters
        self.by_id = {t["id"]: t for t in theaters}
        self._names = {}
        self._pairs = {}
        for t in theaters:
            alts = sorted((re.escape(n) for n in t.get("names", [])), key=len, reverse=True)
            self._names[t["id"]] = re.compile(r"(?<![\w.])(?:" + "|".join(alts) + r")(?![\w])") if alts else None
            self._pairs[t["id"]] = [[_term(x) for x in pair] for pair in t.get("pairs", [])]

    def ids(self) -> list[str]:
        return [t["id"] for t in self.items]

    def match(self, title: str, summary: str) -> list[str]:
        """Theaters a story is about: a title mention, or two mentions in the excerpt."""
        out = []
        for tid in self.ids():
            pattern = self._names[tid]
            score = 0
            if pattern:
                score = 2 * len(pattern.findall(title)) + len(pattern.findall(summary))
            text = f"{title} {summary}"
            if score < 2 and any(all(p.search(text) for p in pair) for pair in self._pairs[tid]):
                score = 2
            if score >= 2:
                out.append(tid)
        # The broadest match (e.g. India-Pakistan vs Kashmir-only) is fine; cap noise at three theaters.
        return out[:3]


def rule_signal(title: str, summary: str) -> str:
    scores = {k: 2 * len(p.findall(title)) + len(p.findall(summary)) for k, p in _SIGNAL_RE.items()}
    # De-escalation words are rarer and more specific, so they win ties against escalation.
    order = ["de-escalation", "escalation", "humanitarian", "diplomatic"]
    best = max(order, key=lambda k: (scores[k], -order.index(k)))
    return best if scores[best] >= 2 else "none"


def rule_severity(title: str, summary: str, signal: str) -> int:
    text = f"{title} {summary}"
    sev = 1
    if signal == "escalation":
        sev += 1
    if _CASUALTY.search(text):
        sev += 1
    if _SCALE.search(text):
        sev += 1
    if signal == "de-escalation":
        sev -= 1
    return max(0, min(5, sev))


def annotate(article: dict, theaters: Theaters) -> dict:
    """Add rule-based conflict fields to an article (in place) and return it."""
    tids = theaters.match(article["title"], article["summary"])
    if tids or "conflict" in article["categories"]:
        signal = rule_signal(article["title"], article["summary"])
        severity = rule_severity(article["title"], article["summary"], signal)
    else:
        signal, severity = "none", 0
    article.update({"theaters": tids, "signal": signal, "severity": severity})
    article.setdefault("insight", None)
    article.setdefault("analysis", "rules")
    return article


# ---------------------------------------------------------------------------
# metrics


def _from_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def intensity(severity_sum: float) -> int:
    """Map summed 24h severity to 0-100 with diminishing returns (≈63 at 20, ≈86 at 40)."""
    return round(100 * (1 - math.exp(-severity_sum / 20)))


def status(level: int) -> str:
    if level >= 75:
        return "critical"
    if level >= 50:
        return "high"
    if level >= 25:
        return "elevated"
    return "watch" if level > 0 else "quiet"


def trend(sev_24h: float, prior_daily: float | None, stories_24h: int, esc: int, deesc: int) -> str:
    """Direction of the last 24h against the theater's own baseline.

    ``prior_daily`` is None until the archive has observed at least one full prior day; until
    then only an overwhelming balance of escalation reports counts as escalating.
    """
    if stories_24h == 0:
        return "quiet"
    if deesc >= 2 and deesc > esc:
        return "de-escalating"
    if prior_daily is None:
        return "escalating" if esc >= 5 and esc >= 3 * max(deesc, 1) else "steady"
    if prior_daily == 0:
        return "escalating" if stories_24h >= 3 and esc > deesc else "steady"
    ratio = sev_24h / prior_daily
    if ratio >= 1.4 and stories_24h >= 3 and esc >= deesc:
        return "escalating"
    if ratio <= 0.6:
        return "de-escalating"
    return "steady"


def observed_since(articles: list[dict]) -> datetime | None:
    """When the archive started watching: the earliest first-fetch time of any story."""
    stamps = [a["fetched_at"] for a in articles if a.get("fetched_at")]
    return _from_iso(min(stamps)) if stamps else None


def theater_metrics(theater: dict, articles: list[dict], now: datetime, since: datetime | None = None) -> dict:
    tid = theater["id"]
    items = [a for a in articles if tid in a.get("theaters", [])]
    day_ago = now - timedelta(hours=24)
    recent = [a for a in items if _from_iso(a["published_at"]) >= day_ago]
    sev_24h = sum(a.get("severity", 0) for a in recent)
    # Baseline: only days the archive actually watched, so a feed's backlog doesn't skew it.
    prior_daily = None
    if since is not None:
        prior_days = min(6.0, (day_ago - since).total_seconds() / 86400)
        if prior_days >= 1:
            prior = [a for a in items if since <= _from_iso(a["published_at"]) < day_ago]
            prior_daily = sum(a.get("severity", 0) for a in prior) / prior_days
    signals = {s: sum(a.get("signal") == s for a in recent) for s in SIGNALS if s != "none"}

    history = []
    for offset in range(6, -1, -1):
        start = (now - timedelta(days=offset)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
        ds = [a for a in items if start <= _from_iso(a["published_at"]) < end]
        history.append({"date": start.date().isoformat(), "stories": len(ds), "severity": sum(a.get("severity", 0) for a in ds)})

    level = intensity(sev_24h)
    return {
        "id": tid,
        "name": theater["name"],
        "spoken": theater.get("spoken", theater["name"]),
        "region": theater["region"],
        "lat": theater["lat"],
        "lon": theater["lon"],
        "description": theater["description"],
        "i18n": theater.get("i18n") or {},
        "intensity": level,
        "status": status(level),
        "trend": trend(sev_24h, prior_daily, len(recent), signals["escalation"], signals["de-escalation"]),
        "stories_24h": len(recent),
        "stories_7d": len(items),
        "severity_24h": sev_24h,
        "signals_24h": signals,
        "history": history,
    }
