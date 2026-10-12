#!/usr/bin/env python3
"""Discover and verify news and official-announcement feeds, then rewrite config/sources.json.

Candidates come from: the current config/sources.json, a curated list of wire services, public
broadcasters, governments, UN agencies, central banks and NGOs (below), feed families that exist
for many countries or languages (ReliefWeb country updates, Google News editions, BBC/DW/VOA/RFE-RL/
Global Voices language services, GOV.UK departments) and the public awesome-rss-feeds country OPMLs.

Every candidate is fetched (concurrently, a few connections per host) and kept only when it parses as
RSS/Atom with at least one item dated within --max-age-days. Each kept source carries lang, country
(ISO 3166 alpha-2, "int" for international bodies) and type ("news" or "official").

    python scripts/find_sources.py            # verify and write config/sources.json
    python scripts/find_sources.py --dry-run  # report only
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from worldpulse import feeds  # noqa: E402

OPML = "https://raw.githubusercontent.com/plenaryapp/awesome-rss-feeds/master/countries/with_category/{}.opml"
OPML_COUNTRIES = {
    "Australia": ("au", "en"), "Bangladesh": ("bd", "en"), "Brazil": ("br", "pt"), "Canada": ("ca", "en"),
    "France": ("fr", "fr"), "Germany": ("de", "de"), "Hong Kong SAR China": ("hk", "en"), "India": ("in", "en"),
    "Indonesia": ("id", "id"), "Iran": ("ir", "en"), "Ireland": ("ie", "en"), "Italy": ("it", "it"),
    "Japan": ("jp", "ja"), "Mexico": ("mx", "es"), "Nigeria": ("ng", "en"), "Pakistan": ("pk", "en"),
    "Philippines": ("ph", "en"), "Poland": ("pl", "pl"), "Russia": ("ru", "ru"), "South Africa": ("za", "en"),
    "Spain": ("es", "es"), "Ukraine": ("ua", "uk"), "United Kingdom": ("gb", "en"), "United States": ("us", "en"),
}
SKIP_WORDS = re.compile(r"sport|football|soccer|cricket|tennis|golf|entertain|celebrit|gaming|games|fashion|beauty|"
                        r"lifestyle|recipe|food|travel|movie|film|music|tv|horoscope|auto|cars|tech|gadget|photo", re.I)

# Google News editions: (gl, hl, lang, country)
GNEWS = [
    ("US", "en-US", "en", "us"), ("GB", "en-GB", "en", "gb"), ("AU", "en-AU", "en", "au"), ("CA", "en-CA", "en", "ca"),
    ("IN", "en-IN", "en", "in"), ("IE", "en-IE", "en", "ie"), ("NZ", "en-NZ", "en", "nz"), ("ZA", "en-ZA", "en", "za"),
    ("NG", "en-NG", "en", "ng"), ("KE", "en-KE", "en", "ke"), ("GH", "en-GH", "en", "gh"), ("UG", "en-UG", "en", "ug"),
    ("TZ", "en-TZ", "en", "tz"), ("ZW", "en-ZW", "en", "zw"), ("PK", "en-PK", "en", "pk"), ("BD", "en-BD", "en", "bd"),
    ("PH", "en-PH", "en", "ph"), ("SG", "en-SG", "en", "sg"), ("MY", "en-MY", "en", "my"), ("IL", "en-IL", "en", "il"),
    ("DE", "de", "de", "de"), ("AT", "de", "de", "at"), ("CH", "de", "de", "ch"), ("RS", "sr", "sr", "rs"),
    ("FR", "fr", "fr", "fr"), ("BE", "fr", "fr", "be"), ("SN", "fr", "fr", "sn"), ("CI", "fr", "fr", "ci"),
    ("MA", "fr", "fr", "ma"), ("ES", "es", "es", "es"), ("MX", "es-419", "es", "mx"), ("AR", "es-419", "es", "ar"),
    ("CO", "es-419", "es", "co"), ("CL", "es-419", "es", "cl"), ("PE", "es-419", "es", "pe"), ("VE", "es-419", "es", "ve"),
    ("CU", "es-419", "es", "cu"), ("US", "es-419", "es", "us"), ("BR", "pt-BR", "pt", "br"), ("PT", "pt-PT", "pt", "pt"),
    ("IT", "it", "it", "it"), ("NL", "nl", "nl", "nl"), ("BE", "nl", "nl", "be"), ("PL", "pl", "pl", "pl"),
    ("CZ", "cs", "cs", "cz"), ("SK", "sk", "sk", "sk"), ("HU", "hu", "hu", "hu"), ("RO", "ro", "ro", "ro"),
    ("BG", "bg", "bg", "bg"), ("GR", "el", "el", "gr"), ("SI", "sl", "sl", "si"), ("HR", "hr", "hr", "hr"),
    ("LV", "lv", "lv", "lv"), ("LT", "lt", "lt", "lt"), ("SE", "sv", "sv", "se"), ("NO", "no", "no", "no"),
    ("UA", "uk", "uk", "ua"), ("RU", "ru", "ru", "ru"), ("TR", "tr", "tr", "tr"), ("IL", "he", "he", "il"),
    ("EG", "ar", "ar", "eg"), ("SA", "ar", "ar", "sa"), ("AE", "ar", "ar", "ae"), ("LB", "ar", "ar", "lb"),
    ("JP", "ja", "ja", "jp"), ("KR", "ko", "ko", "kr"), ("CN", "zh-Hans", "zh", "cn"), ("TW", "zh-Hant", "zh", "tw"),
    ("HK", "zh-Hant", "zh", "hk"), ("ID", "id", "id", "id"), ("TH", "th", "th", "th"), ("VN", "vi", "vi", "vn"),
    ("IN", "hi", "hi", "in"), ("IN", "bn", "bn", "in"), ("IN", "ta", "ta", "in"), ("ET", "en-ET", "en", "et"),
]
GNEWS_TOPICS = ["", "WORLD", "NATION", "BUSINESS", "HEALTH"]

# ReliefWeb ISO3 codes (humanitarian and official updates per country)
RELIEFWEB = """afg ago alb dza arg arm aus aut aze bgd blr bel ben btn bol bih bwa bra bfa bdi khm cmr can caf tcd chl chn col
com cod cog cri civ hrv cub cyp cze dnk dji dom ecu egy slv gnq eri est swz eth fji fin fra gab gmb geo deu gha grc gtm gin gnb
guy hti hnd hun ind idn irn irq irl isr ita jam jpn jor kaz ken prk kor kwt kgz lao lva lbn lso lbr lby ltu mdg mwi mys mdv mli
mrt mus mex mda mng mne mar moz mmr nam npl nld nzl nic ner nga mkd nor omn pak pse pan png pry per phl pol prt qat rou rus rwa
sau sen srb sle som zaf ssd esp lka sdn sur swe che syr tjk tza tha tls tgo ton tto tun tur tkm uga ukr are gbr usa ury uzb vut
ven vnm yem zmb zwe wsm slb kir fsm mhl vct lca grd dma blz bhs brb""".split()
ISO3_2 = dict(zip(RELIEFWEB, """af ao al dz ar am au at az bd by be bj bt bo ba bw br bf bi kh cm ca cf td cl cn co
km cd cg cr ci hr cu cy cz dk dj do ec eg sv gq er ee sz et fj fi fr ga gm ge de gh gr gt gn gw
gy ht hn hu in id ir iq ie il it jm jp jo kz ke kp kr kw kg la lv lb ls lr ly lt mg mw my mv ml
mr mu mx md mn me ma mz mm na np nl nz ni ne ng mk no om pk ps pa pg py pe ph pl pt qa ro ru rw
sa sn rs sl so za ss es lk sd sr se ch sy tj tz th tl tg to tt tn tr tm ug ua ae gb us uy uz vu
ve vn ye zm zw ws sb ki fm mh vc lc gd dm bz bs bb""".split()))

# BBC World Service languages: (path, lang)
BBC = [("arabic", "ar"), ("persian", "fa"), ("russian", "ru"), ("ukrainian", "uk"), ("turkce", "tr"), ("mundo", "es"),
       ("portuguese", "pt"), ("hindi", "hi"), ("urdu", "ur"), ("bengali", "bn"), ("swahili", "sw"), ("hausa", "ha"),
       ("somali", "so"), ("afrique", "fr"), ("vietnamese", "vi"), ("indonesia", "id"), ("zhongwen/simp", "zh"),
       ("japanese", "ja"), ("korean", "ko"), ("thai", "th"), ("burmese", "my"), ("nepali", "ne"), ("pashto", "ps"),
       ("uzbek", "uz"), ("kyrgyz", "ky"), ("azeri", "az"), ("amharic", "am"), ("tigrinya", "ti"), ("yoruba", "yo"),
       ("igbo", "ig"), ("pidgin", "pcm"), ("gahuza", "rw"), ("tamil", "ta"), ("telugu", "te"), ("marathi", "mr"),
       ("gujarati", "gu"), ("punjabi", "pa"), ("sinhala", "si"), ("serbian/lat", "sr"), ("serbian/cyr", "sr")]
DW = ["en", "de", "es", "fr", "pt-br", "ru", "uk", "ar", "fa-ir", "tr", "hi", "bn", "ur", "id", "zh", "sw", "ha", "am",
      "sq", "bs", "bg", "hr", "el", "mk", "pl", "ro", "sr", "ps", "dari"]
GV = ["", "de", "es", "fr", "pt", "it", "ru", "ar", "zhs", "ja", "ko", "sw", "id", "pl", "sr", "mk", "bn", "el", "nl", "fa",
      "tr", "uk", "hu", "am", "cs", "da", "fil", "hi", "ku", "mg", "ne", "ro", "sv", "ur"]
GOVUK = ["foreign-commonwealth-development-office", "ministry-of-defence", "prime-ministers-office-10-downing-street",
         "hm-treasury", "home-office", "department-of-health-and-social-care", "cabinet-office", "department-for-business-and-trade",
         "department-for-energy-security-and-net-zero", "uk-health-security-agency", "department-for-education",
         "ministry-of-justice", "department-for-transport", "department-for-environment-food-rural-affairs",
         "department-for-work-pensions", "hm-revenue-customs", "bank-of-england", "office-for-national-statistics",
         "competition-and-markets-authority", "national-crime-agency", "uk-export-finance", "british-international-investment",
         "department-for-science-innovation-and-technology", "ministry-of-housing-communities-local-government",
         "department-for-culture-media-and-sport", "northern-ireland-office", "scotland-office", "wales-office",
         "attorney-generals-office", "uk-space-agency", "met-office", "environment-agency", "maritime-and-coastguard-agency"]
UN_NEWS_LANGS = {"en": "en", "fr": "fr", "es": "es", "ar": "ar", "ru": "ru", "zh": "zh", "pt": "pt", "sw": "sw", "hi": "hi", "ur": "ur"}
UN_NEWS_TOPICS = ["peace-and-security", "humanitarian-aid", "climate-change", "health", "human-rights", "migrants-and-refugees",
                  "law-and-crime-prevention", "economic-development", "women", "un-affairs", "sdgs", "culture-and-education"]
UN_NEWS_REGIONS = ["africa", "americas", "asia-pacific", "middle-east", "europe"]

# Curated feeds: (name, url, lang, country, type). Bad URLs are simply dropped by verification.
CURATED = [
    # wire services and global broadcasters
    ("Reuters (via Google News)", "https://news.google.com/rss/search?q=site:reuters.com&hl=en-US&gl=US&ceid=US:en", "en", "int", "news"),
    ("AP News (via Google News)", "https://news.google.com/rss/search?q=site:apnews.com&hl=en-US&gl=US&ceid=US:en", "en", "int", "news"),
    ("AFP (via Google News)", "https://news.google.com/rss/search?q=AFP&hl=en-US&gl=US&ceid=US:en", "en", "int", "news"),
    ("Al Jazeera English", "https://www.aljazeera.com/xml/rss/all.xml", "en", "qa", "news"),
    ("France 24 English", "https://www.france24.com/en/rss", "en", "fr", "news"),
    ("France 24 Français", "https://www.france24.com/fr/rss", "fr", "fr", "news"),
    ("France 24 Español", "https://www.france24.com/es/rss", "es", "fr", "news"),
    ("France 24 Arabic", "https://www.france24.com/ar/rss", "ar", "fr", "news"),
    ("RFI Français", "https://www.rfi.fr/fr/rss", "fr", "fr", "news"),
    ("RFI English", "https://www.rfi.fr/en/rss", "en", "fr", "news"),
    ("RFI Español", "https://www.rfi.fr/es/rss", "es", "fr", "news"),
    ("Euronews", "https://www.euronews.com/rss", "en", "int", "news"),
    ("Euronews Deutsch", "https://de.euronews.com/rss", "de", "int", "news"),
    ("Euronews Français", "https://fr.euronews.com/rss", "fr", "int", "news"),
    ("Euronews Español", "https://es.euronews.com/rss", "es", "int", "news"),
    ("Euronews Italiano", "https://it.euronews.com/rss", "it", "int", "news"),
    ("Euronews Português", "https://pt.euronews.com/rss", "pt", "int", "news"),
    ("Euronews Русский", "https://ru.euronews.com/rss", "ru", "int", "news"),
    ("Euronews Türkçe", "https://tr.euronews.com/rss", "tr", "int", "news"),
    ("Euronews Ελληνικά", "https://gr.euronews.com/rss", "el", "int", "news"),
    ("Euronews Magyar", "https://hu.euronews.com/rss", "hu", "int", "news"),
    ("Euronews Polski", "https://pl.euronews.com/rss", "pl", "int", "news"),
    ("Euronews Arabic", "https://arabic.euronews.com/rss", "ar", "int", "news"),
    ("NHK World", "https://www3.nhk.or.jp/rss/news/cat0.xml", "ja", "jp", "news"),
    ("NHK World English", "https://www3.nhk.or.jp/nhkworld/en/news/rss.xml", "en", "jp", "news"),
    ("VOA News", "https://www.voanews.com/api/zq$omekvi_", "en", "us", "news"),
    ("RFE/RL", "https://www.rferl.org/api/", "en", "int", "news"),
    ("The Guardian World", "https://www.theguardian.com/world/rss", "en", "gb", "news"),
    ("The Guardian UK", "https://www.theguardian.com/uk-news/rss", "en", "gb", "news"),
    ("The Guardian US", "https://www.theguardian.com/us-news/rss", "en", "us", "news"),
    ("The Guardian Business", "https://www.theguardian.com/business/rss", "en", "gb", "news"),
    ("The Guardian Environment", "https://www.theguardian.com/environment/rss", "en", "gb", "news"),
    ("The Guardian Global development", "https://www.theguardian.com/global-development/rss", "en", "gb", "news"),
    ("The Guardian Africa", "https://www.theguardian.com/world/africa/rss", "en", "gb", "news"),
    ("The Guardian Middle East", "https://www.theguardian.com/world/middleeast/rss", "en", "gb", "news"),
    ("The Guardian Asia", "https://www.theguardian.com/world/asia/rss", "en", "gb", "news"),
    ("The Guardian Americas", "https://www.theguardian.com/world/americas/rss", "en", "gb", "news"),
    ("The Guardian Europe", "https://www.theguardian.com/world/europe-news/rss", "en", "gb", "news"),
    ("The Guardian Ukraine", "https://www.theguardian.com/world/ukraine/rss", "en", "gb", "news"),
    ("BBC News Top stories", "https://feeds.bbci.co.uk/news/rss.xml", "en", "gb", "news"),
    ("BBC News Africa", "https://feeds.bbci.co.uk/news/world/africa/rss.xml", "en", "gb", "news"),
    ("BBC News Asia", "https://feeds.bbci.co.uk/news/world/asia/rss.xml", "en", "gb", "news"),
    ("BBC News Europe", "https://feeds.bbci.co.uk/news/world/europe/rss.xml", "en", "gb", "news"),
    ("BBC News Latin America", "https://feeds.bbci.co.uk/news/world/latin_america/rss.xml", "en", "gb", "news"),
    ("BBC News Middle East", "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml", "en", "gb", "news"),
    ("BBC News US & Canada", "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml", "en", "gb", "news"),
    ("BBC News Business", "https://feeds.bbci.co.uk/news/business/rss.xml", "en", "gb", "news"),
    ("BBC News Health", "https://feeds.bbci.co.uk/news/health/rss.xml", "en", "gb", "news"),
    ("BBC News Science", "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", "en", "gb", "news"),
    ("BBC News Politics", "https://feeds.bbci.co.uk/news/politics/rss.xml", "en", "gb", "news"),
    ("CNN World", "http://rss.cnn.com/rss/edition_world.rss", "en", "us", "news"),
    ("CNN Top", "http://rss.cnn.com/rss/edition.rss", "en", "us", "news"),
    ("NPR News", "https://feeds.npr.org/1001/rss.xml", "en", "us", "news"),
    ("NPR World", "https://feeds.npr.org/1004/rss.xml", "en", "us", "news"),
    ("NPR Politics", "https://feeds.npr.org/1014/rss.xml", "en", "us", "news"),
    ("NPR Business", "https://feeds.npr.org/1006/rss.xml", "en", "us", "news"),
    ("New York Times World", "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", "en", "us", "news"),
    ("New York Times Home", "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", "en", "us", "news"),
    ("New York Times Middle East", "https://rss.nytimes.com/services/xml/rss/nyt/MiddleEast.xml", "en", "us", "news"),
    ("New York Times Africa", "https://rss.nytimes.com/services/xml/rss/nyt/Africa.xml", "en", "us", "news"),
    ("New York Times Asia", "https://rss.nytimes.com/services/xml/rss/nyt/AsiaPacific.xml", "en", "us", "news"),
    ("New York Times Europe", "https://rss.nytimes.com/services/xml/rss/nyt/Europe.xml", "en", "us", "news"),
    ("New York Times Americas", "https://rss.nytimes.com/services/xml/rss/nyt/Americas.xml", "en", "us", "news"),
    ("New York Times Business", "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", "en", "us", "news"),
    ("New York Times Politics", "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml", "en", "us", "news"),
    ("Washington Post World", "https://feeds.washingtonpost.com/rss/world", "en", "us", "news"),
    ("Washington Post Politics", "https://feeds.washingtonpost.com/rss/politics", "en", "us", "news"),
    ("Wall Street Journal World", "https://feeds.a.dj.com/rss/RSSWorldNews.xml", "en", "us", "news"),
    ("Wall Street Journal Markets", "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", "en", "us", "news"),
    ("CNBC World", "https://www.cnbc.com/id/100727362/device/rss/rss.html", "en", "us", "news"),
    ("CNBC Top", "https://www.cnbc.com/id/100003114/device/rss/rss.html", "en", "us", "news"),
    ("ABC News US", "https://abcnews.go.com/abcnews/internationalheadlines", "en", "us", "news"),
    ("CBS News World", "https://www.cbsnews.com/latest/rss/world", "en", "us", "news"),
    ("PBS NewsHour", "https://www.pbs.org/newshour/feeds/rss/headlines", "en", "us", "news"),
    ("Politico", "https://rss.politico.com/politics-news.xml", "en", "us", "news"),
    ("Politico Europe", "https://www.politico.eu/feed/", "en", "be", "news"),
    ("The Hill", "https://thehill.com/feed/", "en", "us", "news"),
    ("Axios", "https://api.axios.com/feed/", "en", "us", "news"),
    ("Sky News World", "https://feeds.skynews.com/feeds/rss/world.xml", "en", "gb", "news"),
    ("Sky News Home", "https://feeds.skynews.com/feeds/rss/home.xml", "en", "gb", "news"),
    ("The Independent World", "https://www.independent.co.uk/news/world/rss", "en", "gb", "news"),
    ("The Telegraph World", "https://www.telegraph.co.uk/news/rss.xml", "en", "gb", "news"),
    ("Financial Times World", "https://www.ft.com/world?format=rss", "en", "gb", "news"),
    ("The Economist", "https://www.economist.com/international/rss.xml", "en", "gb", "news"),
    ("ABC Australia", "https://www.abc.net.au/news/feed/51120/rss.xml", "en", "au", "news"),
    ("ABC Australia World", "https://www.abc.net.au/news/feed/52278/rss.xml", "en", "au", "news"),
    ("CBC World", "https://www.cbc.ca/webfeed/rss/rss-world", "en", "ca", "news"),
    ("CBC Canada", "https://www.cbc.ca/webfeed/rss/rss-canada", "en", "ca", "news"),
    ("CBC Politics", "https://www.cbc.ca/webfeed/rss/rss-politics", "en", "ca", "news"),
    ("Radio-Canada", "https://ici.radio-canada.ca/rss/4159", "fr", "ca", "news"),
    ("RNZ World", "https://www.rnz.co.nz/rss/world.xml", "en", "nz", "news"),
    ("RNZ National", "https://www.rnz.co.nz/rss/national.xml", "en", "nz", "news"),
    ("RNZ Pacific", "https://www.rnz.co.nz/rss/pacific.xml", "en", "nz", "news"),
    ("Irish Times", "https://www.irishtimes.com/arc/outboundfeeds/feed-irish-news/?outputType=xml", "en", "ie", "news"),
    ("RTÉ News", "https://www.rte.ie/feeds/rss/?index=/news/", "en", "ie", "news"),
    ("Times of India World", "https://timesofindia.indiatimes.com/rssfeeds/296589292.cms", "en", "in", "news"),
    ("The Hindu International", "https://www.thehindu.com/news/international/feeder/default.rss", "en", "in", "news"),
    ("The Hindu National", "https://www.thehindu.com/news/national/feeder/default.rss", "en", "in", "news"),
    ("Hindustan Times World", "https://www.hindustantimes.com/feeds/rss/world-news/rssfeed.xml", "en", "in", "news"),
    ("Indian Express World", "https://indianexpress.com/section/world/feed/", "en", "in", "news"),
    ("NDTV World", "https://feeds.feedburner.com/ndtvnews-world-news", "en", "in", "news"),
    ("Dawn", "https://www.dawn.com/feeds/home", "en", "pk", "news"),
    ("Express Tribune", "https://tribune.com.pk/feed/home", "en", "pk", "news"),
    ("The Daily Star Bangladesh", "https://www.thedailystar.net/frontpage/rss.xml", "en", "bd", "news"),
    ("Kathmandu Post", "https://kathmandupost.com/rss", "en", "np", "news"),
    ("Daily Mirror Sri Lanka", "https://www.dailymirror.lk/RSS_Feeds/breaking-news", "en", "lk", "news"),
    ("South China Morning Post World", "https://www.scmp.com/rss/91/feed", "en", "hk", "news"),
    ("South China Morning Post China", "https://www.scmp.com/rss/4/feed", "en", "hk", "news"),
    ("Hong Kong Free Press", "https://hongkongfp.com/feed/", "en", "hk", "news"),
    ("Taipei Times", "https://www.taipeitimes.com/xml/index.rss", "en", "tw", "news"),
    ("Focus Taiwan", "https://focustaiwan.tw/rss/aall.xml", "en", "tw", "news"),
    ("Japan Times", "https://www.japantimes.co.jp/feed/", "en", "jp", "news"),
    ("Korea Herald", "https://www.koreaherald.com/rss/020000000000.xml", "en", "kr", "news"),
    ("Yonhap English", "https://en.yna.co.kr/RSS/news.xml", "en", "kr", "news"),
    ("Korea JoongAng Daily", "https://koreajoongangdaily.joins.com/xmls/joins_rss.xml", "en", "kr", "news"),
    ("The Straits Times World", "https://www.straitstimes.com/news/world/rss.xml", "en", "sg", "news"),
    ("The Straits Times Asia", "https://www.straitstimes.com/news/asia/rss.xml", "en", "sg", "news"),
    ("CNA Asia", "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511", "en", "sg", "news"),
    ("CNA World", "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311", "en", "sg", "news"),
    ("Bangkok Post", "https://www.bangkokpost.com/rss/data/topstories.xml", "en", "th", "news"),
    ("VnExpress International", "https://e.vnexpress.net/rss/news.rss", "en", "vn", "news"),
    ("VnExpress", "https://vnexpress.net/rss/tin-moi-nhat.rss", "vi", "vn", "news"),
    ("Rappler", "https://www.rappler.com/feed/", "en", "ph", "news"),
    ("Inquirer", "https://www.inquirer.net/fullfeed", "en", "ph", "news"),
    ("Jakarta Post", "https://www.thejakartapost.com/feed", "en", "id", "news"),
    ("Antara English", "https://en.antaranews.com/rss/news.xml", "en", "id", "news"),
    ("Malay Mail", "https://www.malaymail.com/feed/rss/malaysia", "en", "my", "news"),
    ("Free Malaysia Today", "https://www.freemalaysiatoday.com/feed/", "en", "my", "news"),
    ("Irrawaddy", "https://www.irrawaddy.com/feed", "en", "mm", "news"),
    ("Khmer Times", "https://www.khmertimeskh.com/feed/", "en", "kh", "news"),
    ("Tolo News", "https://tolonews.com/rss.xml", "en", "af", "news"),
    ("Kabul Now", "https://kabulnow.com/feed/", "en", "af", "news"),
    ("Times of Israel", "https://www.timesofisrael.com/feed/", "en", "il", "news"),
    ("Jerusalem Post", "https://www.jpost.com/rss/rssfeedsheadlines.aspx", "en", "il", "news"),
    ("Haaretz", "https://www.haaretz.com/srv/haaretz-latest-headlines", "en", "il", "news"),
    ("Ynet News", "https://www.ynetnews.com/Integration/StoryRss3089.xml", "en", "il", "news"),
    ("Middle East Eye", "https://www.middleeasteye.net/rss", "en", "gb", "news"),
    ("Al-Monitor", "https://www.al-monitor.com/rss", "en", "us", "news"),
    ("Arab News", "https://www.arabnews.com/rss.xml", "en", "sa", "news"),
    ("The National UAE", "https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml", "en", "ae", "news"),
    ("Gulf News", "https://gulfnews.com/rss", "en", "ae", "news"),
    ("Khaleej Times", "https://www.khaleejtimes.com/rss", "en", "ae", "news"),
    ("Daily Sabah", "https://www.dailysabah.com/rss", "en", "tr", "news"),
    ("Hürriyet Daily News", "https://www.hurriyetdailynews.com/rss", "en", "tr", "news"),
    ("Anadolu Agency", "https://www.aa.com.tr/en/rss/default?cat=guncel", "en", "tr", "news"),
    ("Anadolu Ajansı", "https://www.aa.com.tr/tr/rss/default?cat=guncel", "tr", "tr", "news"),
    ("Tehran Times", "https://www.tehrantimes.com/rss", "en", "ir", "news"),
    ("Iran International", "https://www.iranintl.com/en/feed", "en", "gb", "news"),
    ("Rudaw", "https://www.rudaw.net/english/rss", "en", "iq", "news"),
    ("Kurdistan24", "https://www.kurdistan24.net/en/rss", "en", "iq", "news"),
    ("L'Orient Today", "https://today.lorientlejour.com/rss", "en", "lb", "news"),
    ("Ahram Online", "https://english.ahram.org.eg/rss.ashx", "en", "eg", "news"),
    ("Egypt Independent", "https://egyptindependent.com/feed/", "en", "eg", "news"),
    ("Jordan Times", "https://jordantimes.com/rss.xml", "en", "jo", "news"),
    ("Libya Observer", "https://libyaobserver.ly/rss.xml", "en", "ly", "news"),
    ("Sudan Tribune", "https://sudantribune.com/feed/", "en", "sd", "news"),
    ("Radio Dabanga", "https://www.dabangasudan.org/en/feed", "en", "sd", "news"),
    ("Addis Standard", "https://addisstandard.com/feed/", "en", "et", "news"),
    ("The Reporter Ethiopia", "https://www.thereporterethiopia.com/feed/", "en", "et", "news"),
    ("Daily Nation", "https://nation.africa/kenya/rss.xml", "en", "ke", "news"),
    ("The Standard Kenya", "https://www.standardmedia.co.ke/rss/headlines.php", "en", "ke", "news"),
    ("The Citizen Tanzania", "https://www.thecitizen.co.tz/tanzania/rss.xml", "en", "tz", "news"),
    ("Monitor Uganda", "https://www.monitor.co.ug/uganda/rss.xml", "en", "ug", "news"),
    ("New Times Rwanda", "https://www.newtimes.co.rw/rss", "en", "rw", "news"),
    ("Garowe Online", "https://www.garoweonline.com/en/rss", "en", "so", "news"),
    ("Hiiraan Online", "https://www.hiiraan.com/rss/news.xml", "en", "so", "news"),
    ("Premium Times", "https://www.premiumtimesng.com/feed", "en", "ng", "news"),
    ("Punch", "https://punchng.com/feed/", "en", "ng", "news"),
    ("Vanguard", "https://www.vanguardngr.com/feed/", "en", "ng", "news"),
    ("The Guardian Nigeria", "https://guardian.ng/feed/", "en", "ng", "news"),
    ("Channels TV", "https://www.channelstv.com/feed/", "en", "ng", "news"),
    ("GhanaWeb", "https://www.ghanaweb.com/GhanaHomePage/NewsArchive/rss.xml", "en", "gh", "news"),
    ("MyJoyOnline", "https://www.myjoyonline.com/feed/", "en", "gh", "news"),
    ("News24", "https://feeds.news24.com/articles/news24/TopStories/rss", "en", "za", "news"),
    ("Daily Maverick", "https://www.dailymaverick.co.za/dmrss/", "en", "za", "news"),
    ("Mail & Guardian", "https://mg.co.za/feed/", "en", "za", "news"),
    ("IOL", "https://iol.co.za/rss/iol/news", "en", "za", "news"),
    ("NewsDay Zimbabwe", "https://www.newsday.co.zw/feed", "en", "zw", "news"),
    ("The Herald Zimbabwe", "https://www.herald.co.zw/feed/", "en", "zw", "news"),
    ("Lusaka Times", "https://www.lusakatimes.com/feed/", "en", "zm", "news"),
    ("Nyasa Times", "https://www.nyasatimes.com/feed/", "en", "mw", "news"),
    ("The Namibian", "https://www.namibian.com.na/feed/", "en", "na", "news"),
    ("Club of Mozambique", "https://clubofmozambique.com/feed/", "en", "mz", "news"),
    ("Jeune Afrique", "https://www.jeuneafrique.com/feed/", "fr", "fr", "news"),
    ("Le Monde Afrique", "https://www.lemonde.fr/afrique/rss_full.xml", "fr", "fr", "news"),
    ("Le Monde International", "https://www.lemonde.fr/international/rss_full.xml", "fr", "fr", "news"),
    ("Le Monde", "https://www.lemonde.fr/rss/une.xml", "fr", "fr", "news"),
    ("Le Figaro International", "https://www.lefigaro.fr/rss/figaro_international.xml", "fr", "fr", "news"),
    ("Libération", "https://www.liberation.fr/arc/outboundfeeds/rss/?outputType=xml", "fr", "fr", "news"),
    ("franceinfo", "https://www.francetvinfo.fr/titres.rss", "fr", "fr", "news"),
    ("Le Soir", "https://www.lesoir.be/rss/81853/cible_principale", "fr", "be", "news"),
    ("RTBF", "https://rss.rtbf.be/article/rss/highlight_rtbf_info.xml", "fr", "be", "news"),
    ("Le Temps", "https://www.letemps.ch/articles.rss", "fr", "ch", "news"),
    ("RTS Info", "https://www.rts.ch/info/?format=rss/news", "fr", "ch", "news"),
    ("SWI swissinfo", "https://www.swissinfo.ch/eng/rss/latest-news", "en", "ch", "news"),
    ("Le360", "https://fr.le360.ma/rss", "fr", "ma", "news"),
    ("Hespress English", "https://en.hespress.com/feed", "en", "ma", "news"),
    ("TSA Algérie", "https://www.tsa-algerie.com/feed/", "fr", "dz", "news"),
    ("Kapitalis", "https://kapitalis.com/tunisie/feed/", "fr", "tn", "news"),
    ("Actualité.cd", "https://actualite.cd/rss.xml", "fr", "cd", "news"),
    ("Radio Okapi", "https://www.radiookapi.net/rss.xml", "fr", "cd", "news"),
    ("Abidjan.net", "https://news.abidjan.net/rss", "fr", "ci", "news"),
    ("Seneweb", "https://www.seneweb.com/news/rss.php", "fr", "sn", "news"),
    ("lefaso.net", "https://lefaso.net/spip.php?page=backend", "fr", "bf", "news"),
    ("Studio Tamani", "https://www.studiotamani.org/feed", "fr", "ml", "news"),
    ("Tagesschau", "https://www.tagesschau.de/xml/rss2/", "de", "de", "news"),
    ("Spiegel", "https://www.spiegel.de/schlagzeilen/index.rss", "de", "de", "news"),
    ("Spiegel Ausland", "https://www.spiegel.de/ausland/index.rss", "de", "de", "news"),
    ("Zeit Online", "https://newsfeed.zeit.de/index", "de", "de", "news"),
    ("FAZ", "https://www.faz.net/rss/aktuell/", "de", "de", "news"),
    ("Süddeutsche", "https://rss.sueddeutsche.de/rss/Topthemen", "de", "de", "news"),
    ("Die Welt", "https://www.welt.de/feeds/latest.rss", "de", "de", "news"),
    ("n-tv", "https://www.n-tv.de/rss", "de", "de", "news"),
    ("ZDF heute", "https://www.zdf.de/rss/zdf/nachrichten", "de", "de", "news"),
    ("Deutschlandfunk", "https://www.deutschlandfunk.de/nachrichten-100.rss", "de", "de", "news"),
    ("taz", "https://taz.de/!p4608;rss/", "de", "de", "news"),
    ("Handelsblatt", "https://www.handelsblatt.com/contentexport/feed/top-themen", "de", "de", "news"),
    ("ORF News", "https://rss.orf.at/news.xml", "de", "at", "news"),
    ("Der Standard", "https://www.derstandard.at/rss", "de", "at", "news"),
    ("Die Presse", "https://www.diepresse.com/rss/home", "de", "at", "news"),
    ("SRF News", "https://www.srf.ch/news/bnf/rss/1646", "de", "ch", "news"),
    ("NZZ", "https://www.nzz.ch/recent.rss", "de", "ch", "news"),
    ("Tages-Anzeiger", "https://www.tagesanzeiger.ch/rss.html", "de", "ch", "news"),
    ("El País", "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada", "es", "es", "news"),
    ("El País Internacional", "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada", "es", "es", "news"),
    ("El Mundo", "https://e00-elmundo.uecdn.es/elmundo/rss/portada.xml", "es", "es", "news"),
    ("RTVE", "https://api2.rtve.es/rss/temas_noticias.xml", "es", "es", "news"),
    ("La Vanguardia", "https://www.lavanguardia.com/rss/home.xml", "es", "es", "news"),
    ("ABC España", "https://www.abc.es/rss/2.0/portada/", "es", "es", "news"),
    ("Europa Press", "https://www.europapress.es/rss/rss.aspx", "es", "es", "news"),
    ("Clarín", "https://www.clarin.com/rss/lo-ultimo/", "es", "ar", "news"),
    ("La Nación", "https://www.lanacion.com.ar/arc/outboundfeeds/rss/?outputType=xml", "es", "ar", "news"),
    ("Infobae", "https://www.infobae.com/arc/outboundfeeds/rss/", "es", "ar", "news"),
    ("Página 12", "https://www.pagina12.com.ar/rss/portada", "es", "ar", "news"),
    ("El Universal", "https://www.eluniversal.com.mx/arc/outboundfeeds/rss/?outputType=xml", "es", "mx", "news"),
    ("La Jornada", "https://www.jornada.com.mx/rss/edicion.xml", "es", "mx", "news"),
    ("Proceso", "https://www.proceso.com.mx/rss/", "es", "mx", "news"),
    ("El Tiempo", "https://www.eltiempo.com/rss/colombia.xml", "es", "co", "news"),
    ("El Espectador", "https://www.elespectador.com/arc/outboundfeeds/rss/?outputType=xml", "es", "co", "news"),
    ("Semana", "https://www.semana.com/arc/outboundfeeds/rss/?outputType=xml", "es", "co", "news"),
    ("El Comercio Perú", "https://elcomercio.pe/arc/outboundfeeds/rss/?outputType=xml", "es", "pe", "news"),
    ("La Tercera", "https://www.latercera.com/arc/outboundfeeds/rss/?outputType=xml", "es", "cl", "news"),
    ("BioBioChile", "https://www.biobiochile.cl/static/rss/nacional.xml", "es", "cl", "news"),
    ("Efecto Cocuyo", "https://efectococuyo.com/feed/", "es", "ve", "news"),
    ("El Nacional Venezuela", "https://www.elnacional.com/feed/", "es", "ve", "news"),
    ("14ymedio", "https://www.14ymedio.com/rss/", "es", "cu", "news"),
    ("Granma", "https://www.granma.cu/feed", "es", "cu", "news"),
    ("El Faro", "https://elfaro.net/es/rss", "es", "sv", "news"),
    ("Prensa Libre", "https://www.prensalibre.com/feed/", "es", "gt", "news"),
    ("Confidencial", "https://confidencial.digital/feed/", "es", "ni", "news"),
    ("La Prensa Panamá", "https://www.prensa.com/arc/outboundfeeds/rss/?outputType=xml", "es", "pa", "news"),
    ("El Deber", "https://eldeber.com.bo/rss", "es", "bo", "news"),
    ("El Universo", "https://www.eluniverso.com/arc/outboundfeeds/rss/?outputType=xml", "es", "ec", "news"),
    ("ABC Color", "https://www.abc.com.py/arc/outboundfeeds/rss/?outputType=xml", "es", "py", "news"),
    ("El País Uruguay", "https://www.elpais.com.uy/rss/", "es", "uy", "news"),
    ("Diario Libre", "https://www.diariolibre.com/rss/portada.xml", "es", "do", "news"),
    ("Folha de S.Paulo", "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml", "pt", "br", "news"),
    ("Folha Mundo", "https://feeds.folha.uol.com.br/mundo/rss091.xml", "pt", "br", "news"),
    ("G1", "https://g1.globo.com/rss/g1/", "pt", "br", "news"),
    ("G1 Mundo", "https://g1.globo.com/rss/g1/mundo/", "pt", "br", "news"),
    ("Agência Brasil", "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml", "pt", "br", "news"),
    ("CNN Brasil", "https://www.cnnbrasil.com.br/feed/", "pt", "br", "news"),
    ("Público", "https://feeds.feedburner.com/PublicoRSS", "pt", "pt", "news"),
    ("RTP Notícias", "https://www.rtp.pt/noticias/rss", "pt", "pt", "news"),
    ("Observador", "https://observador.pt/feed/", "pt", "pt", "news"),
    ("Lusa (via Google News)", "https://news.google.com/rss/search?q=Lusa&hl=pt-PT&gl=PT&ceid=PT:pt-150", "pt", "pt", "news"),
    ("ANSA", "https://www.ansa.it/sito/ansait_rss.xml", "it", "it", "news"),
    ("ANSA Mondo", "https://www.ansa.it/sito/notizie/mondo/mondo_rss.xml", "it", "it", "news"),
    ("ANSA English", "https://www.ansa.it/english/news/english_nr_rss.xml", "en", "it", "news"),
    ("Corriere della Sera", "https://xml2.corriereobjects.it/rss/homepage.xml", "it", "it", "news"),
    ("la Repubblica", "https://www.repubblica.it/rss/homepage/rss2.0.xml", "it", "it", "news"),
    ("Rai News", "https://www.rainews.it/rss/tutti", "it", "it", "news"),
    ("Il Sole 24 Ore", "https://www.ilsole24ore.com/rss/mondo.xml", "it", "it", "news"),
    ("NOS", "https://feeds.nos.nl/nosnieuwsalgemeen", "nl", "nl", "news"),
    ("NOS Buitenland", "https://feeds.nos.nl/nosnieuwsbuitenland", "nl", "nl", "news"),
    ("NU.nl", "https://www.nu.nl/rss/Algemeen", "nl", "nl", "news"),
    ("de Volkskrant", "https://www.volkskrant.nl/voorpagina/rss.xml", "nl", "nl", "news"),
    ("VRT NWS", "https://www.vrt.be/vrtnws/nl.rss.articles.xml", "nl", "be", "news"),
    ("De Standaard", "https://www.standaard.be/rss/section/1f2838d4-99ea-49f0-9102-138784c7ea7c", "nl", "be", "news"),
    ("DR Nyheder", "https://www.dr.dk/nyheder/service/feeds/allenyheder", "da", "dk", "news"),
    ("Politiken", "https://politiken.dk/rss/senestenyt.rss", "da", "dk", "news"),
    ("SVT Nyheter", "https://www.svt.se/nyheter/rss.xml", "sv", "se", "news"),
    ("Dagens Nyheter", "https://www.dn.se/rss/", "sv", "se", "news"),
    ("Aftonbladet", "https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/", "sv", "se", "news"),
    ("NRK", "https://www.nrk.no/toppsaker.rss", "no", "no", "news"),
    ("VG", "https://www.vg.no/rss/feed/", "no", "no", "news"),
    ("Aftenposten", "https://www.aftenposten.no/rss", "no", "no", "news"),
    ("Yle Uutiset", "https://feeds.yle.fi/uutiset/v1/majorHeadlines/YLE_UUTISET.rss", "fi", "fi", "news"),
    ("Yle News", "https://feeds.yle.fi/uutiset/v1/recent.rss?publisherIds=YLE_NEWS", "en", "fi", "news"),
    ("Helsingin Sanomat", "https://www.hs.fi/rss/tuoreimmat.xml", "fi", "fi", "news"),
    ("RÚV", "https://www.ruv.is/rss/frettir", "is", "is", "news"),
    ("ERR News", "https://news.err.ee/rss", "en", "ee", "news"),
    ("ERR", "https://www.err.ee/rss", "et", "ee", "news"),
    ("LSM", "https://eng.lsm.lv/rss/", "en", "lv", "news"),
    ("Delfi Latvia", "https://www.delfi.lv/rss/?channel=delfi", "lv", "lv", "news"),
    ("LRT English", "https://www.lrt.lt/en/news-in-english?rss", "en", "lt", "news"),
    ("LRT", "https://www.lrt.lt/naujienos?rss", "lt", "lt", "news"),
    ("TVN24", "https://tvn24.pl/najnowsze.xml", "pl", "pl", "news"),
    ("Rzeczpospolita", "https://www.rp.pl/rss_main", "pl", "pl", "news"),
    ("Polskie Radio", "https://www.polskieradio.pl/Rss/Feed/1", "pl", "pl", "news"),
    ("Notes from Poland", "https://notesfrompoland.com/feed/", "en", "pl", "news"),
    ("ČT24", "https://ct24.ceskatelevize.cz/rss/hlavni-zpravy", "cs", "cz", "news"),
    ("iROZHLAS", "https://www.irozhlas.cz/rss/irozhlas", "cs", "cz", "news"),
    ("Novinky.cz", "https://www.novinky.cz/rss", "cs", "cz", "news"),
    ("SME", "https://www.sme.sk/rss-title", "sk", "sk", "news"),
    ("Aktuality.sk", "https://www.aktuality.sk/rss/", "sk", "sk", "news"),
    ("Telex", "https://telex.hu/rss", "hu", "hu", "news"),
    ("Index.hu", "https://index.hu/24ora/rss/", "hu", "hu", "news"),
    ("444", "https://444.hu/feed", "hu", "hu", "news"),
    ("HVG", "https://hvg.hu/rss", "hu", "hu", "news"),
    ("Digi24", "https://www.digi24.ro/rss", "ro", "ro", "news"),
    ("HotNews.ro", "https://hotnews.ro/feed", "ro", "ro", "news"),
    ("Agerpres", "https://www.agerpres.ro/rss", "ro", "ro", "news"),
    ("Moldova.org", "https://www.moldova.org/feed/", "ro", "md", "news"),
    ("NewsMaker Moldova", "https://newsmaker.md/feed/", "ru", "md", "news"),
    ("Dnevnik.bg", "https://www.dnevnik.bg/rss/", "bg", "bg", "news"),
    ("BTA English", "https://www.bta.bg/en/news/rss", "en", "bg", "news"),
    ("Novinite", "https://www.novinite.com/services/news_rdf.php", "en", "bg", "news"),
    ("Kathimerini English", "https://www.ekathimerini.com/rss", "en", "gr", "news"),
    ("Kathimerini", "https://www.kathimerini.gr/infeeds/rss/nx-rss-feed.xml", "el", "gr", "news"),
    ("Cyprus Mail", "https://cyprus-mail.com/feed/", "en", "cy", "news"),
    ("Times of Malta", "https://timesofmalta.com/rss", "en", "mt", "news"),
    ("Index.hr", "https://www.index.hr/rss", "hr", "hr", "news"),
    ("Jutarnji list", "https://www.jutarnji.hr/feed", "hr", "hr", "news"),
    ("HRT Vijesti", "https://vijesti.hrt.hr/rss", "hr", "hr", "news"),
    ("24sata.hr", "https://www.24sata.hr/feeds/aktualno.xml", "hr", "hr", "news"),
    ("RTV Slovenija", "https://img.rtvslo.si/feeds/00.xml", "sl", "si", "news"),
    ("Delo", "https://www.delo.si/rss", "sl", "si", "news"),
    ("Klix.ba", "https://www.klix.ba/rss", "bs", "ba", "news"),
    ("Radio Sarajevo", "https://radiosarajevo.ba/rss", "bs", "ba", "news"),
    ("N1 BiH", "https://n1info.ba/feed/", "bs", "ba", "news"),
    ("Vijesti.me", "https://www.vijesti.me/rss", "sr", "me", "news"),
    ("CdM", "https://www.cdm.me/feed/", "sr", "me", "news"),
    ("RTCG", "https://rtcg.me/rss.html", "sr", "me", "news"),
    ("MIA", "https://mia.mk/feed", "mk", "mk", "news"),
    ("Meta.mk", "https://meta.mk/feed/", "mk", "mk", "news"),
    ("Top Channel", "https://top-channel.tv/feed/", "sq", "al", "news"),
    ("Balkan Insight", "https://balkaninsight.com/feed/", "en", "int", "news"),
    ("Koha", "https://www.koha.net/rss", "sq", "xk", "news"),
    ("Kyiv Independent", "https://kyivindependent.com/rss/", "en", "ua", "news"),
    ("Ukrainska Pravda", "https://www.pravda.com.ua/rss/", "uk", "ua", "news"),
    ("Ukrainska Pravda English", "https://www.pravda.com.ua/eng/rss/", "en", "ua", "news"),
    ("Ukrinform", "https://www.ukrinform.net/rss/block-lastnews", "en", "ua", "news"),
    ("Ukrinform UA", "https://www.ukrinform.ua/rss/block-lastnews", "uk", "ua", "news"),
    ("Suspilne", "https://suspilne.media/rss/all.rss", "uk", "ua", "news"),
    ("Kyiv Post", "https://www.kyivpost.com/feed", "en", "ua", "news"),
    ("Meduza", "https://meduza.io/rss/all", "ru", "lv", "news"),
    ("Meduza English", "https://meduza.io/rss/en/all", "en", "lv", "news"),
    ("The Moscow Times", "https://www.themoscowtimes.com/rss/news", "en", "nl", "news"),
    ("TASS", "https://tass.com/rss/v2.xml", "en", "ru", "news"),
    ("ТАСС", "https://tass.ru/rss/v2.xml", "ru", "ru", "news"),
    ("RIA Novosti", "https://ria.ru/export/rss2/archive/index.xml", "ru", "ru", "news"),
    ("Interfax", "https://www.interfax.ru/rss.asp", "ru", "ru", "news"),
    ("Kommersant", "https://www.kommersant.ru/RSS/news.xml", "ru", "ru", "news"),
    ("Novaya Gazeta Europe", "https://novayagazeta.eu/feed/rss", "ru", "lv", "news"),
    ("Belsat", "https://belsat.eu/en/feed", "en", "pl", "news"),
    ("Civil.ge", "https://civil.ge/feed", "en", "ge", "news"),
    ("Armenpress", "https://armenpress.am/en/rss/news", "en", "am", "news"),
    ("Azatutyun", "https://www.azatutyun.am/api/", "hy", "am", "news"),
    ("APA Azerbaijan", "https://apa.az/en/rss", "en", "az", "news"),
    ("OC Media", "https://oc-media.org/feed/", "en", "ge", "news"),
    ("Eurasianet", "https://eurasianet.org/rss.xml", "en", "int", "news"),
    ("Kun.uz", "https://kun.uz/en/news/rss", "en", "uz", "news"),
    ("Astana Times", "https://astanatimes.com/feed/", "en", "kz", "news"),
    ("24.kg", "https://24.kg/rss/", "ru", "kg", "news"),
    ("Xinhua English", "https://english.news.cn/rss/worldrss.xml", "en", "cn", "news"),
    ("China Daily World", "https://www.chinadaily.com.cn/rss/world_rss.xml", "en", "cn", "news"),
    ("China Daily China", "https://www.chinadaily.com.cn/rss/china_rss.xml", "en", "cn", "news"),
    ("Global Times", "https://www.globaltimes.cn/rss/outbrain.xml", "en", "cn", "news"),
    ("CGTN World", "https://www.cgtn.com/subscribe/rss/section/world.xml", "en", "cn", "news"),
    ("People's Daily", "http://en.people.cn/rss/90777.xml", "en", "cn", "news"),
    ("BBC 中文", "https://feeds.bbci.co.uk/zhongwen/simp/rss.xml", "zh", "gb", "news"),
    ("RFI 中文", "https://www.rfi.fr/cn/rss", "zh", "fr", "news"),
    ("联合早报", "https://www.zaobao.com.sg/rss/realtime/world", "zh", "sg", "news"),
    ("Yonhap 한국어", "https://www.yna.co.kr/rss/news.xml", "ko", "kr", "news"),
    ("Hankyoreh English", "https://english.hani.co.kr/rss/", "en", "kr", "news"),
    ("Asahi", "https://www.asahi.com/rss/asahi/newsheadlines.rdf", "ja", "jp", "news"),
    ("Mainichi", "https://mainichi.jp/rss/etc/mainichi-flash.rss", "ja", "jp", "news"),
    ("Kyodo (via Google News)", "https://news.google.com/rss/search?q=Kyodo&hl=en-US&gl=US&ceid=US:en", "en", "jp", "news"),
    ("Al Arabiya", "https://www.alarabiya.net/feed/rss2/ar.xml", "ar", "ae", "news"),
    ("Al Jazeera Arabic", "https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9", "ar", "qa", "news"),
    ("Asharq Al-Awsat", "https://aawsat.com/feed", "ar", "sa", "news"),
    ("Sky News Arabia", "https://www.skynewsarabia.com/web/rss", "ar", "ae", "news"),
    ("Youm7", "https://www.youm7.com/rss/SectionRss?SectionID=65", "ar", "eg", "news"),
    ("Masrawy", "https://www.masrawy.com/rss/feed/25/news", "ar", "eg", "news"),
    ("Hespress", "https://www.hespress.com/feed", "ar", "ma", "news"),
    ("Enab Baladi", "https://english.enabbaladi.net/feed/", "en", "sy", "news"),
    ("SANA", "https://sana.sy/en/?feed=rss2", "en", "sy", "news"),
    ("Mehr News", "https://en.mehrnews.com/rss", "en", "ir", "news"),
    ("IRNA English", "https://en.irna.ir/rss", "en", "ir", "news"),
    ("Hamshahri", "https://www.hamshahrionline.ir/rss", "fa", "ir", "news"),
    ("Radio Farda", "https://www.radiofarda.com/api/", "fa", "cz", "news"),
    ("Hürriyet", "https://www.hurriyet.com.tr/rss/anasayfa", "tr", "tr", "news"),
    ("Sözcü", "https://www.sozcu.com.tr/feeds-rss-category-sozcu", "tr", "tr", "news"),
    ("BirGün", "https://www.birgun.net/rss/home", "tr", "tr", "news"),
    ("Bianet English", "https://bianet.org/english/rss", "en", "tr", "news"),
    ("Ynet", "https://www.ynet.co.il/Integration/StoryRss2.xml", "he", "il", "news"),
    ("Maariv", "https://www.maariv.co.il/Rss/RssChadashot", "he", "il", "news"),
    ("WAFA English", "https://english.wafa.ps/rss", "en", "ps", "news"),
    ("Aaj Tak", "https://www.aajtak.in/rssfeeds/?id=home", "hi", "in", "news"),
    ("Dainik Bhaskar", "https://www.bhaskar.com/rss-feed/1061/", "hi", "in", "news"),
    ("Prothom Alo English", "https://en.prothomalo.com/feed/", "en", "bd", "news"),
    ("Dhaka Tribune", "https://www.dhakatribune.com/feed", "en", "bd", "news"),
    ("Kompas", "https://rss.kompas.com/api/feed/social?apikey=bc58c81819dff4b8d5c53540a2fc7ffd83e6314a", "id", "id", "news"),
    ("Tempo", "https://rss.tempo.co/nasional", "id", "id", "news"),
    ("Detik", "https://news.detik.com/rss", "id", "id", "news"),
    ("Thai PBS World", "https://www.thaipbsworld.com/feed/", "en", "th", "news"),
    ("Tuoi Tre News", "https://tuoitrenews.vn/rss", "en", "vn", "news"),
    ("Philippine Star", "https://www.philstar.com/rss/headlines", "en", "ph", "news"),
    ("GMA News", "https://data.gmanetwork.com/gno/rss/news/feed.xml", "en", "ph", "news"),
    ("Sydney Morning Herald", "https://www.smh.com.au/rss/feed.xml", "en", "au", "news"),
    ("The Age", "https://www.theage.com.au/rss/feed.xml", "en", "au", "news"),
    ("SBS News", "https://www.sbs.com.au/news/feed", "en", "au", "news"),
    ("Guardian Australia", "https://www.theguardian.com/australia-news/rss", "en", "au", "news"),
    ("Stuff", "https://www.stuff.co.nz/rss", "en", "nz", "news"),
    ("NZ Herald", "https://www.nzherald.co.nz/arc/outboundfeeds/rss/curated/78/?outputType=xml", "en", "nz", "news"),
    ("Fiji Times", "https://www.fijitimes.com.fj/feed/", "en", "fj", "news"),
    ("PNG Post-Courier", "https://www.postcourier.com.pg/feed/", "en", "pg", "news"),
    ("Jamaica Observer", "https://www.jamaicaobserver.com/feed/", "en", "jm", "news"),
    ("Jamaica Gleaner", "https://jamaica-gleaner.com/feed/rss.xml", "en", "jm", "news"),
    ("Trinidad Express", "https://trinidadexpress.com/search/?f=rss&t=article&c=news&l=50&s=start_time&sd=desc", "en", "tt", "news"),
    ("Haiti Libre", "https://www.haitilibre.com/rss-flash-en.xml", "en", "ht", "news"),
    ("Le Nouvelliste", "https://lenouvelliste.com/rss", "fr", "ht", "news"),
    ("Toronto Star", "https://www.thestar.com/search/?f=rss&t=article&c=news*&l=50&s=start_time&sd=desc", "en", "ca", "news"),
    ("Globe and Mail World", "https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/world/", "en", "ca", "news"),
    ("Global News", "https://globalnews.ca/feed/", "en", "ca", "news"),
    ("Le Devoir", "https://www.ledevoir.com/rss/manchettes.xml", "fr", "ca", "news"),
    ("MercoPress", "https://en.mercopress.com/rss", "en", "uy", "news"),
    ("Buenos Aires Times", "https://www.batimes.com.ar/feed", "en", "ar", "news"),
    ("Mexico News Daily", "https://mexiconewsdaily.com/feed/", "en", "mx", "news"),
    ("Rio Times", "https://www.riotimesonline.com/feed/", "en", "br", "news"),
    ("The Africa Report", "https://www.theafricareport.com/feed/", "en", "int", "news"),
    ("AllAfrica", "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf", "en", "int", "news"),
    ("The New Humanitarian", "https://www.thenewhumanitarian.org/rss/all.xml", "en", "int", "news"),
    ("Devex", "https://www.devex.com/news/feed.rss", "en", "int", "news"),
    ("Crisis Group", "https://www.crisisgroup.org/rss.xml", "en", "int", "official"),
    ("The Diplomat", "https://thediplomat.com/feed/", "en", "int", "news"),
    ("Foreign Policy", "https://foreignpolicy.com/feed/", "en", "us", "news"),
    ("Defense News", "https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml", "en", "us", "news"),
    ("Breaking Defense", "https://breakingdefense.com/feed/", "en", "us", "news"),
    ("War on the Rocks", "https://warontherocks.com/feed/", "en", "us", "news"),
    ("Bellingcat", "https://www.bellingcat.com/feed/", "en", "int", "news"),
    ("OCCRP", "https://www.occrp.org/en/feed", "en", "int", "news"),
    ("Climate Home News", "https://www.climatechangenews.com/feed/", "en", "int", "news"),
    ("Carbon Brief", "https://www.carbonbrief.org/feed/", "en", "gb", "news"),
    ("Mongabay", "https://news.mongabay.com/feed/", "en", "int", "news"),
    ("STAT News", "https://www.statnews.com/feed/", "en", "us", "news"),
    ("CIDRAP", "https://www.cidrap.umn.edu/news/rss.xml", "en", "us", "news"),
    ("Nikkei Asia", "https://asia.nikkei.com/rss/feed/nar", "en", "jp", "news"),
    ("Bloomberg Politics (via Google News)", "https://news.google.com/rss/search?q=site:bloomberg.com+politics&hl=en-US&gl=US&ceid=US:en", "en", "us", "news"),
    ("OilPrice", "https://oilprice.com/rss/main", "en", "int", "news"),
    ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories", "en", "us", "news"),
    ("Fortune", "https://fortune.com/feed/", "en", "us", "news"),
    ("Deutsche Welle Business", "https://rss.dw.com/rdf/rss-en-bus", "en", "de", "news"),
    ("Deutsche Welle Top", "https://rss.dw.com/rdf/rss-en-top", "en", "de", "news"),
    # Serbia and the region
    ("RTS", "https://www.rts.rs/page/stories/sr/rss.html", "sr", "rs", "news"),
    ("RTS Svet", "https://www.rts.rs/page/stories/sr/rss/10/svet.html", "sr", "rs", "news"),
    ("N1 Srbija", "https://n1info.rs/feed/", "sr", "rs", "news"),
    ("Danas", "https://www.danas.rs/feed/", "sr", "rs", "news"),
    ("Nova.rs", "https://nova.rs/feed/", "sr", "rs", "news"),
    ("Politika", "https://www.politika.rs/rss", "sr", "rs", "news"),
    ("Blic", "https://www.blic.rs/rss/danasnje-vesti", "sr", "rs", "news"),
    ("Novosti", "https://www.novosti.rs/rss", "sr", "rs", "news"),
    ("Tanjug", "https://www.tanjug.rs/rss", "sr", "rs", "news"),
    ("Beta", "https://beta.rs/feed", "sr", "rs", "news"),
    ("Insajder", "https://insajder.net/rss", "sr", "rs", "news"),
    ("Vreme", "https://vreme.com/feed/", "sr", "rs", "news"),
    ("Radio Slobodna Evropa", "https://www.slobodnaevropa.org/api/", "sr", "int", "news"),
    ("Glas Amerike", "https://www.glasamerike.net/api/", "sr", "us", "news"),
    ("Kosovo Online", "https://www.kosovo-online.com/rss.xml", "sr", "xk", "news"),
    ("Nezavisne novine", "https://www.nezavisne.com/rss", "sr", "ba", "news"),
    ("RTRS", "https://www.rtrs.tv/rss.php", "sr", "ba", "news"),
    # Officials: UN system
    ("UN Press (Meetings Coverage)", "https://press.un.org/en/rss.xml", "en", "int", "official"),
    ("UN Secretary-General", "https://www.un.org/sg/en/rss.xml", "en", "int", "official"),
    ("UN Security Council (via UN News)", "https://news.un.org/feed/subscribe/en/news/topic/peace-and-security/feed/rss.xml", "en", "int", "official"),
    ("OHCHR News", "https://www.ohchr.org/en/rss/news", "en", "int", "official"),
    ("OCHA", "https://www.unocha.org/rss.xml", "en", "int", "official"),
    ("ReliefWeb Headlines", "https://reliefweb.int/headlines/rss.xml", "en", "int", "official"),
    ("ReliefWeb Updates", "https://reliefweb.int/updates/rss.xml", "en", "int", "official"),
    ("ReliefWeb Disasters", "https://reliefweb.int/disasters/rss.xml", "en", "int", "official"),
    ("WHO News", "https://www.who.int/rss-feeds/news-english.xml", "en", "int", "official"),
    ("WHO Disease Outbreak News", "https://www.who.int/feeds/entity/csr/don/en/rss.xml", "en", "int", "official"),
    ("WHO Europe", "https://www.who.int/europe/rss-feeds/news", "en", "int", "official"),
    ("UNHCR", "https://www.unhcr.org/rss.xml", "en", "int", "official"),
    ("UNHCR News", "https://www.unhcr.org/news/rss.xml", "en", "int", "official"),
    ("UNICEF", "https://www.unicef.org/press-releases/rss.xml", "en", "int", "official"),
    ("UNICEF Press", "https://www.unicef.org/rss.xml", "en", "int", "official"),
    ("WFP News", "https://www.wfp.org/rss.xml", "en", "int", "official"),
    ("WFP Press Releases", "https://www.wfp.org/news/rss.xml", "en", "int", "official"),
    ("FAO", "https://www.fao.org/news/rss-feed/en/", "en", "int", "official"),
    ("UNDP", "https://www.undp.org/rss.xml", "en", "int", "official"),
    ("UNEP", "https://www.unep.org/news-and-stories/rss.xml", "en", "int", "official"),
    ("UNFPA", "https://www.unfpa.org/rss.xml", "en", "int", "official"),
    ("UNRWA", "https://www.unrwa.org/rss.xml", "en", "int", "official"),
    ("IOM", "https://www.iom.int/rss.xml", "en", "int", "official"),
    ("IAEA", "https://www.iaea.org/feeds/topnews", "en", "int", "official"),
    ("IAEA Press", "https://www.iaea.org/feeds/press-releases", "en", "int", "official"),
    ("ILO", "https://www.ilo.org/rss.xml", "en", "int", "official"),
    ("UNESCO", "https://www.unesco.org/en/rss.xml", "en", "int", "official"),
    ("UN Women", "https://www.unwomen.org/en/rss.xml", "en", "int", "official"),
    ("WMO", "https://wmo.int/rss.xml", "en", "int", "official"),
    ("UNCTAD", "https://unctad.org/rss.xml", "en", "int", "official"),
    ("UN Peacekeeping", "https://peacekeeping.un.org/en/rss.xml", "en", "int", "official"),
    ("UNAMA", "https://unama.unmissions.org/rss.xml", "en", "af", "official"),
    ("UNMISS", "https://unmiss.unmissions.org/rss.xml", "en", "ss", "official"),
    ("MONUSCO", "https://monusco.unmissions.org/en/rss.xml", "en", "cd", "official"),
    ("ICC", "https://www.icc-cpi.int/rss.xml", "en", "int", "official"),
    ("ICJ", "https://www.icj-cij.org/rss.xml", "en", "int", "official"),
    ("World Bank", "https://www.worldbank.org/en/news/all.rss", "en", "int", "official"),
    ("IMF News", "https://www.imf.org/en/News/RSS?language=eng", "en", "int", "official"),
    ("WTO News", "https://www.wto.org/library/rss/latest_news_e.xml", "en", "int", "official"),
    ("OECD", "https://www.oecd.org/newsroom/index.xml", "en", "int", "official"),
    ("OSCE", "https://www.osce.org/rss.xml", "en", "int", "official"),
    ("Council of Europe", "https://www.coe.int/en/web/portal/rss", "en", "int", "official"),
    ("NATO News", "https://www.nato.int/cps/en/natohq/news.rss", "en", "int", "official"),
    ("NATO", "https://www.nato.int/cps/rss/en/natohq/rssFeed.xsl/rssFeed.xml", "en", "int", "official"),
    ("African Union", "https://au.int/en/rss.xml", "en", "int", "official"),
    ("ASEAN", "https://asean.org/feed/", "en", "int", "official"),
    ("ICRC", "https://www.icrc.org/en/rss/news", "en", "int", "official"),
    ("IFRC", "https://www.ifrc.org/rss.xml", "en", "int", "official"),
    ("MSF", "https://www.msf.org/rss/all", "en", "int", "official"),
    ("Amnesty International", "https://www.amnesty.org/en/feed/", "en", "int", "official"),
    ("Human Rights Watch", "https://www.hrw.org/rss/news", "en", "int", "official"),
    ("Oxfam", "https://www.oxfam.org/en/rss.xml", "en", "int", "official"),
    ("Save the Children", "https://www.savethechildren.net/rss.xml", "en", "int", "official"),
    ("Norwegian Refugee Council", "https://www.nrc.no/rss/", "en", "int", "official"),
    ("International Rescue Committee", "https://www.rescue.org/rss.xml", "en", "int", "official"),
    ("CARE", "https://www.care-international.org/rss.xml", "en", "int", "official"),
    ("Reporters Without Borders", "https://rsf.org/en/rss", "en", "int", "official"),
    ("CPJ", "https://cpj.org/feed/", "en", "int", "official"),
    ("Transparency International", "https://www.transparency.org/en/feed", "en", "int", "official"),
    ("SIPRI", "https://www.sipri.org/rss.xml", "en", "int", "official"),
    ("ACLED", "https://acleddata.com/feed/", "en", "int", "official"),
    ("GDACS alerts", "https://www.gdacs.org/xml/rss.xml", "en", "int", "official"),
    ("USGS significant earthquakes", "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.atom", "en", "int", "official"),
    ("USGS M4.5+ earthquakes", "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.atom", "en", "int", "official"),
    ("ProMED", "https://promedmail.org/feed/", "en", "int", "official"),
    ("ECDC", "https://www.ecdc.europa.eu/en/taxonomy/term/1307/feed", "en", "int", "official"),
    # EU
    ("European Commission Press", "https://ec.europa.eu/commission/presscorner/api/rss?language=en", "en", "int", "official"),
    ("Council of the EU", "https://www.consilium.europa.eu/en/rss/pressreleases.ashx", "en", "int", "official"),
    ("European Parliament", "https://www.europarl.europa.eu/rss/doc/press-releases/en.xml", "en", "int", "official"),
    ("EEAS", "https://www.eeas.europa.eu/eeas/rss_en", "en", "int", "official"),
    ("ECB Press", "https://www.ecb.europa.eu/rss/press.html", "en", "int", "official"),
    ("Eurostat", "https://ec.europa.eu/eurostat/en/search?p_p_id=estatsearchportlet_WAR_estatsearchportlet&p_p_lifecycle=2&p_p_state=maximized&p_p_mode=view&p_p_resource_id=atom&_estatsearchportlet_WAR_estatsearchportlet_collection=CAT_EURNEW", "en", "int", "official"),
    ("Frontex", "https://www.frontex.europa.eu/media-centre/news/rss.xml", "en", "int", "official"),
    ("Europol", "https://www.europol.europa.eu/rss/news", "en", "int", "official"),
    ("EU Commission (de)", "https://ec.europa.eu/commission/presscorner/api/rss?language=de", "de", "int", "official"),
    # governments, foreign ministries, central banks
    ("US State Department", "https://www.state.gov/rss-feed/press-releases/feed/", "en", "us", "official"),
    ("US State Department Briefings", "https://www.state.gov/rss-feed/department-press-briefings/feed/", "en", "us", "official"),
    ("White House", "https://www.whitehouse.gov/news/feed/", "en", "us", "official"),
    ("US Department of Defense", "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=10", "en", "us", "official"),
    ("US Treasury", "https://home.treasury.gov/system/files/126/ofac.xml", "en", "us", "official"),
    ("US CDC Newsroom", "https://tools.cdc.gov/api/v2/resources/media/132608.rss", "en", "us", "official"),
    ("USAID", "https://www.usaid.gov/rss/press-releases.xml", "en", "us", "official"),
    ("Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml", "en", "us", "official"),
    ("Federal Reserve Monetary", "https://www.federalreserve.gov/feeds/press_monetary.xml", "en", "us", "official"),
    ("SEC Press Releases", "https://www.sec.gov/news/pressreleases.rss", "en", "us", "official"),
    ("US Justice Department", "https://www.justice.gov/news/rss?type=press_release&m=1", "en", "us", "official"),
    ("NASA", "https://www.nasa.gov/news-release/feed/", "en", "us", "official"),
    ("NOAA", "https://www.noaa.gov/rss.xml", "en", "us", "official"),
    ("Bank of England", "https://www.bankofengland.co.uk/rss/news", "en", "gb", "official"),
    ("Bank of Canada", "https://www.bankofcanada.ca/content_type/press-releases/feed/", "en", "ca", "official"),
    ("Global Affairs Canada", "https://api.io.canada.ca/io-server/gc/news/en/v2?dept=departmentofforeignaffairstradeanddevelopment&type=newsreleases&sort=publishedDate&orderBy=desc&pick=50&format=atom", "en", "ca", "official"),
    ("Prime Minister of Canada", "https://www.pm.gc.ca/en/news.rss", "en", "ca", "official"),
    ("Reserve Bank of Australia", "https://www.rba.gov.au/rss/rss-cb-media-releases.xml", "en", "au", "official"),
    ("Australia DFAT", "https://www.dfat.gov.au/news/rss.xml", "en", "au", "official"),
    ("Australian Prime Minister", "https://www.pm.gov.au/media/rss.xml", "en", "au", "official"),
    ("Reserve Bank of New Zealand", "https://www.rbnz.govt.nz/feeds/news", "en", "nz", "official"),
    ("NZ Government (Beehive)", "https://www.beehive.govt.nz/releases/feed", "en", "nz", "official"),
    ("Bundesregierung", "https://www.bundesregierung.de/service/rss/breg-de/1151244/feed.xml", "de", "de", "official"),
    ("Auswärtiges Amt", "https://www.auswaertiges-amt.de/de/newsroom/rss", "de", "de", "official"),
    ("Federal Foreign Office", "https://www.auswaertiges-amt.de/en/newsroom/rss", "en", "de", "official"),
    ("Bundesministerium der Verteidigung", "https://www.bmvg.de/service/rss/de/516980/feed", "de", "de", "official"),
    ("Deutsche Bundesbank", "https://www.bundesbank.de/service/rss/de/633286/feed.rss", "de", "de", "official"),
    ("Destatis", "https://www.destatis.de/SiteGlobals/Functions/RSSFeed/DE/RSSNewsfeed/RSSNewsfeed.xml", "de", "de", "official"),
    ("Bundestag", "https://www.bundestag.de/static/appdata/includes/rss/hib.rss", "de", "de", "official"),
    ("Robert Koch-Institut", "https://www.rki.de/SiteGlobals/Functions/RSSFeed/RSSGenerator_nnn=true.xml", "de", "de", "official"),
    ("Österreichisches Außenministerium", "https://www.bmeia.gv.at/rss", "de", "at", "official"),
    ("Swiss Federal Council", "https://www.admin.ch/gov/de/start/dokumentation/medienmitteilungen.rss.html", "de", "ch", "official"),
    ("Swiss Federal Council (en)", "https://www.admin.ch/gov/en/start/documentation/media-releases.rss.html", "en", "ch", "official"),
    ("Swiss National Bank", "https://www.snb.ch/public/en/rss/pressrel", "en", "ch", "official"),
    ("Élysée", "https://www.elysee.fr/front/rss/actualites", "fr", "fr", "official"),
    ("France Diplomatie", "https://www.diplomatie.gouv.fr/spip.php?page=backend-fd&lang=fr", "fr", "fr", "official"),
    ("Gouvernement.fr", "https://www.info.gouv.fr/rss/actualites.rss", "fr", "fr", "official"),
    ("Banque de France", "https://www.banque-france.fr/fr/rss", "fr", "fr", "official"),
    ("Spanish Government (La Moncloa)", "https://www.lamoncloa.gob.es/Paginas/rss.aspx?tipo=16", "es", "es", "official"),
    ("Banco de España", "https://www.bde.es/wbe/es/inicio/rss/rss-notas-prensa.xml", "es", "es", "official"),
    ("Italian Government", "https://www.governo.it/it/rss.xml", "it", "it", "official"),
    ("Farnesina", "https://www.esteri.it/it/feed/", "it", "it", "official"),
    ("Dutch Government", "https://feeds.rijksoverheid.nl/nieuws.rss", "nl", "nl", "official"),
    ("Government of the Netherlands", "https://feeds.government.nl/news.rss", "en", "nl", "official"),
    ("De Nederlandsche Bank", "https://www.dnb.nl/en/rss/", "en", "nl", "official"),
    ("Belgian Foreign Affairs", "https://diplomatie.belgium.be/en/rss.xml", "en", "be", "official"),
    ("Swedish Government", "https://www.government.se/rss/press-releases/", "en", "se", "official"),
    ("Riksbank", "https://www.riksbank.se/en-gb/rss/press-releases/", "en", "se", "official"),
    ("Norwegian Government", "https://www.regjeringen.no/en/rss/Rss/2581966/?documentType=aktuelt/nyheter", "en", "no", "official"),
    ("Finnish Government", "https://valtioneuvosto.fi/en/-/rss", "en", "fi", "official"),
    ("Finland Foreign Ministry", "https://um.fi/rss-feeds", "en", "fi", "official"),
    ("Danish Foreign Ministry", "https://um.dk/en/news/rss", "en", "dk", "official"),
    ("Estonian Government", "https://www.valitsus.ee/en/rss", "en", "ee", "official"),
    ("Lithuanian Foreign Ministry", "https://www.urm.lt/en/rss", "en", "lt", "official"),
    ("Polish Government", "https://www.gov.pl/web/diplomacy/rss", "en", "pl", "official"),
    ("Czech Government", "https://vlada.gov.cz/scripts/rss.php?lang=en", "en", "cz", "official"),
    ("Ukraine President", "https://www.president.gov.ua/en/rss/news/all.rss", "en", "ua", "official"),
    ("Ukraine Foreign Ministry", "https://mfa.gov.ua/en/rss", "en", "ua", "official"),
    ("Ukraine Defence Ministry", "https://www.mil.gov.ua/en/rss.xml", "en", "ua", "official"),
    ("Kremlin", "http://en.kremlin.ru/events/all/feed", "en", "ru", "official"),
    ("Russian Foreign Ministry", "https://mid.ru/en/rss.php", "en", "ru", "official"),
    ("Bank of Russia", "https://www.cbr.ru/rss/eventrss", "ru", "ru", "official"),
    ("Влада Републике Србије", "https://www.srbija.gov.rs/rss/vesti", "sr", "rs", "official"),
    ("Министарство спољних послова Србије", "https://www.mfa.gov.rs/rss", "sr", "rs", "official"),
    ("Народна банка Србије", "https://nbs.rs/sr_RS/rss/", "sr", "rs", "official"),
    ("Predsednik Srbije", "https://www.predsednik.rs/rss", "sr", "rs", "official"),
    ("Turkish Foreign Ministry", "https://www.mfa.gov.tr/rss.en.mfa", "en", "tr", "official"),
    ("Israel PMO", "https://www.gov.il/en/departments/prime_ministers_office/govil-landing-page/rss", "en", "il", "official"),
    ("IDF", "https://www.idf.il/en/rss", "en", "il", "official"),
    ("India MEA", "https://www.mea.gov.in/rss/press-releases.xml", "en", "in", "official"),
    ("India PIB", "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3", "en", "in", "official"),
    ("Reserve Bank of India", "https://rbi.org.in/pressreleases_rss.xml", "en", "in", "official"),
    ("Pakistan Foreign Office", "https://mofa.gov.pk/feed/", "en", "pk", "official"),
    ("Japan MOFA", "https://www.mofa.go.jp/rss/press.xml", "en", "jp", "official"),
    ("Japan Prime Minister", "https://japan.kantei.go.jp/rss/index.xml", "en", "jp", "official"),
    ("Bank of Japan", "https://www.boj.or.jp/en/rss/whatsnew.xml", "en", "jp", "official"),
    ("Korea MOFA", "https://www.mofa.go.kr/eng/rss/rss.do", "en", "kr", "official"),
    ("Korea.net", "https://www.korea.net/koreanet/rss/news/1", "en", "kr", "official"),
    ("China MFA", "https://www.fmprc.gov.cn/eng/rss/", "en", "cn", "official"),
    ("Singapore MFA", "https://www.mfa.gov.sg/rss", "en", "sg", "official"),
    ("Monetary Authority of Singapore", "https://www.mas.gov.sg/rss/media-releases", "en", "sg", "official"),
    ("Hong Kong Government", "https://www.info.gov.hk/gia/rss/general_en.xml", "en", "hk", "official"),
    ("Taiwan MOFA", "https://en.mofa.gov.tw/rss.aspx", "en", "tw", "official"),
    ("Philippine News Agency", "https://www.pna.gov.ph/latest.rss", "en", "ph", "official"),
    ("South Africa Government", "https://www.gov.za/rss.xml", "en", "za", "official"),
    ("South African Reserve Bank", "https://www.resbank.co.za/en/home/rss", "en", "za", "official"),
    ("Kenya State House", "https://www.president.go.ke/feed/", "en", "ke", "official"),
    ("Nigeria Presidency", "https://statehouse.gov.ng/feed/", "en", "ng", "official"),
    ("Brazil Government", "https://www.gov.br/planalto/pt-br/rss.xml", "pt", "br", "official"),
    ("Itamaraty", "https://www.gov.br/mre/pt-br/rss.xml", "pt", "br", "official"),
    ("Banco Central do Brasil", "https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/notas", "pt", "br", "official"),
    ("Mexico Government", "https://www.gob.mx/presidencia/es/archivo/prensa.rss", "es", "mx", "official"),
    ("Argentina Government", "https://www.argentina.gob.ar/noticias/rss", "es", "ar", "official"),
    ("Chile Government", "https://www.gob.cl/noticias/rss/", "es", "cl", "official"),
    ("Colombia Cancillería", "https://www.cancilleria.gov.co/rss.xml", "es", "co", "official"),
    ("UAE WAM", "https://www.wam.ae/en/rss", "en", "ae", "official"),
    ("Saudi Press Agency", "https://www.spa.gov.sa/en/rss", "en", "sa", "official"),
    ("Qatar News Agency", "https://www.qna.org.qa/en/rss", "en", "qa", "official"),
    ("Egypt State Information Service", "https://sis.gov.eg/rss.aspx?lang=en", "en", "eg", "official"),
]

_lock = threading.Lock()
_host_sem: dict[str, threading.Semaphore] = defaultdict(lambda: threading.Semaphore(3))


def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:48] or "src"


def opml_candidates() -> list[dict]:
    out = []
    for name, (country, lang) in OPML_COUNTRIES.items():
        try:
            raw = feeds.fetch(OPML.format(urllib.parse.quote(name)), timeout=20)
            raw = re.sub(rb"&(?!amp;|lt;|gt;|quot;|apos;|#)", b"&amp;", raw)  # some exports have bare &
            root = ET.fromstring(raw)
        except Exception as exc:
            print(f"  opml {name}: {exc}", file=sys.stderr)
            continue
        for group in root.iter("outline"):
            label = group.get("text") or ""
            for o in group:
                url, title = o.get("xmlUrl"), o.get("title") or o.get("text") or ""
                if not url or SKIP_WORDS.search(label + " " + title) and not re.search(r"news|politic|world", label, re.I):
                    continue
                if SKIP_WORDS.search(label):
                    continue
                out.append({"name": title.strip()[:80], "url": url, "lang": lang, "country": country, "type": "news"})
    return out


def family_candidates() -> list[dict]:
    out = []
    for code in RELIEFWEB:
        out.append({"name": f"ReliefWeb – {code.upper()}", "url": f"https://reliefweb.int/country/{code}/rss.xml",
                    "lang": "en", "country": ISO3_2[code], "type": "official"})
    for gl, hl, lang, country in GNEWS:
        ceid = f"{gl}:{hl}" if hl in ("zh-Hans", "zh-Hant", "pt-BR", "pt-PT", "es-419") else f"{gl}:{hl.split('-')[0]}"
        for topic in GNEWS_TOPICS:
            path = f"rss/headlines/section/topic/{topic}" if topic else "rss"
            out.append({"name": f"Google News {country.upper()}/{lang}{' ' + topic.title() if topic else ''}",
                        "url": f"https://news.google.com/{path}?hl={hl}&gl={gl}&ceid={ceid}", "lang": lang, "country": country, "type": "news"})
    for path, lang in BBC:
        out.append({"name": f"BBC {path.split('/')[0].title()}", "url": f"https://feeds.bbci.co.uk/{path}/rss.xml", "lang": lang, "country": "gb", "type": "news"})
    for code in DW:
        lang = {"pt-br": "pt", "fa-ir": "fa", "dari": "prs"}.get(code, code)
        out.append({"name": f"DW ({code})", "url": f"https://rss.dw.com/rdf/rss-{code}-all", "lang": lang, "country": "de", "type": "news"})
        out.append({"name": f"DW top ({code})", "url": f"https://rss.dw.com/rdf/rss-{code}-top", "lang": lang, "country": "de", "type": "news"})
    for code in GV:
        host = f"{code}.globalvoices.org" if code else "globalvoices.org"
        out.append({"name": f"Global Voices ({code or 'en'})", "url": f"https://{host}/feed/", "lang": {"zhs": "zh"}.get(code, code or "en"),
                    "country": "int", "type": "news"})
    for org in GOVUK:
        out.append({"name": "GOV.UK – " + org.replace("-", " ").title(), "url": f"https://www.gov.uk/government/organisations/{org}.atom",
                    "lang": "en", "country": "gb", "type": "official"})
    for code, lang in UN_NEWS_LANGS.items():
        out.append({"name": f"UN News ({code})", "url": f"https://news.un.org/feed/subscribe/{code}/news/all/rss.xml", "lang": lang, "country": "int", "type": "official"})
    for t in UN_NEWS_TOPICS:
        out.append({"name": f"UN News – {t.replace('-', ' ')}", "url": f"https://news.un.org/feed/subscribe/en/news/topic/{t}/feed/rss.xml",
                    "lang": "en", "country": "int", "type": "official"})
    for r in UN_NEWS_REGIONS:
        out.append({"name": f"UN News – {r.replace('-', ' ')}", "url": f"https://news.un.org/feed/subscribe/en/news/region/{r}/feed/rss.xml",
                    "lang": "en", "country": "int", "type": "official"})
    # US-funded international broadcasters: Pangea "api/" feeds per service
    for host, lang, country in [("www.voanews.com", "en", "us"), ("www.voaafrica.com", "en", "us"), ("www.voachinese.com", "zh", "us"),
                                ("www.voaafrique.com", "fr", "us"), ("www.voaportugues.com", "pt", "us"), ("www.voanoticias.com", "es", "us"),
                                ("www.voazimbabwe.com", "en", "zw"), ("www.voaswahili.com", "sw", "us"), ("www.voahausa.com", "ha", "us"),
                                ("www.voasomali.com", "so", "us"), ("www.voaindonesia.com", "id", "us"), ("www.voakorea.com", "ko", "us"),
                                ("www.voatiengviet.com", "vi", "us"), ("www.voaturkce.com", "tr", "us"), ("www.urduvoa.com", "ur", "us"),
                                ("www.radiosvoboda.org", "uk", "ua"), ("www.svoboda.org", "ru", "ru"), ("www.svaboda.org", "be", "by"),
                                ("www.europalibera.org", "ro", "md"), ("www.slobodnaevropa.mk", "mk", "mk"), ("www.evropaelire.org", "sq", "xk"),
                                ("www.azattyq.org", "kk", "kz"), ("rus.azattyq.org", "ru", "kz"), ("www.azattyk.org", "ky", "kg"),
                                ("www.ozodi.org", "tg", "tj"), ("www.ozodlik.org", "uz", "uz"), ("www.azadliq.org", "az", "az"),
                                ("www.radiotavisupleba.ge", "ka", "ge"), ("www.currenttime.tv", "ru", "int"), ("www.idelreal.org", "ru", "ru"),
                                ("www.kavkaz-uzel.eu", "ru", "ru"), ("www.radiomarsho.com", "ru", "ru"), ("www.krymr.com", "ru", "ua"),
                                ("www.azadiradio.com", "prs", "af"), ("www.mashaalradio.com", "ps", "pk"), ("www.radiofarda.com", "fa", "ir"),
                                ("www.alhurra.com", "ar", "us"), ("www.rfa.org/english", "en", "us"), ("www.benarnews.org/english", "en", "us")]:
        out.append({"name": host.replace("www.", "").split("/")[0], "url": f"https://{host}/api/", "lang": lang, "country": country, "type": "news"})
    return out


def curated_candidates() -> list[dict]:
    return [{"name": n, "url": u, "lang": lang, "country": c, "type": t} for n, u, lang, c, t in CURATED]


def verify(cand: dict, max_age: timedelta, timeout: float) -> dict | None:
    host = urllib.parse.urlsplit(cand["url"]).hostname or ""
    with _host_sem[host]:
        try:
            entries = feeds.parse(feeds.fetch(cand["url"], timeout=timeout))
        except Exception:
            return None
    if not entries:
        return None
    cutoff = datetime.now(timezone.utc) - max_age
    dated = [e["published"] for e in entries if e["published"]]
    if dated and max(dated) < cutoff:
        return None  # stale feed
    return {**cand, "_items": len(entries)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(ROOT / "config" / "sources.json"))
    ap.add_argument("--max-age-days", type=float, default=21)
    ap.add_argument("--timeout", type=float, default=15)
    ap.add_argument("--workers", type=int, default=64)
    ap.add_argument("--min", type=int, default=1000, help="refuse to write fewer verified sources than this")
    ap.add_argument("--no-opml", action="store_true", help="skip the awesome-rss-feeds OPML candidates")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    out_path = Path(args.out)
    existing = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {"sources": []}
    current = [dict(s) for s in existing.get("sources", [])]
    cands = current + curated_candidates() + family_candidates() + ([] if args.no_opml else opml_candidates())

    seen, unique = set(), []
    for c in cands:
        key = c["url"].strip().rstrip("/").replace("http://", "https://")
        if key in seen:
            continue
        seen.add(key)
        c.setdefault("lang", "en")
        c.setdefault("type", "official" if re.search(r"\.(gov|gob|gouv|int)\b|un\.org|europa\.eu", c["url"]) else "news")
        c.setdefault("country", "int")
        unique.append(c)
    print(f"Verifying {len(unique)} candidate feeds…", file=sys.stderr)
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda c: verify(c, timedelta(days=args.max_age_days), args.timeout), unique))
    kept = [r for r in results if r]
    print(f"  {len(kept)}/{len(unique)} verified in {time.monotonic() - started:.0f}s", file=sys.stderr)

    ids, out = set(), []
    for s in kept:
        s.pop("_items", None)
        sid = s.get("id") or slug(s["name"])
        base, n = sid, 2
        while sid in ids:
            sid, n = f"{base}-{n}", n + 1
        ids.add(sid)
        s["id"] = sid
        if "homepage" not in s:
            parts = urllib.parse.urlsplit(s["url"])
            s["homepage"] = f"{parts.scheme}://{parts.netloc}/"
        out.append({k: s[k] for k in ("id", "name", "url", "homepage", "lang", "country", "type", "categories", "max_items") if k in s})
    print("  by type:", dict(Counter(s["type"] for s in out)), " languages:", len({s["lang"] for s in out}),
          " countries:", len({s["country"] for s in out}), file=sys.stderr)
    if args.dry_run:
        return 0
    if len(out) < args.min:
        print(f"Only {len(out)} verified sources (< --min {args.min}); not writing.", file=sys.stderr)
        return 1
    existing["sources"] = out
    existing["_comment"] = ("Feeds verified by scripts/find_sources.py (refreshed weekly by .github/workflows/sources.yml). "
                            "lang: ISO 639-1; country: ISO 3166-1 alpha-2 or 'int'; type: news | official.")
    out_path.write_text(json.dumps(existing, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {len(out)} sources to {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
