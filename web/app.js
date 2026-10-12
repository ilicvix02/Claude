(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // config, state, storage

  const CFG = Object.assign({ apiBase: "api/v1/", bundledApi: "api/v1/", build: "dev" }, window.WP_CONFIG || {});
  const PAGE = 25;
  const TOP_LAT = (window.WP_LAND && window.WP_LAND.top) || 84;
  const S = {
    index: null, all: [], byId: new Map(), state: null, conflicts: null, brief: null, sources: null,
    loadedAt: 0, generatedAt: null, route: null, installEvent: null,
    feed: { cat: "", region: "", q: "", shown: PAGE },
    mapView: "hot", conflictFilter: "active",
  };
  // The front page and conflict pages add columns at these widths (the same breakpoints as styles.css).
  const WIDE = matchMedia("(min-width: 900px)");
  const WIDER = matchMedia("(min-width: 1200px)");

  // Translations (i18n.js): tr() for interface strings, tx() for Serbian data text in the reader's script.
  const I18N = window.WP_I18N;
  const tr = I18N.t, tx = I18N.tx;

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: keep going */ } },
  };

  // ---------------------------------------------------------------------------
  // DOM helpers

  const $ = (sel) => document.querySelector(sel);
  const SVG_NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    setAttrs(n, attrs);
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
    return n;
  }
  function svg(tag, attrs, ...kids) {
    const n = document.createElementNS(SVG_NS, tag);
    setAttrs(n, attrs);
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
    return n;
  }
  function setAttrs(n, attrs) {
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.setAttribute("class", v);
      else if (k === "text") n.textContent = v;
      else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
  }

  const ICONS = {
    bookmark: "M6 3h12v18l-6-4-6 4z",
    share: "M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6",
    bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
    empty: "M6 3h12v18l-6-4-6 4z",
    video: "M3 7h12v10H3zM15 11l6-3.5v9L15 13",
    globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z",
    lock: "M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11", // World Pulse Pro: locked content
  };
  const icon = (name) => svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, svg("path", { d: ICONS[name] }));

  // Only ever put http(s) links into the page.
  function safeUrl(u) {
    try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; }
  }

  const ago = (iso) => (iso ? I18N.ago(iso) : "");
  const clock = (iso) => I18N.time(iso);
  const shortDate = (iso) => I18N.date(iso, { day: "numeric", month: "short" });
  const longTime = (iso) => I18N.dateTime(iso);
  const weekday = (day) => I18N.date(day + "T12:00:00Z", { weekday: "narrow" });
  const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();
  const timeEl = (iso, text) => el("time", { datetime: iso, title: longTime(iso), text });
  // Shareable link to a view of the public web app (in the native app, location is a local file URL).
  const appUrl = (hash) => {
    const fromApi = /^https?:/.test(CFG.apiBase) ? CFG.apiBase.replace(/api\/v1\/?$/, "") : "";
    const site = (S.index && S.index.site && S.index.site.base_url) || fromApi || location.href.split("#")[0];
    const lang = I18N.param; // the shared link opens in the sender's language
    return `${site.replace(/\/$/, "")}/${lang ? `?${lang}` : ""}${hash}`;
  };
  const hoursOld = (iso) => (Date.now() - new Date(iso).getTime()) / 3.6e6;

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  }

  // ---------------------------------------------------------------------------
  // data

  async function getJSON(base, file) {
    const r = await fetch(base + file, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
    return r.json();
  }

  async function loadFrom(base) {
    const files = ["index.json", "all.json", "state.json", "conflicts.json", "brief.json"];
    const res = await Promise.allSettled(files.map((f) => getJSON(base, f)));
    if (res[0].status === "rejected" || res[1].status === "rejected") throw res[0].reason || res[1].reason;
    return res.map((r) => (r.status === "fulfilled" ? r.value : null));
  }

  async function load() {
    let data;
    try {
      data = await loadFrom(CFG.apiBase);
    } catch (err) {
      // Native app builds point at the live site and ship a bundled copy for the first offline launch.
      if (CFG.bundledApi && CFG.bundledApi !== CFG.apiBase) data = await loadFrom(CFG.bundledApi);
      else throw err;
    }
    const [index, all, state, conflicts, brief] = data;
    S.index = index.data;
    S.all = all.data;
    S.byId = new Map(S.all.map((a) => [a.id, a]));
    S.state = state && state.data;
    S.conflicts = conflicts && conflicts.data;
    S.brief = brief && brief.data;
    S.generatedAt = all.meta.generated_at;
    S.loadedAt = Date.now();
    S.sources = null;
    updateChrome();
  }

  function updateChrome() {
    updateDateline();
    buildSections();
  }

  // Dateline under the nameplate: today's date, when this edition was built, and a LIVE marker while it is fresh.
  function updateDateline() {
    const now = new Date();
    const today = $("#today");
    today.textContent = I18N.date(now, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    today.setAttribute("datetime", now.toISOString().slice(0, 10));
    const up = $("#updated");
    if (S.generatedAt) {
      up.textContent = isToday(S.generatedAt) ? tr("chrome.updated", { time: clock(S.generatedAt) }) : tr("chrome.updated_day", { date: shortDate(S.generatedAt), time: clock(S.generatedAt) });
      up.title = `${longTime(S.generatedAt)} (${ago(S.generatedAt)})`;
    }
    // The build runs every few hours; past six hours old (or offline) the edition is no longer "live".
    $("#live").hidden = !(S.generatedAt && navigator.onLine && hoursOld(S.generatedAt) < 6);
  }

  // Section strip: the three app sections, then every topic as a filtered Latest page.
  const SECTION_ORDER = ["deals", "crises", "economy", "diplomacy", "climate", "health", "disasters", "humanitarian", "conflict", "tech"];
  function buildSections() {
    const nav = $("#sections");
    const rank = (id) => { const i = SECTION_ORDER.indexOf(id); return i < 0 ? 99 : i; };
    const cats = [...((S.index && S.index.categories) || [])].sort((a, b) => rank(a.id) - rank(b.id));
    nav.querySelectorAll("[data-cat]").forEach((n) => n.remove());
    nav.append(...cats.map((c) => el("a", { href: `#/feed?c=${encodeURIComponent(c.id)}`, "data-cat": c.id, text: catLabel(c.id) })));
    markSections();
  }

  function markSections() {
    const r = S.route;
    if (!r) return;
    const nav = $("#sections");
    const cat = r.name === "feed" ? r.params.get("c") || "" : null;
    const sec = r.name === "conflict" ? "conflicts" : r.name;
    let current = null;
    for (const a of nav.querySelectorAll("a")) {
      const on = a.dataset.cat ? a.dataset.cat === cat : a.dataset.sec === sec && !(sec === "feed" && cat);
      if (on) { a.setAttribute("aria-current", "page"); current = a; } else a.removeAttribute("aria-current");
    }
    nav.classList.toggle("overflows", nav.scrollWidth > nav.clientWidth + 1); // fades the edge when there is more to scroll
    // Keep the current section in view inside the strip, without scrolling the page.
    if (current) {
      const box = nav.getBoundingClientRect(), item = current.getBoundingClientRect();
      if (item.left < box.left || item.right > box.right) nav.scrollLeft += item.left - box.left - 16;
    }
  }

  // ---------------------------------------------------------------------------
  // saved stories

  const SAVED_KEY = "wp.saved";
  const savedList = () => store.get(SAVED_KEY, []);
  const isSaved = (id) => savedList().some((s) => s.id === id);
  function toggleSave(a, btn) {
    let list = savedList();
    if (list.some((s) => s.id === a.id)) {
      list = list.filter((s) => s.id !== a.id);
      toast(tr("toast.unsaved"));
    } else {
      const keep = ["id", "title", "url", "summary", "insight", "image", "source", "published_at", "categories", "regions", "theaters", "severity", "tone", "analysis"];
      list.unshift(Object.fromEntries(keep.filter((k) => k in a).map((k) => [k, a[k]])));
      toast(tr("toast.saved"));
    }
    store.set(SAVED_KEY, list.slice(0, 300));
    if (btn) btn.setAttribute("aria-pressed", String(isSaved(a.id)));
  }

  async function share(title, url) {
    if (navigator.share) {
      try { await navigator.share({ title, url }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); toast(tr("toast.copied")); } catch { toast(url); }
  }

  // ---------------------------------------------------------------------------
  // shared components

  const statusLabel = (s) => (["critical", "high", "elevated", "watch", "quiet"].includes(s) ? tr(`status.${s}`) : s);
  const TREND = { escalating: ["up", "▲"], "de-escalating": ["down", "▼"], steady: ["", "●"], quiet: ["", "○"] };
  const trendWord = (trend) => (TREND[trend] ? tr(`trend_in.${trend}`) : trend); // inside a sentence
  const toneLabel = (tone) => (["crisis", "deal", "mixed"].includes(tone) ? tr(`tone.${tone}`) : null);
  const BROAD = ["crises", "deals", "conflict"]; // too broad to label a single story with

  const statusPill = (t) => el("span", { class: `status st st-${t.status}` }, el("i", { class: "mk", "aria-hidden": "true" }), statusLabel(t.status));
  const trendBadge = (t) => {
    const [cls, glyph] = TREND[t.trend] || ["", ""];
    return el("span", { class: `trend ${cls}` }, glyph ? el("i", { "aria-hidden": "true", text: glyph }) : null, trendLabel(t));
  };
  const trendLabel = (t) => (TREND[t.trend] ? tr(`trend.${t.trend}`) : t.trend);
  // A theater's name and description in the reader's language (conflicts.json i18n), else the English original.
  const tName = (t) => I18N.field(t.i18n, "name") || t.name;
  const tDesc = (t) => I18N.field(t.i18n, "description") || t.description;
  const theaterName = (id) => { const t = theaterById(id); return t ? tName(t) : id; };
  const theaterById = (id) => (S.conflicts ? S.conflicts.theaters.find((t) => t.id === id) : null);
  // Categories and regions are labelled by id; one the dictionaries don't know keeps the API's English label.
  const known = (key) => key in I18N.strings("en");
  const regionLabel = (id) => (known(`region.${id}`) ? tr(`region.${id}`) : ((S.index.regions || []).find((r) => r.id === id) || {}).label || id);
  const catLabel = (id) => (known(`cat.${id}`) ? tr(`cat.${id}`) : ((S.index.categories || []).find((c) => c.id === id) || {}).label || id);
  const catDesc = (c) => (known(`catdesc.${c.id}`) ? tr(`catdesc.${c.id}`) : c.description);
  const aiLabel = (isAI, otherwise) => el("span", { class: `badge${isAI ? " ai" : ""}`, text: isAI ? tr("ai.badge") : otherwise });

  function sevBars(n) {
    return el("span", { class: "sev", title: tr("story.severity", { n }), "aria-label": tr("story.severity", { n }), role: "img" },
      ...[1, 2, 3, 4, 5].map((i) => el("i", { class: i <= n ? "on" : "" })));
  }

  function sparkline(t) {
    const max = Math.max(1, ...t.history.map((d) => d.severity));
    return el("span", { class: "spark", "aria-hidden": "true" },
      ...t.history.map((d) => el("i", { class: d.severity ? "" : "zero", style: { height: `${Math.max(8, (100 * d.severity) / max)}%` } })));
  }

  // A number with its label underneath, for the small data boxes.
  const figure = (value, label, cls) => el("div", { class: `fig${cls ? ` ${cls}` : ""}` }, el("b", { text: value }), el("span", { text: label }));

  function pageHead(title, opts = {}) {
    return el("header", { class: "page-head" },
      opts.kicker ? el("p", { class: "kicker" }, opts.kicker) : null,
      el("h1", { text: title }),
      opts.dek ? el("p", { class: "dek", text: opts.dek }) : null);
  }

  function sectionHead(title, link) {
    return el("div", { class: "section-h" }, el("h2", { text: title }), link || null);
  }

  // Inline items with a space between them, so a line can wrap between items (the separators are drawn in CSS).
  const spaced = (...nodes) => nodes.filter(Boolean).flatMap((n, i) => (i ? [" ", n] : [n]));

  // The red kicker above a headline: the conflicts a story belongs to (except the one whose page we are on), else its topics and regions.
  function kicker(a, skipTheater) {
    const theaters = (a.theaters || []).filter((id) => id !== skipTheater);
    const topics = (a.categories || []).filter((c) => !BROAD.includes(c)).slice(0, 2);
    const regions = (a.theaters || []).length ? [] : (a.regions || []).slice(0, 2);
    const parts = [
      ...theaters.map((id) => el("a", { href: `#/conflict/${id}`, text: theaterName(id) })),
      ...topics.map((c) => el("span", { text: catLabel(c) })),
      ...regions.map((r) => el("span", { class: "rg", text: regionLabel(r) })),
    ];
    return parts.length ? el("p", { class: "kicker" }, ...spaced(...parts)) : null;
  }

  // One story. kind: "list" (ruled list, thumbnail on the right), "lead" (front-page lead) or "wire" (time column).
  function storyItem(a, opts = {}) {
    const url = safeUrl(a.url);
    const kind = opts.kind || "list";
    const img = opts.noImage ? null : a.image && safeUrl(a.image);
    const tone = toneLabel(a.tone);
    const saveBtn = el("button", { class: "icon-btn", "aria-label": tr("story.save"), "aria-pressed": String(isSaved(a.id)) }, icon("bookmark"));
    saveBtn.addEventListener("click", () => { toggleSave(a, saveBtn); if (opts.onChange) opts.onChange(); });

    const others = opts.cluster ? S.all.filter((x) => x.cluster === a.id && x.id !== a.id) : [];
    return el(opts.tag || "li", { class: `story${kind === "list" ? "" : ` ${kind}`}${img ? "" : " noimg"}` },
      kind === "wire" ? el("time", { class: "stamp", datetime: a.published_at, title: longTime(a.published_at), text: clock(a.published_at) }) : null,
      el("div", { class: "story-main" },
        el("div", { class: "story-text" },
          kicker(a, opts.theater),
          el(kind === "lead" ? "h2" : "h3", { class: "hl" }, el("a", { href: url, target: "_blank", rel: "noopener", text: a.title })),
          a.insight
            ? el("p", { class: "insight" }, el("span", { class: "badge ai", text: tr("ai.short") }), " ", a.insight)
            : a.summary ? el("p", { class: "excerpt", text: a.summary }) : null),
        img ? el("img", { src: img, alt: "", loading: kind === "lead" ? "eager" : "lazy", decoding: "async", referrerpolicy: "no-referrer", onerror: (e) => { e.target.closest(".story").classList.add("noimg"); e.target.remove(); } }) : null),
      others.length
        ? el("details", { class: "also" },
            el("summary", { text: tr("story.more_reports", { n: others.length }) }),
            el("ul", {}, ...others.map((o) => el("li", {}, el("a", { href: safeUrl(o.url), target: "_blank", rel: "noopener" }, el("b", { text: o.source.name }), ` ${o.title}`)))))
        : null,
      el("div", { class: "story-foot" },
        el("p", { class: "meta" }, ...spaced(
          a.severity >= 2 ? sevBars(a.severity) : (tone ? el("span", { class: `tone ${a.tone}`, text: tone }) : null),
          el("b", { text: a.source.name }),
          kind === "wire" ? null : timeEl(a.published_at, ago(a.published_at)),
          a.coverage > 1 ? el("span", { text: tr("story.outlets", { n: a.coverage }) }) : null)),
        el("div", { class: "actions" },
          saveBtn,
          el("button", { class: "icon-btn", "aria-label": tr("story.share"), onclick: () => share(a.title, url) }, icon("share")))));
  }

  function dayLabel(iso) {
    const d = new Date(iso), today = new Date();
    const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
    if (diff === 0) return tr("time.today");
    if (diff === 1) return tr("time.yesterday");
    return I18N.date(d, { weekday: "long", day: "numeric", month: "short" });
  }

  // Wire-style list: stories under day headings, each with its time in the left column.
  function wireGroups(items, opts = {}) {
    const groups = [];
    for (const a of items) {
      const label = dayLabel(a.published_at);
      if (!groups.length || groups[groups.length - 1][0] !== label) groups.push([label, []]);
      groups[groups.length - 1][1].push(a);
    }
    return groups.map(([label, list]) => el("section", { class: "day" },
      el(opts.heading || "p", { class: "day-h", text: label }),
      el("ol", { class: "stories" }, ...list.map((a) => storyItem(a, { kind: "wire", cluster: opts.cluster, noImage: opts.noImage, theater: opts.theater })))));
  }

  // ---------------------------------------------------------------------------
  // map

  // Each view's label is the string map.<id>.
  const MAP_VIEWS = {
    hot: [-25, 135, 58, -12],
    world: [-180, 180, 75, -45],
    europe: [-12, 55, 62, 34],
    "middle-east": [25, 65, 42, 8],
    africa: [-20, 55, 28, -18],
    asia: [58, 140, 48, -8],
    americas: [-110, -50, 30, -2],
  };

  function mapCard(theaters) {
    const wrap = el("div", { class: "map-wrap" });
    const zoom = el("div", { class: "map-zoom", role: "group", "aria-label": tr("map.group") });
    const draw = () => {
      const [lon0, lon1, lat1, lat0] = MAP_VIEWS[S.mapView];
      const w = lon1 - lon0, h = lat1 - lat0, k = w / 160;
      const root = svg("svg", { class: "map", viewBox: `${lon0 + 180} ${TOP_LAT - lat1} ${w} ${h}`, preserveAspectRatio: "xMidYMid meet", role: "img", "aria-label": tr("map.label") });
      if (window.WP_LAND) root.append(svg("path", { class: "land", d: window.WP_LAND.d }));
      const shown = theaters.filter((t) => t.stories_7d > 0).sort((a, b) => a.intensity - b.intensity);
      const labels = svg("g", { class: "labels", "aria-hidden": "true" });
      const placed = []; // label boxes so far, so names never print over each other or over another dot
      for (const t of shown) {
        const cx = t.lon + 180, cy = TOP_LAT - t.lat, r = k * (1.6 + t.intensity / 28);
        const g = svg("g", { class: `st st-${t.status}`, tabindex: "0", role: "link", "aria-label": tr("map.dot", { name: tName(t), status: statusLabel(t.status), trend: trendWord(t.trend) }) });
        if (t.status === "critical" || t.trend === "escalating") g.append(svg("circle", { class: "ring", cx, cy, r, "stroke-width": k * 0.6 }));
        g.append(svg("circle", { class: "dot", cx, cy, r, "stroke-width": k * 0.4 }, svg("title", { text: tName(t) })));
        const go = () => { location.hash = `#/conflict/${t.id}`; };
        g.addEventListener("click", go);
        g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
        root.append(g);
      }
      const dots = shown.filter((t) => t.intensity >= 30).map((t) => { const r = k * (1.6 + t.intensity / 28); return { id: t.id, x0: t.lon + 180 - r, x1: t.lon + 180 + r, y0: TOP_LAT - t.lat - r, y1: TOP_LAT - t.lat + r }; });
      // Name the most intense hotspots first, right of the dot, else left of it, else not at all.
      for (const t of [...shown].reverse()) {
        if (!(t.status === "critical" || t.status === "high" || k < 0.6)) continue;
        const cx = t.lon + 180, cy = TOP_LAT - t.lat, r = k * (1.6 + t.intensity / 28), fs = k * 4.4;
        const name = tName(t), w = name.length * fs * 0.56, h = fs * 1.1;
        const spots = [[cx + r + k * 1.2, "start", cx + r + k * 1.2], [cx - r - k * 1.2, "end", cx - r - k * 1.2 - w]];
        const blocked = [...placed, ...dots.filter((d) => d.id !== t.id)];
        const free = spots.find(([, , x0]) => !blocked.some((b) => x0 < b.x1 && x0 + w > b.x0 && cy - h / 2 < b.y1 && cy + h / 2 > b.y0));
        if (!free) continue;
        placed.push({ x0: free[2], x1: free[2] + w, y0: cy - h / 2, y1: cy + h / 2 });
        labels.append(svg("text", { class: "label", x: free[0], y: cy + k * 1.5, "text-anchor": free[1], "font-size": fs, "stroke-width": k * 1.2, text: name }));
      }
      root.append(labels);
      wrap.replaceChildren(root);
      zoom.replaceChildren(...Object.keys(MAP_VIEWS).map((id) =>
        el("button", { class: "chip", "aria-pressed": String(S.mapView === id), onclick: () => { S.mapView = id; draw(); } }, tr(`map.${id}`))));
    };
    draw();
    const legend = el("div", { class: "map-legend" },
      ...["critical", "high", "elevated", "watch"].map((s) => el("span", { class: `st st-${s}` }, el("i"), statusLabel(s))),
      el("span", { text: tr("map.legend") }));
    return el("figure", { class: "map-card" }, wrap, zoom, legend);
  }

  // ---------------------------------------------------------------------------
  // front page

  function topStories(limit) {
    const now = Date.now();
    const leads = S.all.filter((a) => (a.cluster || a.id) === a.id && now - new Date(a.published_at) < 864e5);
    const score = (a) => 2 * (a.coverage || 1) + 1.5 * (a.severity || 0) + ((a.categories || []).some((c) => c === "crises" || c === "deals") ? 1.5 : 0) - hoursOld(a.published_at) / 8;
    return leads.sort((a, b) => score(b) - score(a)).slice(0, limit);
  }

  // Events reported by the most outlets in the last 24 hours (the lead story is already on top of the page).
  function mostCovered(exclude, limit) {
    const now = Date.now();
    return S.all.filter((a) => (a.cluster || a.id) === a.id && a !== exclude && (a.coverage || 1) > 1 && now - new Date(a.published_at) < 864e5)
      .sort((a, b) => b.coverage - a.coverage || new Date(b.published_at) - new Date(a.published_at))
      .slice(0, limit);
  }

  // The brief's text in the reader's language: the AI translation (brief.json i18n), the rules headline rebuilt
  // from its counts, or the English original. In rules mode the bullets are publishers' headlines and stay as they are.
  function briefText(b) {
    const out = { headline: b.headline, bullets: b.bullets.map((x) => x.text), watch: b.watch, translated: true };
    if (I18N.lang === "en") return out;
    const r = b.rule;
    if (b.source !== "ai" && r) {
      const mood = MOODS.includes(r.mood_key) ? tr(`mood.${r.mood_key}`) : "";
      if (mood) out.headline = tr("brief.rule_headline", { mood, n: r.active_conflicts }) + (r.escalating > 0 ? tr("brief.rule_escalating", { n: r.escalating }) : "");
      const w = r.watch;
      out.watch = w ? tr("brief.rule_watch", { theater: theaterName(w.theater), n: w.stories_24h, trend: trendWord(w.trend) }) : b.watch;
      return out;
    }
    const v = I18N.field(b.i18n);
    if (v && v.headline && Array.isArray(v.bullets) && v.bullets.length === b.bullets.length) {
      return { headline: tx(v.headline), bullets: v.bullets.map(tx), watch: v.watch ? tx(v.watch) : null, translated: true };
    }
    out.translated = b.source !== "ai";
    return out;
  }
  const MOODS = ["crisis_dominated", "tense", "balanced", "constructive", "dealmaking_dominated"];

  function briefColumn() {
    const b = S.brief;
    if (!b) return null;
    const isAI = b.source === "ai";
    const text = briefText(b);
    return el("article", { class: "brief" },
      el("h2", { class: "brief-name", text: tr("brief.name") }),
      el("h3", { class: "brief-hl", text: text.headline }),
      el("p", { class: "byline" },
        el("span", { class: "by", text: tr("brief.desk") }),
        timeEl(b.generated_at, ago(b.generated_at)),
        aiLabel(isAI, tr("brief.automated"))),
      text.translated ? null : el("p", { class: "fine untranslated", text: tr("ai.untranslated") }),
      el("ol", { class: "bullets" }, ...b.bullets.map((x, i) => el("li", {},
        el("p", { text: text.bullets[i] }),
        x.stories.length ? el("p", { class: "cites" }, ...x.stories.map((s) => el("a", { class: "cite", href: safeUrl(s.url), target: "_blank", rel: "noopener", text: s.coverage > 1 ? `${s.source.name} +${s.coverage - 1}` : s.source.name }))) : null))),
      text.watch ? el("p", { class: "watch" }, el("b", { text: tr("brief.watch") }), " ", text.watch) : null,
      el("p", { class: "fine disclaimer", text: b.disclaimer_key === "rules" ? tr("rules.disclaimer") : b.disclaimer_key === "ai" ? tr("ai.disclaimer") : b.disclaimer }),
      el("div", { class: "brief-actions" },
        el("a", { class: "btn ghost", href: storyHref(), title: tr("brief.video_title") }, icon("video"), tr("brief.video")),
        el("button", { class: "btn ghost", onclick: () => share(tr("brief.share_text", { headline: text.headline }), appUrl("#/brief")) }, icon("share"), tr("brief.share"))));
  }
  const storyHref = () => (I18N.param ? `story.html?${I18N.param}` : "story.html");

  function monitorRow(t) {
    return el("li", {}, el("a", { class: `mon-row st st-${t.status}`, href: `#/conflict/${t.id}`, "aria-label": tr("monitor.row", { name: tName(t), status: statusLabel(t.status), trend: trendWord(t.trend), n: t.intensity }) },
      el("span", { class: "mk", "aria-hidden": "true" }),
      el("b", { class: "nm", text: tName(t) }),
      el("span", { class: "iv", text: t.intensity }),
      el("small", {}, statusLabel(t.status), " · ", trendBadge(t)),
      sparkline(t)));
  }

  function monitorBox() {
    const conf = S.conflicts;
    if (!conf) return null;
    const ov = conf.overview;
    const rows = conf.theaters.filter((t) => t.stories_24h > 0).slice(0, 6);
    return el("section", { class: "box monitor" },
      el("div", { class: "box-top" }, el("h2", { class: "box-h", text: tr("monitor.title") }), el("a", { class: "more-link", href: "#/conflicts", text: tr("monitor.full") })),
      el("div", { class: "figures" },
        figure(I18N.num(ov.active), tr("monitor.active", { n: ov.active })),
        figure(I18N.num(ov.critical), tr("monitor.critical", { n: ov.critical }), ov.critical ? "hot" : ""),
        figure(I18N.num(ov.escalating), tr("monitor.escalating", { n: ov.escalating }))),
      rows.length ? el("ol", { class: "mon-rows" }, ...rows.map(monitorRow)) : el("p", { class: "fine", text: tr("monitor.none") }));
  }

  function mostCoveredBox(list) {
    if (!list.length) return null;
    return el("section", { class: "box most" },
      el("h2", { class: "box-h", text: tr("most.title") }),
      el("ol", { class: "ranked" }, ...list.map((a) => el("li", {},
        el("a", { href: safeUrl(a.url), target: "_blank", rel: "noopener", text: a.title }),
        el("p", { class: "meta" }, ...spaced(el("span", { text: tr("story.outlets", { n: a.coverage }) }), el("b", { text: a.source.name }), timeEl(a.published_at, ago(a.published_at))))))),
      el("p", { class: "fine", text: tr("most.fine") }));
  }

  // The newest reports, wire style, for the rail on wider screens.
  function latestBox(exclude, limit) {
    const items = S.all.filter((a) => (a.cluster || a.id) === a.id && !exclude.includes(a)).slice(0, limit);
    if (!items.length) return null;
    return el("section", { class: "box latest" },
      el("div", { class: "box-top" }, el("h2", { class: "box-h", text: tr("latest.title") }), el("a", { class: "more-link", href: "#/feed", text: tr("latest.wire") })),
      el("ol", { class: "latest-list" }, ...items.map((a) => el("li", {},
        el("time", { datetime: a.published_at, title: longTime(a.published_at), text: clock(a.published_at) }),
        el("a", { href: safeUrl(a.url), target: "_blank", rel: "noopener", text: a.title }),
        el("span", { class: "src", text: a.source.name })))));
  }

  function tensionBox() {
    const st = S.state;
    if (!st) return null;
    const hist = st.history || [];
    return el("section", { class: "box tension" },
      el("h2", { class: "box-h", text: tr("tension.title") }),
      el("div", { class: "tension-top" },
        el("p", { class: "big-num" }, el("b", { text: st.tension_index }), el("span", { text: "/100" })),
        el("p", { class: "mood", text: MOODS.includes(st.mood_key) ? tr(`mood.${st.mood_key}`) : st.mood })),
      el("div", { class: "gauge", role: "img", "aria-label": tr("tension.gauge", { n: st.tension_index }) }, el("i", { style: { left: `${st.tension_index}%` } })),
      el("div", { class: "gauge-legend" }, el("span", { text: tr("tension.deals") }), el("span", { text: tr("tension.crises") })),
      hist.length ? el("div", { class: "mini-chart", role: "img", "aria-label": tr("tension.chart") },
        ...hist.map((d) => el("div", { title: tr("tension.day", { date: shortDate(d.date + "T12:00:00Z"), n: d.tension }) },
          el("i", { style: { height: `${Math.max(3, 0.75 * d.tension)}%` } }),
          el("span", { text: weekday(d.date) })))) : null,
      el("p", { class: "fine", text: st.explanation_key === "tension_index" ? tr("explain.tension_index") : st.explanation }));
  }

  function renderBrief() {
    const top = topStories(24);
    const pick = top.slice(0, 3).findIndex((a) => a.image && safeUrl(a.image)); // prefer a lead with a picture
    const lead = top.splice(Math.max(0, pick), 1)[0];
    const most = mostCovered(lead, 5);
    const rest = top.filter((a) => !most.includes(a)).slice(0, 8);
    const parts = {
      lead: lead ? storyItem(lead, { kind: "lead", tag: "article", cluster: true }) : el("p", { class: "empty", text: tr("front.empty") }),
      brief: briefColumn(),
      monitor: monitorBox(),
      most: mostCoveredBox(most),
      top: rest.length ? el("section", { class: "top-stories" },
        sectionHead(tr("front.top"), el("a", { class: "more-link", href: "#/feed", text: tr("front.all_latest") })),
        el("ol", { class: "stories" }, ...rest.map((a) => storyItem(a, { cluster: true })))) : null,
      tension: tensionBox(),
      latest: WIDE.matches ? latestBox([lead, ...most, ...rest], 6) : null,
      nudge: supportNudge(),
      ad: adSlot(),
    };
    const col = (cls, ...keys) => el("div", { class: `col ${cls}` }, ...keys.map((k) => parts[k]));
    // Each layout gets its own reading order, so keyboard and screen-reader order matches what is on screen.
    const cols = WIDER.matches ? [col("col-main", "lead", "top"), col("col-brief", "brief", "most"), col("col-rail", "monitor", "tension", "nudge", "latest", "ad")]
      : WIDE.matches ? [col("col-main", "lead", "brief", "top"), col("col-rail", "monitor", "most", "tension", "nudge", "latest", "ad")]
        : [col("col-main", "lead", "brief", "monitor", "most", "top", "tension", "nudge", "ad")];
    return el("div", { class: `front cols-${cols.length}` }, el("h1", { class: "sr-only", text: tr("front.title") }), ...cols);
  }

  // ---------------------------------------------------------------------------
  // conflict monitor

  function deskRow(t) {
    const last = (t.latest || [])[0];
    return el("li", {}, el("a", { class: `desk-row st st-${t.status}`, href: `#/conflict/${t.id}` },
      el("span", { class: "c-status" }, statusPill(t)),
      el("span", { class: "c-main" },
        el("b", { class: "c-name", text: tName(t) }),
        el("span", { class: "c-region", text: regionLabel(t.region) }),
        t.analysis && t.analysis.summary ? el("span", { class: "c-sum", text: analysisText(t).summary }) : null,
        last ? el("span", { class: "c-latest" },
          el("time", { datetime: last.published_at, text: isToday(last.published_at) ? clock(last.published_at) : shortDate(last.published_at) }), " ",
          el("span", { text: last.title })) : null),
      el("span", { class: "c-n" }, el("b", { text: I18N.num(t.stories_24h) }), el("span", { class: "lbl", text: tr("conflicts.reports_24h", { n: t.stories_24h }) })),
      el("span", { class: "c-iv" }, el("span", { class: "sr-only", text: tr("conflicts.intensity") }), el("b", { text: I18N.num(t.intensity) })),
      el("span", { class: "c-trend" }, trendBadge(t)),
      el("span", { class: "c-spark" }, sparkline(t))));
  }

  function renderConflicts() {
    const conf = S.conflicts;
    if (!conf) return el("div", { class: "page" }, pageHead(tr("conflicts.title")), el("p", { class: "empty", text: tr("conflicts.unavailable") }));
    const all = conf.theaters;
    const filters = {
      active: [tr("conflicts.f_active"), (t) => t.stories_24h > 0],
      escalating: [tr("conflicts.f_escalating"), (t) => t.trend === "escalating"],
      all: [tr("conflicts.f_all"), () => true],
    };
    const list = el("ol", { class: "desk" });
    const tabs = el("div", { class: "tabs", role: "group", "aria-label": tr("conflicts.filter") });
    const draw = () => {
      const [, fn] = filters[S.conflictFilter];
      const shown = all.filter(fn);
      tabs.replaceChildren(...Object.entries(filters).map(([id, [label, f]]) =>
        el("button", { class: "tab", "aria-pressed": String(S.conflictFilter === id), onclick: () => { S.conflictFilter = id; draw(); } },
          label, el("span", { class: "n", text: all.filter(f).length }))));
      list.replaceChildren(
        el("li", { class: "desk-head", "aria-hidden": "true" },
          el("span", { text: tr("conflicts.h_status") }), el("span", { text: tr("conflicts.h_conflict") }), el("span", { text: tr("conflicts.h_reports") }),
          el("span", { text: tr("conflicts.h_intensity") }), el("span", { text: tr("conflicts.h_trend") }), el("span", { text: tr("conflicts.h_week") })),
        ...(shown.length ? shown.map(deskRow) : [el("li", { class: "empty", text: tr("conflicts.nothing") })]));
    };
    draw();
    const ov = conf.overview;
    return el("div", { class: "page wide monitor-page" },
      pageHead(tr("conflicts.title"), { dek: tr("conflicts.dek") }),
      el("div", { class: "monitor-top" },
        el("div", {},
          el("div", { class: "figures overview" },
            figure(I18N.num(ov.active), tr("conflicts.with_reports", { n: ov.active })),
            figure(I18N.num(ov.critical), tr("conflicts.critical", { n: ov.critical }), ov.critical ? "hot" : ""),
            figure(I18N.num(ov.escalating), tr("conflicts.escalating", { n: ov.escalating })),
            figure(I18N.num(ov.de_escalating), tr("conflicts.de_escalating", { n: ov.de_escalating }))),
          el("p", { class: "fine", text: tr("conflicts.fine") })),
        mapCard(all)),
      tabs,
      list);
  }

  // A theater analysis in the reader's language: the AI translation, the rules summary rebuilt from its counts,
  // or the English original. developments[i] is the text of analysis.developments[i].
  function analysisText(t) {
    const an = t.analysis;
    const out = { summary: an.summary, outlook: an.outlook, developments: an.developments.map((d) => d.text), translated: true };
    if (I18N.lang === "en") return out;
    const r = an.rule;
    if (an.source !== "ai" && r) {
      if (r.key === "recent_reports") out.summary = tr("conflict.rule_recent", { n: r.stories_24h, week: I18N.num(r.stories_7d), trend: trendWord(r.trend) });
      else if (r.key === "no_recent_reports") out.summary = tr("conflict.rule_none", { n: r.stories_7d });
      return out;
    }
    const v = I18N.field(an.i18n);
    if (v && v.summary) {
      out.summary = tx(v.summary);
      if (v.outlook) out.outlook = tx(v.outlook);
      if (Array.isArray(v.developments) && v.developments.length === out.developments.length) out.developments = v.developments.map(tx);
      return out;
    }
    out.translated = an.source !== "ai";
    return out;
  }

  function renderConflict(id) {
    const t = theaterById(id);
    if (!t) return el("div", { class: "page" }, el("p", { class: "empty", text: tr("conflict.untracked") }));
    setTitle(tName(t));
    const an = t.analysis;
    const isAI = an && an.source === "ai";
    const text = an ? analysisText(t) : null;
    const max = Math.max(1, ...t.history.map((d) => d.severity));
    const stories = S.all.filter((a) => (a.theaters || []).includes(t.id));
    const timeline = el("div", { class: "wire" });
    let shown = 20;
    const drawTimeline = () => {
      timeline.replaceChildren(
        ...wireGroups(stories.slice(0, shown), { noImage: true, theater: t.id }),
        stories.length > shown ? el("button", { class: "more-btn", text: tr("conflict.show_more", { n: Math.min(20, stories.length - shown) }), onclick: () => { shown += 20; drawTimeline(); } }) : null);
    };
    drawTimeline();
    const sig = t.signals_24h;

    const head = el("header", { class: "page-head conflict-head" },
      el("p", { class: "kicker" }, ...spaced(el("a", { href: "#/conflicts", text: tr("conflicts.title") }), el("span", { class: "rg", text: regionLabel(t.region) }))),
      el("h1", { text: tName(t) }),
      el("p", { class: "dek", text: tDesc(t) }),
      el("p", { class: "status-line" }, statusPill(t), trendBadge(t)));
    const kpis = el("div", { class: "figures kpis" },
      figure(I18N.num(t.intensity), tr("conflict.kpi_intensity")),
      figure(I18N.num(t.stories_24h), tr("conflict.kpi_24h", { n: t.stories_24h })),
      figure(I18N.num(t.stories_7d), tr("conflict.kpi_7d", { n: t.stories_7d })));
    const situation = an ? el("section", { class: "situation" },
      el("div", { class: "section-h" }, el("h2", { text: tr("conflict.situation") }), aiLabel(isAI, tr("conflict.automated"))),
      text.translated ? null : el("p", { class: "fine untranslated", text: tr("ai.untranslated") }),
      el("p", { class: "body-text", text: text.summary }),
      text.outlook ? el("p", { class: "outlook" }, el("b", { text: tr("conflict.outlook") }), " ", text.outlook) : null,
      an.developments.length ? el("ul", { class: "devs" }, ...an.developments.map((d, i) => el("li", {},
        el("p", { text: text.developments[i] }),
        el("a", { href: safeUrl(d.story.url), target: "_blank", rel: "noopener", text: `${d.story.source.name} · ${ago(d.story.published_at)}` })))) : null,
      el("p", { class: "fine", text: isAI ? tr("conflict.ai_fine", { ago: ago(an.generated_at) }) : tr("conflict.rules_fine") })) : null;
    const week = el("section", { class: "week" },
      sectionHead(tr("conflict.week")),
      el("div", { class: "chart", role: "img", "aria-label": tr("conflict.chart") },
        ...t.history.map((d) => el("div", { title: tr("conflict.chart_day", { date: shortDate(d.date + "T12:00:00Z"), n: d.stories, severity: d.severity }) },
          el("span", { text: d.stories || "" }),
          el("i", { style: { height: `${(80 * d.severity) / max}%` } }),
          el("span", { text: weekday(d.date) })))),
      el("ul", { class: "signals" },
        el("li", { class: "up" }, el("i", { "aria-hidden": "true", text: "▲" }), el("b", { text: I18N.num(sig.escalation) }), el("span", { text: tr("signal.escalation") })),
        el("li", { class: "down" }, el("i", { "aria-hidden": "true", text: "▼" }), el("b", { text: I18N.num(sig["de-escalation"]) }), el("span", { text: tr("signal.de-escalation") })),
        el("li", {}, el("i", { "aria-hidden": "true", text: "✚" }), el("b", { text: I18N.num(sig.humanitarian) }), el("span", { text: tr("signal.humanitarian") })),
        el("li", {}, el("i", { "aria-hidden": "true", text: "◆" }), el("b", { text: I18N.num(sig.diplomatic) }), el("span", { text: tr("signal.diplomatic") }))),
      el("p", { class: "fine", text: tr("conflict.signals_fine") }));
    const reports = el("section", { class: "dispatches" },
      el("div", { class: "section-h" }, el("h2", { text: tr("conflict.dispatches", { n: stories.length }) }),
        el("button", { class: "text-btn", onclick: () => share(tr("conflict.share_text", { name: tName(t), status: statusLabel(t.status), trend: trendWord(t.trend) }), appUrl(`#/conflict/${t.id}`)) }, icon("share"), tr("conflict.share"))),
      timeline);
    const body = WIDE.matches
      ? [el("div", { class: "conflict-grid" }, el("div", { class: "col col-main" }, situation, reports), el("div", { class: "col col-rail" }, kpis, week))]
      : [kpis, situation, week, reports];
    return el("div", { class: `page wide conflict st st-${t.status}` }, head, ...body);
  }

  // ---------------------------------------------------------------------------
  // latest, saved

  function renderFeed(_, params) {
    const f = S.feed;
    const cat = params.get("c") || "";
    if (cat !== f.cat) f.shown = PAGE;
    f.cat = cat; f.region = params.get("r") || ""; f.q = params.get("q") || "";
    const section = (S.index.categories || []).find((c) => c.id === f.cat);
    if (section) setTitle(catLabel(section.id));
    const region = el("select", { "aria-label": tr("feed.region") }, el("option", { value: "", text: tr("feed.all_regions") }),
      ...S.index.regions.map((r) => el("option", { value: r.id, text: regionLabel(r.id) })));
    const q = el("input", { type: "search", placeholder: tr("feed.search"), "aria-label": tr("feed.search"), value: f.q, enterkeyhint: "search" });
    const count = el("p", { class: "count" });
    const list = el("div", { class: "wire" });
    const more = el("button", { class: "more-btn", text: tr("feed.more") });

    const writeHash = () => {
      const p = new URLSearchParams();
      if (f.cat) p.set("c", f.cat);
      if (f.region) p.set("r", f.region);
      if (f.q) p.set("q", f.q);
      history.replaceState(null, "", `#/feed${p.toString() ? `?${p}` : ""}`);
    };
    const matches = () => {
      const needle = f.q.trim().toLowerCase();
      return S.all.filter((a) =>
        (a.cluster || a.id) === a.id &&
        (!f.cat || (a.categories || []).includes(f.cat)) &&
        (!f.region || (a.regions || []).includes(f.region)) &&
        (!needle || `${a.title} ${a.summary} ${a.source.name} ${a.insight || ""}`.toLowerCase().includes(needle)));
    };
    const draw = () => {
      writeHash();
      region.value = f.region;
      const items = matches();
      count.textContent = items.length ? tr("feed.count", { n: items.length }) : "";
      list.replaceChildren(...(items.length ? wireGroups(items.slice(0, f.shown), { cluster: true, heading: "h2" }) : [el("p", { class: "empty", text: tr("feed.none") })]));
      more.hidden = items.length <= f.shown;
    };
    region.addEventListener("change", () => { f.region = region.value; f.shown = PAGE; draw(); });
    let timer;
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { f.q = q.value; f.shown = PAGE; draw(); }, 180); });
    more.addEventListener("click", () => { f.shown += PAGE; draw(); });
    draw();
    return el("div", { class: "page" },
      pageHead(section ? catLabel(section.id) : tr("feed.title"), { dek: section ? catDesc(section) : tr("feed.dek", { n: S.index.sources_total }) }),
      el("div", { class: "filters" }, region, q), count, list, more);
  }

  function renderSaved() {
    const wrap = el("div", { class: "page" });
    const draw = () => {
      const list = savedList();
      if (!list.length) {
        wrap.replaceChildren(pageHead(tr("saved.title")),
          el("div", { class: "empty" }, icon("empty"), el("p", { text: tr("saved.empty") })));
        return;
      }
      wrap.replaceChildren(
        pageHead(tr("saved.title"), { dek: tr("saved.dek") }),
        el("div", { class: "section-h" }, el("h2", { text: tr("saved.count", { n: list.length }) }),
          el("button", { class: "text-btn", text: tr("saved.clear"), onclick: () => { if (confirm(tr("saved.confirm"))) { store.set(SAVED_KEY, []); draw(); } } })),
        el("ol", { class: "stories" }, ...list.map((a) => storyItem({ coverage: 1, ...a }, { onChange: draw }))));
    };
    draw();
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // more, support

  function renderMore() {
    const idx = S.index;
    const rev = idx.revenue || {};
    const theme = store.get("wp.theme", "system");
    const seg = el("div", { class: "seg", role: "group", "aria-label": tr("more.theme") });
    const drawSeg = (cur) => seg.replaceChildren(...["system", "light", "dark"].map((m) =>
      el("button", { "aria-pressed": String(cur === m), onclick: () => setTheme(m, drawSeg), text: tr(`more.theme_${m}`) })));
    drawSeg(theme);

    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone || window.Capacitor;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    let install;
    if (standalone) install = el("span", { class: "ok", text: tr("more.installed") });
    else if (S.installEvent) install = el("button", { class: "btn", text: tr("more.install_btn"), onclick: async () => { S.installEvent.prompt(); await S.installEvent.userChoice; S.installEvent = null; render(); } });
    else if (ios) install = el("span", { class: "fine", text: tr("more.install_ios") });
    else install = el("span", { class: "fine", text: tr("more.install_other") });

    const ai = idx.ai || {};
    const sourcesBox = el("div", {}, el("button", { class: "btn ghost", text: tr("more.show_sources", { n: idx.sources_total }), onclick: showSources }));
    async function showSources() {
      try {
        if (!S.sources) S.sources = (await getJSON(CFG.apiBase, "sources.json")).data;
      } catch { try { S.sources = (await getJSON(CFG.bundledApi, "sources.json")).data; } catch { toast(tr("toast.sources_failed")); return; } }
      sourcesBox.replaceChildren(el("ul", { class: "list" }, ...S.sources.map((s) => el("li", {},
        el("a", { href: safeUrl(s.homepage) || safeUrl(s.feed), target: "_blank", rel: "noopener", text: s.name }),
        el("span", { class: s.ok ? "ok fine" : "bad fine", text: s.ok ? tr("more.items", { n: s.items }) : tr("more.unavailable") })))));
    }

    const plans = (rev.plans || []).filter((p) => payUrl(p.url));
    const links = supportLinks(rev);
    const docs = new URL("docs.html", location.href).href;

    return el("div", { class: "page more" },
      pageHead(tr("more.title"), { dek: tr("more.dek") }),
      sectionHead(tr("more.app")),
      el("ul", { class: "list" },
        el("li", {}, el("span", { text: tr("more.install") }), install),
        el("li", {}, el("span", { text: tr("more.appearance") }), seg),
        el("li", {}, el("span", { text: tr("more.language") }), langSwitch()),
        el("li", {}, el("a", { href: storyHref(), text: tr("more.video") }), el("span", { class: "fine", text: "TikTok · Reels · Shorts" })),
        el("li", {}, el("span", { text: tr("more.updated") }), el("span", { class: "fine", text: S.generatedAt ? longTime(S.generatedAt) : "—" }))),
      sectionHead(tr("more.ai")),
      el("div", { class: "prose" },
        el("p", { text: ai.enabled ? tr("more.ai_on", { model: ai.model, n: ai.analysed_stories }) : tr("more.ai_off") }),
        el("p", { class: "fine", text: tr("more.ai_fine") }),
        I18N.lang !== "en" ? el("p", { class: "fine", text: tr("more.ai_langs") }) : null),
      sectionHead(tr("more.sources")),
      el("div", { class: "prose" },
        el("p", { text: tr("more.sources_text", { ok: idx.sources_ok, n: idx.sources_total }) }),
        sourcesBox),
      sectionHead(tr("more.developers")),
      el("ul", { class: "list" },
        el("li", {}, el("a", { href: docs, text: tr("more.api") }), el("span", { class: "fine", text: tr("more.api_fine") })),
        el("li", {}, el("a", { href: new URL(CFG.apiBase + "openapi.json", location.href).href, text: tr("more.openapi") }), el("span", { class: "fine", text: "v1" })),
        el("li", {}, el("a", { href: new URL(CFG.apiBase + "conflicts.xml", location.href).href, text: tr("more.rss") }), el("span", { class: "fine", text: "RSS" })),
        el("li", {}, el("a", { href: "https://github.com/ilicvix02/Claude", target: "_blank", rel: "noopener", text: tr("more.code") }), el("span", { class: "fine", text: "MIT" }))),
      plans.length || links.length ? sectionHead(tr("more.free")) : null,
      plans.length || links.length ? el("div", { class: "prose" },
        el("p", { text: tr("more.free_text") }),
        el("div", { class: "support-links" },
          plans.length ? el("a", { class: "btn", href: "#/support", text: tr("more.plans") }) : null,
          ...links.map(([l, u]) => el("a", { class: "btn ghost", href: u, target: "_blank", rel: "noopener", text: l })))) : null,
      adSlot(),
      el("p", { class: "fine colophon", text: tr("more.colophon", { build: CFG.build }) }));
  }

  // Checkout links are http(s) or a prefilled email to the contact address.
  const payUrl = (u) => (/^mailto:[^\s<>"]+$/.test(u || "") ? u : safeUrl(u));

  function supportLinks(rev) {
    const links = (rev.donate || []).map((d) => [d.label === "Ko-fi" ? tr("support.tip") : d.label, d.url]);
    if (rev.newsletter_url) links.push([tr("support.email"), rev.newsletter_url]);
    if (rev.social && rev.social.tiktok) links.push([tr("support.tiktok"), rev.social.tiktok]);
    if (rev.advertise_email) links.push([tr("support.contact"), `mailto:${rev.advertise_email}`]);
    return links.filter(([, u]) => payUrl(u));
  }

  // The reader-funding ask on the front page.
  function supportNudge() {
    const rev = (S.index && S.index.revenue) || {};
    const plans = (rev.plans || []).filter((p) => payUrl(p.url));
    if (!plans.length) return null;
    const amount = (p) => parseFloat(String(p.price).replace(/[^\d.]/g, ""));
    const cheapest = plans.filter((p) => p.price && amount(p) > 0).sort((a, b) => amount(a) - amount(b))[0];
    return el("aside", { class: "box nudge", "aria-label": tr("support.title") },
      el("h2", { text: tr("support.headline") }),
      el("p", { text: tr("support.nudge") }),
      el("a", { class: "btn", href: "#/support", text: tr("support.button") }),
      cheapest ? el("p", { class: "fine", text: cheapest.period ? tr("support.from_period", { price: cheapest.price, period: periodLabel(cheapest.period) }) : tr("support.from", { price: cheapest.price }) }) : null);
  }

  // Plan copy in the reader's language (revenue.plans[].i18n), else the configured English.
  function planText(p) {
    const v = I18N.field(p.i18n) || {};
    const pick = (k) => (typeof v[k] === "string" && v[k] ? tx(v[k]) : p[k]);
    const feats = Array.isArray(v.features) && v.features.length ? v.features.map(tx) : p.features || [];
    return { name: pick("name"), blurb: pick("blurb"), cta: pick("cta"), features: feats };
  }
  const periodLabel = (period) => (["month", "week", "year"].includes(period) ? tr(`period.${period}`) : period);

  function renderSupport() {
    const rev = S.index.revenue || {};
    const plans = (rev.plans || []).filter((p) => payUrl(p.url));
    const links = supportLinks(rev);
    if (!plans.length && !links.length) {
      return el("div", { class: "page" }, pageHead(tr("support.title")),
        el("div", { class: "empty" }, icon("globe"), el("p", { text: tr("support.soon") })));
    }
    const planCard = (p) => {
      const c = planText(p);
      return el("article", { class: `plan plan-${p.id || "x"}` },
        el("h2", { text: c.name }),
        p.price ? el("p", { class: "price" }, el("b", { text: p.price }), p.period ? el("span", { text: ` / ${periodLabel(p.period)}` }) : null) : null,
        c.blurb ? el("p", { class: "blurb", text: c.blurb }) : null,
        c.features.length ? el("ul", { class: "ticks" }, ...c.features.map((f) => el("li", { text: f }))) : null,
        el("a", { class: "btn", href: payUrl(p.url), target: "_blank", rel: "noopener", text: c.cta || tr("support.choose") }));
    };
    return el("div", { class: "page wide support" },
      pageHead(tr("support.headline"), { kicker: tr("support.title"), dek: tr("support.dek") }),
      plans.length ? el("div", { class: "plans" }, ...plans.map(planCard)) : null,
      links.length ? sectionHead(tr("support.other")) : null,
      links.length ? el("div", { class: "support-links" },
        ...links.map(([l, u]) => el("a", { class: "btn ghost", href: payUrl(u), target: "_blank", rel: "noopener", text: l }))) : null,
      el("p", { class: "fine pay-note", text: tr("support.pay_note") }));
  }

  let adLoaded = false;
  function adSlot() {
    const pub = S.index && S.index.revenue && S.index.revenue.ethicalads_publisher;
    if (!pub) return null;
    const slot = el("aside", { class: "ad", "aria-label": tr("ad.label") }, el("p", { class: "ad-label", text: tr("ad.label") }),
      el("div", { "data-ea-publisher": pub, "data-ea-type": "image", class: "horizontal" }));
    if (!adLoaded) { adLoaded = true; document.body.append(el("script", { src: "https://media.ethicalads.io/media/client/ethicalads.min.js", async: true })); }
    else if (window.ethicalads) setTimeout(() => window.ethicalads.load(), 0);
    return slot;
  }

  // ---------------------------------------------------------------------------
  // language: EN · DE · SR, and for Serbian the script (Cyrillic or Latin)

  const LANG_ROW = ["en", "de", "sr"];
  const isSr = () => I18N.dict === "sr";

  // The buttons for one switcher: languages, then the Serbian script while Serbian is on.
  function langButtons(onPick) {
    const pick = (lang) => () => { I18N.set(lang); if (onPick) onPick(); };
    const langs = el("div", { class: "seg lang-seg", role: "group", "aria-label": tr("lang.label") },
      ...LANG_ROW.map((l) => el("button", { lang: l, "aria-pressed": String(l === "sr" ? isSr() : I18N.lang === l), "aria-label": I18N.LANGS[l].name, onclick: pick(l === "sr" && I18N.lang === "sr-Latn" ? "sr-Latn" : l) }, I18N.LANGS[l].short)));
    const script = isSr() ? el("div", { class: "seg lang-seg", role: "group", "aria-label": tr("lang.script") },
      el("button", { lang: "sr-Cyrl", "aria-pressed": String(I18N.lang === "sr"), "aria-label": tr("lang.cyrl_name"), onclick: pick("sr") }, "Ћир"),
      el("button", { lang: "sr-Latn", "aria-pressed": String(I18N.lang === "sr-Latn"), "aria-label": tr("lang.latn_name"), onclick: pick("sr-Latn") }, "Lat")) : null;
    return [langs, script];
  }

  const langSwitch = () => el("div", { class: "lang-switch" }, ...langButtons());

  // The masthead button opens a small menu with the same choices.
  const langBtn = $("#lang-btn"), langMenu = $("#lang-menu");
  function drawLangBtn() {
    const cur = I18N.LANGS[I18N.lang];
    langBtn.textContent = I18N.lang === "sr-Latn" ? "SR·Lat" : cur.short;
    langBtn.setAttribute("aria-label", tr("lang.button", { name: cur.name }));
    if (!langMenu.hidden) langMenu.replaceChildren(...langButtons());
  }
  function toggleLangMenu(open) {
    langMenu.hidden = !open;
    langBtn.setAttribute("aria-expanded", String(open));
    if (open) { langMenu.replaceChildren(...langButtons()); const on = langMenu.querySelector('[aria-pressed="true"]'); if (on) on.focus(); }
  }
  langBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleLangMenu(langMenu.hidden); });
  langMenu.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => { if (!langMenu.hidden) toggleLangMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !langMenu.hidden) { toggleLangMenu(false); langBtn.focus(); } });

  // Switching language re-renders the open view in place, without a reload.
  window.addEventListener("wp:lang", () => {
    drawLangBtn();
    if (S.index) updateChrome(); else updateDateline();
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  });

  function setTheme(mode, redraw) {
    store.set("wp.theme", mode);
    if (mode === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = mode;
    syncThemeColor();
    if (redraw) redraw(mode);
  }

  // The browser bar follows the paper colour, also when the reader overrides the system theme.
  function syncThemeColor() {
    const forced = document.documentElement.dataset.theme;
    const paper = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim();
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      if (!m.dataset.media) { m.dataset.media = m.media; m.dataset.color = m.content; }
      m.media = forced ? "all" : m.dataset.media;
      m.content = forced ? paper : m.dataset.color;
    });
  }

  // ---------------------------------------------------------------------------
  // router

  // Each route's page title is the string route.<name>.
  const ROUTES = {
    brief: renderBrief,
    conflicts: renderConflicts,
    conflict: renderConflict,
    feed: renderFeed,
    saved: renderSaved,
    more: renderMore,
    support: renderSupport,
  };
  const PARENT = { conflict: "conflicts", support: "more" }; // detail views: highlighted tab and back target

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, qs] = raw.split("?");
    const [name, arg] = (path || "").split("/");
    return { name: ROUTES[name] ? name : "brief", arg: arg ? decodeURIComponent(arg) : "", params: new URLSearchParams(qs || "") };
  }

  function setTitle(text) {
    document.title = text == null ? "World Pulse" : `${text} · World Pulse`;
  }

  function render() {
    const r = parseHash();
    const changed = !S.route || S.route.name !== r.name || S.route.arg !== r.arg || S.route.params.get("c") !== r.params.get("c");
    S.route = r;
    const tab = PARENT[r.name] || r.name;
    document.querySelectorAll(".tabbar a").forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.body.dataset.route = r.name;
    $("#back").hidden = !PARENT[r.name];
    $(".brand").hidden = !!PARENT[r.name];
    setTitle(r.name === "brief" ? null : tr(`route.${r.name}`));
    markSections();
    if (!S.index) return;
    view.replaceChildren(ROUTES[r.name](r.arg, r.params));
    if (changed) { window.scrollTo(0, 0); }
  }

  // ---------------------------------------------------------------------------
  // boot

  const view = $("#view");

  async function refresh(manual) {
    const btn = $("#refresh");
    btn.classList.add("spin");
    try {
      await load();
      render();
      if (manual) toast(tr("toast.uptodate"));
    } catch (err) {
      if (!S.index) {
        view.replaceChildren(el("div", { class: "page" }, el("div", { class: "empty" }, icon("globe"),
          el("p", { text: tr("error.load") }),
          el("button", { class: "btn", text: tr("error.retry"), onclick: () => refresh(true) }))));
      } else if (manual) toast(tr("toast.refresh_failed"));
      console.warn(err);
    } finally {
      btn.classList.remove("spin");
    }
  }

  $("#refresh").addEventListener("click", () => refresh(true));
  // Go back within the app when we navigated here; a deep link has no in-app history.
  let inAppNavs = 0;
  $("#back").addEventListener("click", () => {
    if (inAppNavs > 0) history.back();
    else location.hash = `#/${PARENT[S.route.name] || "brief"}`;
  });
  // A topic picked while reading Latest keeps the region and search filters.
  $("#sections").addEventListener("click", (e) => {
    const a = e.target.closest("a[data-cat], a[data-sec='feed']");
    if (!a || !S.route || S.route.name !== "feed") return;
    e.preventDefault();
    const p = new URLSearchParams();
    if (a.dataset.cat) p.set("c", a.dataset.cat);
    if (S.feed.region) p.set("r", S.feed.region);
    if (S.feed.q) p.set("q", S.feed.q);
    location.hash = `#/feed${p.toString() ? `?${p}` : ""}`;
  });
  window.addEventListener("hashchange", () => { inAppNavs++; render(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - S.loadedAt > 15 * 60 * 1000) refresh(false);
  });
  setInterval(updateDateline, 60 * 1000);
  const relayout = () => { if (S.index && S.route && (S.route.name === "brief" || S.route.name === "conflict")) render(); };
  WIDE.addEventListener("change", relayout);
  WIDER.addEventListener("change", relayout);
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(markSections, 150); });

  const offline = $("#offline");
  const net = () => { offline.hidden = navigator.onLine; updateDateline(); };
  window.addEventListener("online", () => { net(); refresh(false); });
  window.addEventListener("offline", net);
  net();
  syncThemeColor();
  I18N.apply();
  drawLangBtn();

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    S.installEvent = e;
    if (S.route && S.route.name === "more") render();
  });

  if ("serviceWorker" in navigator && !window.Capacitor && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("service worker:", e));
  }

  render();
  refresh(false);
})();
