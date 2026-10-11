"""Group articles from different outlets that report the same event.

Uses token-set overlap of headlines within a 48h window; cheap, deterministic, and good
enough to say "covered by 5 outlets" and to pick one lead story per event.
"""

from __future__ import annotations

import re
from datetime import datetime

_STOP = set(
    """a an and are as at be been but by for from has have he her his how in into is it its of on or
    over says said she than that the their them they this to up was we were what when who will with
    after about new more amid could would can not no out under against via why you your our live latest
    news update updates report reports least just still back calls call make makes made many most other
    some say first two three one year years day week video watch analysis opinion""".split()
)


def tokens(title: str) -> frozenset[str]:
    words = re.findall(r"[a-z0-9]+", title.lower().replace("’", "'").replace("'s ", " "))
    out = set()
    for w in words:
        if w in _STOP or len(w) < 3:
            continue
        if len(w) > 4 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        out.add(w)
    return frozenset(out)


def similar(a: frozenset, b: frozenset) -> bool:
    shared = len(a & b)
    if shared < 3:
        return False
    return shared / len(a | b) >= 0.34 or shared >= 5


def assign(articles: list[dict], window_hours: int = 48) -> list[dict]:
    """Set ``cluster`` (lead article id) and ``coverage`` (distinct sources) on each article.

    ``articles`` must be sorted newest first. The newest article in a cluster is its lead,
    so the headline shown for an event is the most up to date one.
    """
    parent = list(range(len(articles)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    toks = [tokens(a["title"]) for a in articles]
    times = [datetime.fromisoformat(a["published_at"].replace("Z", "+00:00")).timestamp() for a in articles]
    window = window_hours * 3600
    for i in range(len(articles)):
        for j in range(i + 1, len(articles)):
            if times[i] - times[j] > window:
                break  # sorted newest first: everything further is older still
            if articles[i]["source"]["id"] == articles[j]["source"]["id"]:
                continue
            if similar(toks[i], toks[j]):
                ri, rj = find(i), find(j)
                if ri != rj:
                    parent[max(ri, rj)] = min(ri, rj)  # lower index = newer = lead

    groups: dict[int, list[int]] = {}
    for i in range(len(articles)):
        groups.setdefault(find(i), []).append(i)
    for root, members in groups.items():
        sources = {articles[m]["source"]["id"] for m in members}
        for m in members:
            articles[m]["cluster"] = articles[root]["id"]
            articles[m]["coverage"] = len(sources)
    return articles
