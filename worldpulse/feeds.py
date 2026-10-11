"""Fetch and parse RSS 2.0, RSS 1.0 (RDF) and Atom feeds using only the standard library."""

from __future__ import annotations

import gzip
import html
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

USER_AGENT = "WorldPulseBot/1.0 (+https://github.com/ilicvix02/Claude; open-source news aggregator)"
MAX_BYTES = 8 * 1024 * 1024

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def fetch(url: str, timeout: float = 20.0) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
            "Accept-Encoding": "gzip",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError(f"feed larger than {MAX_BYTES} bytes")
        if resp.headers.get("Content-Encoding") == "gzip":
            data = gzip.decompress(data)
    return data


def clean_text(value: str | None, limit: int | None = None) -> str:
    if not value:
        return ""
    text = html.unescape(_TAG_RE.sub(" ", value))
    text = _WS_RE.sub(" ", text).strip()
    if limit and len(text) > limit:
        cut = text[:limit].rsplit(" ", 1)[0]
        text = cut.rstrip(",.;:-") + "…"
    return text


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        dt = None
    if dt is None:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _child(el: ET.Element, *names: str) -> ET.Element | None:
    for c in el:
        if _local(c.tag) in names:
            return c
    return None


def _text(el: ET.Element, *names: str) -> str:
    for name in names:
        c = _child(el, name)
        if c is not None and (c.text or len(c)):
            return "".join(c.itertext()).strip()
    return ""


def _atom_link(entry: ET.Element) -> str:
    fallback = ""
    for c in entry:
        if _local(c.tag) != "link":
            continue
        href = c.get("href") or (c.text or "").strip()
        if c.get("rel", "alternate") == "alternate" and href:
            return href
        fallback = fallback or href
    return fallback


def _image(item: ET.Element) -> str:
    for c in item.iter():
        name = _local(c.tag)
        if name in ("content", "thumbnail") and c.get("url") and c.get("medium", "image") == "image":
            return c.get("url")
        if name == "enclosure" and (c.get("type") or "").startswith("image") and c.get("url"):
            return c.get("url")
    return ""


def parse(data: bytes) -> list[dict]:
    """Return a list of raw entries: title, link, summary, published (datetime|None), image, tags."""
    root = ET.fromstring(data)
    items = [el for el in root.iter() if _local(el.tag) in ("item", "entry")]
    out = []
    for item in items:
        is_atom = _local(item.tag) == "entry"
        title = clean_text(_text(item, "title"))
        link = _atom_link(item) if is_atom else (_text(item, "link") or _text(item, "guid"))
        if not title or not link.startswith(("http://", "https://")):
            continue
        summary = _text(item, "summary", "description", "content", "encoded")
        published = parse_date(_text(item, "published", "pubdate", "updated", "date", "issued"))
        tags = [clean_text("".join(c.itertext())) or c.get("term", "") for c in item if _local(c.tag) in ("category", "subject")]
        out.append(
            {
                "title": title,
                "link": link.strip(),
                "summary": clean_text(summary, 320),
                "published": published,
                "image": _image(item),
                "tags": [t for t in tags if t],
            }
        )
    return out
