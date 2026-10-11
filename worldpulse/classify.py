"""Transparent, rule-based topic and region tagging.

Rules are plain keyword lists so anyone can audit or improve them. A trailing ``*``
marks a stem (``sanction*`` matches "sanctions", "sanctioned").
"""

from __future__ import annotations

import re

CATEGORIES: dict[str, dict] = {
    "deals": {
        "label": "Deals",
        "description": "Agreements, treaties, trade pacts, mergers, acquisitions, investments and ceasefires.",
        "keywords": [
            "deal*", "agreement*", "accord*", "treat*", "pact*", "merger*", "merge*", "acquisition*",
            "acquire*", "takeover*", "buyout*", "partnership*", "memorandum", "MoU", "signs", "signed",
            "contract*", "joint venture", "IPO", "investment*", "invests", "invest", "stake",
            "ceasefire", "truce", "peace talks", "peace plan", "framework", "tariff deal", "trade deal",
            "free trade", "bailout", "loan", "funding", "pledge*", "settlement",
        ],
    },
    "crises": {
        "label": "Crises",
        "description": "Wars, disasters, outbreaks, humanitarian emergencies, coups and economic shocks.",
        "keywords": [
            "crisis", "crises", "emergency", "war", "wars", "attack*", "killed", "kills", "dead", "deaths",
            "death toll", "casualt*", "massacre", "bomb*", "airstrike*", "strike*", "missile*", "shelling",
            "invasion", "earthquake*", "quake", "flood*", "cyclone*", "hurricane*", "typhoon*", "tsunami",
            "wildfire*", "drought*", "famine", "starvation", "outbreak*", "epidemic", "pandemic", "cholera",
            "ebola", "mpox", "refugee*", "displaced", "evacuat*", "humanitarian", "coup", "unrest",
            "riot*", "collapse*", "default*", "recession", "hostage*", "terror*", "violence", "volcan*",
            "landslide*", "shortage*", "blackout*",
        ],
    },
    "conflict": {
        "label": "Conflict & Security",
        "description": "Armed conflict, military action, terrorism and security.",
        "keywords": [
            "war", "wars", "military", "troops", "army", "airstrike*", "missile*", "drone*", "rebel*",
            "militant*", "insurgen*", "shelling", "offensive", "invasion", "ceasefire", "truce", "nato",
            "hamas", "hezbollah", "terror*", "soldier*", "frontline", "weapons", "nuclear", "gunmen",
            "armed", "fighting", "clashes",
        ],
    },
    "disasters": {
        "label": "Disasters",
        "description": "Natural hazards and disaster alerts.",
        "keywords": [
            "earthquake*", "quake", "flood*", "cyclone*", "hurricane*", "typhoon*", "tsunami", "wildfire*",
            "drought*", "volcan*", "landslide*", "storm*", "heatwave*", "tornado*", "eruption",
        ],
    },
    "humanitarian": {
        "label": "Humanitarian",
        "description": "Aid, refugees, famine, displacement and human rights.",
        "keywords": [
            "humanitarian", "aid", "refugee*", "displaced", "famine", "hunger", "malnutrition", "unhcr",
            "unicef", "wfp", "ocha", "red cross", "asylum", "migrant*", "human rights", "relief",
        ],
    },
    "economy": {
        "label": "Economy & Markets",
        "description": "Markets, trade, inflation, central banks, companies and jobs.",
        "keywords": [
            "economy", "economic*", "market*", "stocks", "shares", "inflation", "interest rate*",
            "central bank", "federal reserve", "Fed", "ECB", "gdp", "trade", "tariff*", "exports",
            "imports", "oil price*", "opec", "bank*", "investor*", "earnings", "profit*", "revenue",
            "debt", "bond*", "currency", "dollar", "jobs", "unemployment", "IMF", "world bank",
        ],
    },
    "diplomacy": {
        "label": "Diplomacy",
        "description": "Summits, talks, sanctions, elections and international relations.",
        "keywords": [
            "summit*", "talks", "diplomat*", "minister*", "president", "sanction*", "embassy",
            "envoy", "un security council", "united nations", "g7", "g20", "brics", "foreign policy",
            "bilateral", "negotiat*", "election*", "parliament", "prime minister",
        ],
    },
    "climate": {
        "label": "Climate & Energy",
        "description": "Climate change, emissions, energy transition and the environment.",
        "keywords": [
            "climate", "emission*", "carbon", "net zero", "renewable*", "solar", "wind power",
            "fossil fuel*", "coal", "cop2*", "cop3*", "global warming", "heatwave*", "deforestation",
            "biodiversity", "energy", "lng", "pipeline*",
        ],
    },
    "health": {
        "label": "Health",
        "description": "Public health, outbreaks, medicine and health systems.",
        "keywords": [
            "health", "WHO", "world health organization", "outbreak*", "virus", "vaccin*", "disease*", "cholera", "ebola", "mpox",
            "measles", "malaria", "pandemic", "epidemic", "hospital*", "patients", "medic*",
        ],
    },
    "tech": {
        "label": "Technology",
        "description": "AI, chips, cybersecurity and big tech.",
        "keywords": [
            "artificial intelligence", "AI", "chip*", "semiconductor*", "cyber*", "hack*", "tech",
            "technology", "software", "data centre*", "data center*", "satellite*", "space",
        ],
    },
}

REGIONS: dict[str, dict] = {
    "africa": {
        "label": "Africa",
        "names": [
            "Africa", "African", "Algeria", "Angola", "Benin", "Botswana", "Burkina Faso", "Burundi",
            "Cameroon", "Cape Verde", "Central African Republic", "Chad", "Comoros", "Congo", "DRC",
            "Djibouti", "Egypt", "Egyptian", "Equatorial Guinea", "Eritrea", "Eswatini", "Ethiopia",
            "Ethiopian", "Gabon", "Gambia", "Ghana", "Guinea", "Ivory Coast", "Côte d'Ivoire", "Kenya",
            "Kenyan", "Lesotho", "Liberia", "Libya", "Madagascar", "Malawi", "Mali", "Mauritania",
            "Mauritius", "Morocco", "Mozambique", "Namibia", "Niger", "Nigeria", "Nigerian", "Rwanda",
            "Senegal", "Sierra Leone", "Somalia", "Somali", "Somaliland", "South Africa", "South Sudan",
            "Sudan", "Sudanese", "Tanzania", "Togo", "Tunisia", "Uganda", "Zambia", "Zimbabwe", "Sahel",
            "Darfur", "Khartoum", "Nairobi", "Lagos", "Addis Ababa",
        ],
    },
    "asia": {
        "label": "Asia",
        "names": [
            "Asia", "Asian", "Afghanistan", "Afghan", "Taliban", "Bangladesh", "Bhutan", "Brunei",
            "Cambodia", "China", "Chinese", "Beijing", "Hong Kong", "India", "Indian", "Delhi",
            "Indonesia", "Japan", "Japanese", "Tokyo", "Kazakhstan", "Kyrgyzstan", "Laos", "Malaysia",
            "Maldives", "Mongolia", "Myanmar", "Nepal", "North Korea", "Pyongyang", "Pakistan",
            "Pakistani", "Philippines", "Filipino", "Singapore", "South Korea", "Seoul", "Korea",
            "Sri Lanka", "Taiwan", "Taipei", "Tajikistan", "Thailand", "Thai", "Timor-Leste",
            "Turkmenistan", "Uzbekistan", "Vietnam", "Kashmir", "Asean",
        ],
    },
    "europe": {
        "label": "Europe",
        "names": [
            "Europe", "European", "EU", "Brussels", "Albania", "Austria", "Belarus", "Belgium", "Bosnia",
            "Bulgaria", "Croatia", "Cyprus", "Czech", "Denmark", "Danish", "Estonia", "Finland", "France",
            "French", "Paris", "Germany", "German", "Berlin", "Greece", "Greek", "Hungary", "Iceland",
            "Ireland", "Irish", "Italy", "Italian", "Rome", "Kosovo", "Latvia", "Lithuania", "Luxembourg",
            "Malta", "Moldova", "Montenegro", "Netherlands", "Dutch", "North Macedonia", "Norway",
            "Poland", "Polish", "Portugal", "Romania", "Russia", "Russian", "Moscow", "Kremlin", "Putin",
            "Serbia", "Slovakia", "Slovenia", "Spain", "Spanish", "Sweden", "Swedish", "Switzerland",
            "Swiss", "Ukraine", "Ukrainian", "Kyiv", "Zelensky", "UK", "Britain", "British", "London",
            "England", "Scotland", "Wales", "Georgia", "Armenia", "Azerbaijan",
        ],
    },
    "middle-east": {
        "label": "Middle East",
        "names": [
            "Middle East", "Bahrain", "Iran", "Iranian", "Tehran", "Iraq", "Iraqi", "Baghdad", "Israel",
            "Israeli", "Jerusalem", "Netanyahu", "Gaza", "West Bank", "Palestine", "Palestinian", "Hamas",
            "Hezbollah", "Jordan", "Kuwait", "Lebanon", "Lebanese", "Beirut", "Oman", "Qatar", "Doha",
            "Saudi", "Riyadh", "Syria", "Syrian", "Damascus", "Turkey", "Türkiye", "Turkish", "Ankara",
            "Erdogan", "UAE", "Emirates", "Dubai", "Abu Dhabi", "Yemen", "Houthi", "Houthis", "Red Sea",
        ],
    },
    "americas": {
        "label": "Americas",
        "names": [
            "US", "U.S.", "USA", "United States", "American", "America", "Washington", "White House",
            "Trump", "Congress", "Pentagon", "Canada", "Canadian", "Mexico", "Mexican", "Argentina",
            "Bolivia", "Brazil", "Brazilian", "Chile", "Colombia", "Colombian", "Costa Rica", "Cuba",
            "Cuban", "Dominican Republic", "Ecuador", "El Salvador", "Guatemala", "Haiti", "Haitian",
            "Honduras", "Jamaica", "Nicaragua", "Panama", "Paraguay", "Peru", "Uruguay", "Venezuela",
            "Venezuelan", "Caribbean", "Latin America",
        ],
    },
    "oceania": {
        "label": "Oceania",
        "names": [
            "Australia", "Australian", "New Zealand", "Fiji", "Papua New Guinea", "Samoa", "Tonga",
            "Vanuatu", "Solomon Islands", "Pacific Islands", "Canberra", "Sydney",
        ],
    },
}


# Stories that are off-topic for a "state of the world" feed (sport, celebrity, lifestyle).
EXCLUDE = [
    "football", "soccer", "premier league", "la liga", "serie a", "bundesliga", "champions league",
    "super lig", "el clasico", "red card", "striker", "goalkeeper", "midfielder", "hat-trick", "tennis",
    "wimbledon", "grand slam", "golf", "cricket", "rugby", "formula 1", "formula one", "grand prix",
    "nba", "nfl", "olympic*", "world cup", "match report", "celebrity", "box office", "recipe*",
    "horoscope*", "in pictures", "quiz",
]


def _compile_keywords(words: list[str]) -> re.Pattern:
    parts = []
    for w in words:
        stem = w.endswith("*")
        body = re.escape(w.rstrip("*")).replace(r"\ ", r"\s+")
        body = rf"\b{body}\w*" if stem else rf"\b{body}\b"
        # Keywords written with capitals (WHO, AI, Fed) are acronyms: match case-sensitively.
        parts.append(f"(?-i:{body})" if w != w.lower() else body)
    return re.compile("|".join(parts), re.IGNORECASE)


def _compile_names(names: list[str]) -> re.Pattern:
    # Case-sensitive so "us" or "chad" in ordinary prose don't count as places.
    alts = sorted((re.escape(n) for n in names), key=len, reverse=True)
    return re.compile(r"(?<![\w.])(?:" + "|".join(alts) + r")(?![\w])")


_CAT_RE = {slug: _compile_keywords(c["keywords"]) for slug, c in CATEGORIES.items()}
_REGION_RE = {slug: _compile_names(r["names"]) for slug, r in REGIONS.items()}
_EXCLUDE_RE = _compile_keywords(EXCLUDE)


def is_off_topic(title: str, summary: str) -> bool:
    return bool(_EXCLUDE_RE.search(f"{title} {summary}")) or not is_latin_script(title)


def is_latin_script(text: str) -> bool:
    """The rules and the app are English-language; skip headlines in other scripts (e.g. Arabic editions)."""
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    latin = sum(1 for c in letters if c.isascii() or "\u00c0" <= c <= "\u024f")
    return latin / len(letters) >= 0.6


def score_categories(title: str, summary: str) -> dict[str, int]:
    scores = {}
    for slug, pattern in _CAT_RE.items():
        s = 2 * len(pattern.findall(title)) + len(pattern.findall(summary))
        if s:
            scores[slug] = s
    return scores


def categorize(title: str, summary: str, forced: list[str] | None = None) -> list[str]:
    scores = score_categories(title, summary)
    cats = {slug for slug, s in scores.items() if s >= 2}
    # Topic-level crisis/deal signals imply the pillar even when the pillar words are absent.
    if cats & {"conflict", "disasters", "humanitarian"} and scores.get("crises", 0) >= 1:
        cats.add("crises")
    cats.update(forced or [])
    order = list(CATEGORIES)
    return sorted(cats, key=order.index)


def regions(title: str, summary: str) -> list[str]:
    text = f"{title} {summary}"
    return [slug for slug, pattern in _REGION_RE.items() if pattern.search(text)]


def sentiment(categories: list[str]) -> str:
    """Coarse tone label: 'crisis', 'deal', 'mixed' or 'neutral'."""
    c, d = "crises" in categories, "deals" in categories
    if c and d:
        return "mixed"
    return "crisis" if c else "deal" if d else "neutral"
