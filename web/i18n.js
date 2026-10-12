/* World Pulse translations: the engine and the English strings. Other languages register with WP_I18N.add (i18n-de.js, i18n-sr.js).
   Languages: en, de, sr (Serbian Cyrillic) and sr-Latn, which is made from the Cyrillic strings and data by transliteration. */
(() => {
  "use strict";

  const LANGS = {
    en: { dict: "en", locale: "en", name: "English", short: "EN" },
    de: { dict: "de", locale: "de-DE", name: "Deutsch", short: "DE" },
    sr: { dict: "sr", locale: "sr-Cyrl-RS", name: "Српски", short: "SR" },
    "sr-Latn": { dict: "sr", locale: "sr-Latn-RS", name: "Srpski", short: "SR" },
  };
  const KEY = "wp.lang";

  // A string, or for counts an object of plural forms ({one, few, other}, as Intl.PluralRules names them) picked by vars.n.
  const EN = {
    "app.name": "World Pulse",
    "app.description": "Live conflict tracker, AI world brief, and global deals and crises. Free app and public API, open source.",

    // chrome: masthead, dateline, sections, tab bar
    "chrome.skip": "Skip to content",
    "chrome.back": "Back",
    "chrome.refresh": "Refresh",
    "chrome.sections": "Sections",
    "chrome.tabs": "App",
    "chrome.live": "Live",
    "chrome.offline": "You're offline — showing the last saved update.",
    "chrome.updated": "Updated {time}",
    "chrome.updated_day": "Updated {date}, {time}",
    "sec.top": "Top stories",
    "sec.conflicts": "Conflicts",
    "sec.latest": "Latest",
    "tab.today": "Today",
    "tab.conflicts": "Conflicts",
    "tab.latest": "Latest",
    "tab.saved": "Saved",
    "tab.more": "More",

    // language switcher
    "lang.label": "Language",
    "lang.button": "Language: {name}",
    "lang.script": "Serbian script",
    "lang.cyrl": "Ћир",
    "lang.latn": "Lat",
    "lang.cyrl_name": "Cyrillic",
    "lang.latn_name": "Latin",

    // route titles
    "route.brief": "Today",
    "route.conflicts": "Conflict tracker",
    "route.conflict": "Conflict",
    "route.feed": "Latest news",
    "route.saved": "Saved",
    "route.more": "More",
    "route.support": "Support World Pulse",

    // times
    "time.now": "just now",
    "time.today": "Today",
    "time.yesterday": "Yesterday",

    // toasts and errors
    "toast.unsaved": "Removed from saved",
    "toast.saved": "Saved for later",
    "toast.copied": "Link copied",
    "toast.uptodate": "Up to date",
    "toast.refresh_failed": "Couldn't refresh — showing saved data",
    "toast.sources_failed": "Couldn't load sources",
    "error.load": "Couldn't load the news. Check your connection and try again.",
    "error.retry": "Try again",

    // labels
    "status.critical": "Critical",
    "status.high": "High",
    "status.elevated": "Elevated",
    "status.watch": "Watch",
    "status.quiet": "Quiet",
    "trend.escalating": "Escalating",
    "trend.de-escalating": "De-escalating",
    "trend.steady": "Steady",
    "trend.quiet": "Quiet",
    // the trend inside a sentence ("trend steady")
    "trend_in.escalating": "escalating",
    "trend_in.de-escalating": "de-escalating",
    "trend_in.steady": "steady",
    "trend_in.quiet": "quiet",
    "tone.crisis": "Crisis",
    "tone.deal": "Deal",
    "tone.mixed": "Deal · Crisis",
    "mood.crisis_dominated": "Crisis-dominated",
    "mood.tense": "Tense",
    "mood.balanced": "Balanced",
    "mood.constructive": "Constructive",
    "mood.dealmaking_dominated": "Dealmaking-dominated",
    "explain.tension_index": "Share of crisis coverage among crisis + deal coverage in the last 24h (0 = all deals, 100 = all crises).",
    "cat.deals": "Deals",
    "cat.crises": "Crises",
    "cat.conflict": "Conflict & Security",
    "cat.disasters": "Disasters",
    "cat.humanitarian": "Humanitarian",
    "cat.economy": "Economy & Markets",
    "cat.diplomacy": "Diplomacy",
    "cat.climate": "Climate & Energy",
    "cat.health": "Health",
    "cat.tech": "Technology",
    "catdesc.deals": "Agreements, treaties, trade pacts, mergers, acquisitions, investments and ceasefires.",
    "catdesc.crises": "Wars, disasters, outbreaks, humanitarian emergencies, coups and economic shocks.",
    "catdesc.conflict": "Armed conflict, military action, terrorism and security.",
    "catdesc.disasters": "Natural hazards and disaster alerts.",
    "catdesc.humanitarian": "Aid, refugees, famine, displacement and human rights.",
    "catdesc.economy": "Markets, trade, inflation, central banks, companies and jobs.",
    "catdesc.diplomacy": "Summits, talks, sanctions, elections and international relations.",
    "catdesc.climate": "Climate change, emissions, energy transition and the environment.",
    "catdesc.health": "Public health, outbreaks, medicine and health systems.",
    "catdesc.tech": "AI, chips, cybersecurity and big tech.",
    "region.africa": "Africa",
    "region.asia": "Asia",
    "region.europe": "Europe",
    "region.middle-east": "Middle East",
    "region.americas": "Americas",
    "region.oceania": "Oceania",
    "signal.escalation": "escalation",
    "signal.de-escalation": "de-escalation",
    "signal.humanitarian": "humanitarian",
    "signal.diplomatic": "diplomatic",

    // AI labels
    "ai.badge": "AI-assisted · Claude",
    "ai.short": "AI",
    "ai.disclaimer": "Written by AI from the linked reports; it can make mistakes. Check the original sources.",
    "rules.disclaimer": "Automated digest of the most-covered stories.",
    "ai.untranslated": "Not translated yet; showing the English original.",

    // stories
    "story.save": "Save story",
    "story.share": "Share story",
    "story.severity": "Severity {n} of 5",
    "story.more_reports": { one: "{n} more report on this story", other: "{n} more reports on this story" },
    "story.outlets": { one: "{n} outlet", other: "{n} outlets" },

    // map
    "map.hot": "Hotspots",
    "map.world": "World",
    "map.europe": "Europe",
    "map.middle-east": "Middle East",
    "map.africa": "Africa",
    "map.asia": "Asia",
    "map.americas": "Americas",
    "map.group": "Map region",
    "map.label": "Map of tracked conflicts",
    "map.dot": "{name}: {status}, {trend}",
    "map.legend": "Pulsing = critical or escalating",

    // front page
    "front.title": "Today's front page",
    "front.empty": "No new stories in the last 24 hours yet.",
    "front.top": "Top stories",
    "front.all_latest": "All the latest",
    "brief.name": "The World Brief",
    "brief.desk": "World Pulse desk",
    "brief.automated": "Automated digest",
    "brief.watch": "Watch next",
    "brief.video": "Video",
    "brief.video_title": "Today's brief as vertical slides for TikTok, Reels and Shorts",
    "brief.share": "Share",
    "brief.share_text": "Today's world brief: {headline}",
    "brief.rule_headline": { one: "{mood} day: {n} conflict in the news", other: "{mood} day: {n} conflicts in the news" },
    "brief.rule_escalating": ", {n} escalating",
    "brief.rule_watch": { one: "{theater}: {n} report in the last 24 hours, trend {trend}.", other: "{theater}: {n} reports in the last 24 hours, trend {trend}." },
    "monitor.title": "Conflict monitor",
    "monitor.full": "Full tracker",
    "monitor.active": { one: "active conflict", other: "active conflicts" },
    "monitor.critical": { one: "critical", other: "critical" },
    "monitor.escalating": { one: "escalating", other: "escalating" },
    "monitor.none": "No tracked conflict has reports in the last 24 hours.",
    "monitor.row": "{name}: {status}, {trend}, intensity {n} of 100",
    "most.title": "Most covered",
    "most.fine": "Ranked by the number of outlets reporting in the last 24 hours.",
    "latest.title": "Latest",
    "latest.wire": "The wire",
    "tension.title": "Global tension",
    "tension.gauge": "Tension index {n} of 100",
    "tension.deals": "Deals",
    "tension.crises": "Crises",
    "tension.chart": "Tension index on each of the last 7 days",
    "tension.day": "{date}: {n}/100",

    // conflict tracker
    "conflicts.title": "Conflict monitor",
    "conflicts.unavailable": "Conflict data is not available yet.",
    "conflicts.dek": "Where the tracked conflicts stand right now, measured by the number and severity of news reports.",
    "conflicts.filter": "Filter conflicts",
    "conflicts.f_active": "Active",
    "conflicts.f_escalating": "Escalating",
    "conflicts.f_all": "All",
    "conflicts.h_status": "Status",
    "conflicts.h_conflict": "Conflict and latest dispatch",
    "conflicts.h_reports": "Reports, 24h",
    "conflicts.h_intensity": "Intensity",
    "conflicts.h_trend": "Trend",
    "conflicts.h_week": "7 days",
    "conflicts.nothing": "Nothing here right now.",
    "conflicts.with_reports": { one: "with reports in the last 24 hours", other: "with reports in the last 24 hours" },
    "conflicts.critical": { one: "critical", other: "critical" },
    "conflicts.escalating": { one: "escalating", other: "escalating" },
    "conflicts.de_escalating": { one: "de-escalating", other: "de-escalating" },
    "conflicts.fine": "Intensity combines the number and severity of reports in the last 24 hours. It reflects news coverage, not verified casualty data.",
    "conflicts.reports_24h": { one: "report in 24h", other: "reports in 24h" },
    "conflicts.intensity": "Intensity",

    // one conflict
    "conflict.untracked": "This conflict isn't tracked.",
    "conflict.show_more": { one: "Show {n} more", other: "Show {n} more" },
    "conflict.kpi_intensity": "intensity, out of 100",
    "conflict.kpi_24h": { one: "report in the last 24 hours", other: "reports in the last 24 hours" },
    "conflict.kpi_7d": { one: "report in the last 7 days", other: "reports in the last 7 days" },
    "conflict.situation": "Situation",
    "conflict.automated": "Automated",
    "conflict.outlook": "Outlook",
    "conflict.ai_fine": "{ago} · Written by AI from the linked reports; it can make mistakes.",
    "conflict.rules_fine": "Automated summary from report counts.",
    "conflict.week": "Last 7 days",
    "conflict.chart": "Daily report severity over 7 days",
    "conflict.chart_day": { one: "{date}: {n} report, severity {severity}", other: "{date}: {n} reports, severity {severity}" },
    "conflict.signals_fine": "Signals count today's reports by what they describe.",
    "conflict.dispatches": "Latest dispatches ({n})",
    "conflict.share": "Share",
    "conflict.share_text": "{name}: {status}, {trend} — World Pulse conflict tracker",
    "conflict.rule_recent": {
      one: "{n} report in the last 24 hours and {week} this week. Trend: {trend}.",
      other: "{n} reports in the last 24 hours and {week} this week. Trend: {trend}.",
    },
    "conflict.rule_none": { one: "No new reports in the last 24 hours. {n} report over the past week.", other: "No new reports in the last 24 hours. {n} reports over the past week." },

    // latest, saved
    "feed.title": "Latest",
    "feed.dek": "The newest reports from {n} news and humanitarian feeds, as they come in.",
    "feed.region": "Region",
    "feed.all_regions": "All regions",
    "feed.search": "Search news",
    "feed.more": "Show more",
    "feed.count": { one: "{n} story", other: "{n} stories" },
    "feed.none": "No stories match these filters.",
    "feed.only_lang": "Only stories in English",
    "route.story": "Story",
    "story.brief": "The situation in brief",
    "story.background": "Background",
    "story.ai_fine": "Written by AI from this report, related coverage and the conflict tracker; it can make mistakes. Check the original.",
    "story.rules_fine": "Automated: the report's excerpt and background from the conflict tracker.",
    "story.related": "Related reports",
    "story.read_original": "Read the original at {source}",
    "story.not_found": "This story is no longer in the archive.",
    "story.translated": "Translated",
    "story.original": "Original",
    "saved.title": "Saved",
    "saved.empty": "Nothing saved yet. Tap the bookmark on any story to keep it here — saved stories stay on this device, even offline.",
    "saved.dek": "Saved stories stay on this device, even offline.",
    "saved.count": { one: "{n} saved story", other: "{n} saved stories" },
    "saved.clear": "Clear all",
    "saved.confirm": "Remove all saved stories?",

    // more
    "more.title": "More",
    "more.dek": "Settings, how World Pulse is made, and the free data behind it.",
    "more.app": "App",
    "more.install": "Install on this device",
    "more.installed": "Installed",
    "more.install_btn": "Install app",
    "more.install_ios": "Tap Share, then “Add to Home Screen”",
    "more.install_other": "Use your browser menu: “Install app”",
    "more.appearance": "Appearance",
    "more.theme": "Theme",
    "more.theme_system": "System",
    "more.theme_light": "Light",
    "more.theme_dark": "Dark",
    "more.language": "Language",
    "more.video": "Video of today's brief",
    "more.updated": "Data updated",
    "more.ai": "AI analysis",
    "more.ai_on": { one: "With each update, Claude ({model}) reads new conflict reports to tag the conflict, severity and signal, and writes the world brief and situation summaries. {n} story in this edition was analysed by AI.", other: "With each update, Claude ({model}) reads new conflict reports to tag the conflict, severity and signal, and writes the world brief and situation summaries. {n} stories in this edition were analysed by AI." },
    "more.ai_off": "AI analysis is off for this edition, so the brief and situation summaries are automated from rules.",
    "more.ai_fine": "AI output is labelled wherever it appears and always links to the original reporting. It can make mistakes — check the sources for anything important.",
    "more.ai_langs": "The AI brief and situation summaries are also translated into German and Serbian. Headlines stay in the language they were published in.",
    "more.sources": "Sources",
    "more.sources_text": "{ok} of {n} public news and humanitarian feeds were reachable at the last update. Headlines and excerpts belong to their publishers.",
    "more.show_sources": { one: "Show {n} source", other: "Show {n} sources" },
    "more.items": { one: "{n} item", other: "{n} items" },
    "more.unavailable": "unavailable",
    "more.developers": "Developers",
    "more.api": "Free public API — docs",
    "more.api_fine": "JSON · no key",
    "more.openapi": "OpenAPI spec",
    "more.rss": "Conflicts RSS",
    "more.code": "Source code",
    "more.free": "Keep it free",
    "more.free_text": "The news, the conflict monitor and the World Brief stay free, with no tracking. World Pulse Pro subscribers keep it running.",
    "more.plans": "Plans and World Pulse Pro",
    "more.colophon": "World Pulse · build {build}",

    // support
    "support.tip": "Tip on Ko-fi",
    "support.email": "Daily email",
    "support.tiktok": "Follow on TikTok",
    "support.contact": "Contact",
    "support.title": "Support World Pulse",
    "route.pro": "World Pulse Pro",
    "pro.headline": "Know what happens next.",
    "pro.dek": "Pro gives you the deeper picture of the world's conflicts, every day, for the price of a coffee a month.",
    "pro.f.briefing": "Daily Pro Intelligence Briefing.",
    "pro.f.briefing.d": "The top hotspots: what changed, why it matters, the risk outlook and what to watch.",
    "pro.f.trends": "90-day conflict trends.",
    "pro.f.trends.d": "See how every conflict has moved over three months.",
    "pro.f.alerts": "Instant breaking alerts.",
    "pro.f.alerts.d": "A push the moment a conflict turns critical.",
    "pro.f.watchlist": "Your watchlist.",
    "pro.f.watchlist.d": "Follow the conflicts you care about.",
    "pro.f.no_nudges": "No nudges.",
    "pro.f.no_nudges.d": "A clean, ad-free app.",
    "pro.f.export": "Export.",
    "pro.f.export.d": "Download stories as CSV or JSON.",
    "pro.go": "Go Pro",
    "pro.soon": "Pro is launching soon. Check back in a few days.",
    "pro.how": "Subscribe on Ko-fi with your email. Your personal key arrives by email within minutes: tap the link in it to unlock.",
    "pro.have_key": "Already a member?",
    "pro.key_ph": "Your Pro key",
    "pro.unlock": "Unlock",
    "pro.checking": "Checking your key…",
    "pro.welcome": "Welcome to World Pulse Pro!",
    "pro.invalid": "That key isn't valid. Check it, or use the link in your email.",
    "pro.expired": "Your Pro key has expired. Renew on Ko-fi to continue.",
    "pro.signout": "Sign out of Pro",
    "pro.briefing": "Pro Intelligence Briefing",
    "pro.risk": "Risk",
    "pro.watch": "Watch next",
    "pro.alerts_btn": "Turn on Pro alerts",
    "support.headline": "World Pulse is free and independent.",
    "support.nudge": "The news, the conflict monitor and the World Brief are free for everyone, with no tracking and no sign-up. Readers who subscribe to World Pulse Pro keep it that way.",
    "support.button": "Support World Pulse",
    "support.from": "Plans from {price}",
    "support.from_period": "Plans from {price} / {period}",
    "support.soon": "World Pulse is free for everyone. Ways to support it are coming soon.",
    "support.dek": "The news, the conflict monitor and the World Brief are free for everyone, with no tracking and no sign-up. World Pulse Pro subscribers pay for the AI analysis and the hosting, and keep it that way.",
    "support.choose": "Choose",
    "support.other": "Other ways to help",
    "support.pay_note": "Subscriptions are handled by Ko-fi, by card or PayPal, and you can cancel at any time. World Pulse never sees your card details.",
    "period.month": "month",
    "period.week": "week",
    "period.year": "year",
    "ad.label": "Advertisement",

    // video brief (story.html)
    "story.title": "Video brief · World Pulse",
    "story.kicker": "Video brief",
    "story.heading": "Today's video",
    "story.step1": "Start your phone's screen recording.",
    "story.step2": "Tap <b>Play</b>. It runs by itself for about 45 seconds.",
    "story.step3": "Stop recording on the last frame, trim the start in TikTok, and add a sound or your own voice.",
    "story.loading": "Loading…",
    "story.play": { one: "Play · about {n} second", other: "Play · about {n} seconds" },
    "story.failed": "Couldn't load today's brief",
    "story.download": "Or download today's finished video with voiceover",
    "story.back": "Back to the app",
  };

  const DICTS = { en: EN };
  const warned = new Set();

  // ---------------------------------------------------------------------------
  // Serbian Cyrillic to Latin

  const CYR = "АБВГДЂЕЖЗИЈКЛЉМНЊОПРСТЋУФХЦЧЏШабвгдђежзијклљмнњопрстћуфхцчџш";
  const LAT = ["A", "B", "V", "G", "D", "Đ", "E", "Ž", "Z", "I", "J", "K", "L", "Lj", "M", "N", "Nj", "O", "P", "R", "S", "T", "Ć", "U", "F", "H", "C", "Č", "Dž", "Š",
    "a", "b", "v", "g", "d", "đ", "e", "ž", "z", "i", "j", "k", "l", "lj", "m", "n", "nj", "o", "p", "r", "s", "t", "ć", "u", "f", "h", "c", "č", "dž", "š"];
  const MAP = new Map([...CYR].map((c, i) => [c, LAT[i]]));
  const isUpper = (c) => !!c && c !== c.toLowerCase() && c === c.toUpperCase();
  const isLetter = (c) => !!c && c.toLowerCase() !== c.toUpperCase();

  // Љ, Њ and Џ become LJ, NJ, DŽ inside an all-caps word (ЊУЈОРК, ЏЕП) and Lj, Nj, Dž otherwise (Његош, Џон).
  function latin(text) {
    if (!text || !/[Ѐ-ӿ]/.test(text)) return text;
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const l = MAP.get(c);
      if (l == null) { out += c; continue; }
      if (l.length === 2 && isUpper(c)) {
        const next = text[i + 1], prev = text[i - 1];
        const caps = isLetter(next) ? isUpper(next) : isUpper(prev);
        out += caps ? l.toUpperCase() : l;
      } else out += l;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // language choice: ?lang= in the URL, else the saved choice, else the browser's languages

  function normalize(code) {
    const c = String(code || "").trim().toLowerCase();
    if (!c) return null;
    if (c === "sr-latn" || c.startsWith("sr-latn-") || ["hr", "bs", "sh", "cnr"].includes(c.split("-")[0])) return "sr-Latn";
    if (c === "sr" || c.startsWith("sr-")) return "sr";
    if (c === "de" || c.startsWith("de-")) return "de";
    if (c === "en" || c.startsWith("en-")) return "en";
    return null;
  }

  function detect() {
    for (const l of navigator.languages || [navigator.language]) { const n = normalize(l); if (n) return n; }
    return "en";
  }

  function fromUrl() {
    try {
      const q = new URLSearchParams(location.search).get("lang");
      if (q) return normalize(q);
      const h = location.hash.split("?")[1];
      return h ? normalize(new URLSearchParams(h).get("lang")) : null;
    } catch { return null; }
  }

  function saved() {
    try { const v = JSON.parse(localStorage.getItem(KEY)); return LANGS[v] ? v : null; } catch { return null; }
  }

  let current = fromUrl() || saved() || detect();
  let urlLang = fromUrl(); // a ?lang= link applies to this visit only, until the reader picks a language
  const fmt = {};
  function formats() {
    const loc = LANGS[current].locale;
    if (fmt.loc === loc) return fmt;
    fmt.loc = loc;
    fmt.plural = new Intl.PluralRules(loc);
    fmt.num = new Intl.NumberFormat(loc);
    fmt.rel = new Intl.RelativeTimeFormat(loc, { numeric: "always", style: "narrow" });
    return fmt;
  }

  // ---------------------------------------------------------------------------
  // lookup

  function lookup(dict, key) {
    const d = DICTS[dict];
    return d && Object.prototype.hasOwnProperty.call(d, key) ? d[key] : undefined;
  }

  function t(key, vars) {
    const dict = LANGS[current].dict;
    let s = lookup(dict, key);
    if (s === undefined) {
      if (dict !== "en" && !warned.has(`${dict}:${key}`)) { warned.add(`${dict}:${key}`); console.warn(`i18n: missing ${dict} string "${key}"`); }
      s = lookup("en", key);
      if (s === undefined) {
        if (!warned.has(key)) { warned.add(key); console.warn(`i18n: unknown string "${key}"`); }
        return key;
      }
    }
    if (typeof s === "object") {
      const n = vars && typeof vars.n === "number" ? vars.n : 0;
      s = s[formats().plural.select(n)] || s.other;
    }
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? (typeof vars[k] === "number" ? num(vars[k]) : String(vars[k])) : m));
    return current === "sr-Latn" ? latin(s) : s;
  }

  // Text that comes in the data language (Serbian data is Cyrillic): Latin script when the reader chose it.
  const tx = (s) => (current === "sr-Latn" && typeof s === "string" ? latin(s) : s);

  // A translated field of a data object's i18n block ({de: {...}, sr: {...}}), or null when there is none.
  function field(i18n, name) {
    const v = i18n && i18n[LANGS[current].dict];
    if (current === "en" || !v) return null;
    const x = name == null ? v : v[name];
    if (typeof x === "string") return x ? tx(x) : null;
    if (Array.isArray(x)) return x.map(tx);
    return x == null ? null : x;
  }

  const num = (n) => formats().num.format(n);
  const date = (d, opts) => new Date(d).toLocaleDateString(LANGS[current].locale, opts);
  const time = (d) => new Date(d).toLocaleTimeString(LANGS[current].locale, { hour: "2-digit", minute: "2-digit" });
  const dateTime = (d) => new Date(d).toLocaleString(LANGS[current].locale, { dateStyle: "medium", timeStyle: "short" });
  function ago(d) {
    const s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 90) return t("time.now");
    const rel = formats().rel;
    if (s < 3600) return rel.format(-Math.round(s / 60), "minute");
    if (s < 86400) return rel.format(-Math.round(s / 3600), "hour");
    return rel.format(-Math.round(s / 86400), "day");
  }

  // ---------------------------------------------------------------------------
  // static markup: data-i18n (text), data-i18n-html (trusted markup from the dictionaries), data-i18n-aria, -title, -placeholder and -content

  function apply(root) {
    const r = root || document;
    r.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = t(n.dataset.i18n); });
    r.querySelectorAll("[data-i18n-html]").forEach((n) => { n.innerHTML = t(n.dataset.i18nHtml); });
    r.querySelectorAll("[data-i18n-aria]").forEach((n) => { n.setAttribute("aria-label", t(n.dataset.i18nAria)); });
    r.querySelectorAll("[data-i18n-title]").forEach((n) => { n.setAttribute("title", t(n.dataset.i18nTitle)); });
    r.querySelectorAll("[data-i18n-placeholder]").forEach((n) => { n.setAttribute("placeholder", t(n.dataset.i18nPlaceholder)); });
    r.querySelectorAll("[data-i18n-content]").forEach((n) => { n.setAttribute("content", t(n.dataset.i18nContent)); });
    if (!root) document.documentElement.lang = current;
  }

  function set(lang, opts = {}) {
    if (!LANGS[lang]) return;
    current = lang;
    if (opts.persist !== false) {
      try { localStorage.setItem(KEY, JSON.stringify(lang)); } catch { /* private mode: keep going */ }
      // The reader chose: drop a ?lang= from the address, so a reload keeps their choice.
      if (urlLang) {
        urlLang = null;
        try {
          const u = new URL(location.href);
          u.searchParams.delete("lang");
          history.replaceState(history.state, "", u.href);
        } catch { /* keep the address as it is */ }
      }
    }
    apply();
    window.dispatchEvent(new CustomEvent("wp:lang", { detail: { lang } }));
  }

  function add(dict, strings) { DICTS[dict] = Object.assign(DICTS[dict] || {}, strings); }

  window.WP_I18N = {
    LANGS, t, tx, field, latin, num, date, time, dateTime, ago, apply, set, add, detect, normalize,
    get lang() { return current; },
    get dict() { return LANGS[current].dict; },
    get locale() { return LANGS[current].locale; },
    // For links that should open in the reader's language (share links, the video's iframes).
    get param() { return current === "en" ? "" : `lang=${encodeURIComponent(current)}`; },
    keys: () => Object.keys(EN),
    strings: (dict) => DICTS[dict] || {},
  };
})();
