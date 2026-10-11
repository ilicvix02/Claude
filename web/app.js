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
    globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z",
  };
  const icon = (name) => svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, svg("path", { d: ICONS[name] }));

  // Only ever put http(s) links into the page.
  function safeUrl(u) {
    try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; }
  }

  function ago(iso) {
    if (!iso) return "";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 90) return "just now";
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  }
  // Shareable link to a view of the public web app (in the native app, location is a local file URL).
  const appUrl = (hash) => {
    const fromApi = /^https?:/.test(CFG.apiBase) ? CFG.apiBase.replace(/api\/v1\/?$/, "") : "";
    const site = (S.index && S.index.site && S.index.site.base_url) || fromApi || location.href.split("#")[0];
    return `${site.replace(/\/$/, "")}/${hash}`;
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
    $("#updated").textContent = S.generatedAt ? `Updated ${ago(S.generatedAt)}` : "";
    const rev = (S.index && S.index.revenue) || {};
    const sp = $("#sponsor");
    if (rev.sponsor && safeUrl(rev.sponsor.url)) {
      sp.hidden = false;
      sp.replaceChildren("Presented by ", el("a", { href: safeUrl(rev.sponsor.url), target: "_blank", rel: "sponsored noopener", text: rev.sponsor.text }));
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
      toast("Removed from saved");
    } else {
      const keep = ["id", "title", "url", "summary", "insight", "image", "source", "published_at", "categories", "regions", "theaters", "severity", "tone", "analysis"];
      list.unshift(Object.fromEntries(keep.filter((k) => k in a).map((k) => [k, a[k]])));
      toast("Saved for later");
    }
    store.set(SAVED_KEY, list.slice(0, 300));
    if (btn) btn.setAttribute("aria-pressed", String(isSaved(a.id)));
  }

  async function share(title, url) {
    if (navigator.share) {
      try { await navigator.share({ title, url }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { toast(url); }
  }

  // ---------------------------------------------------------------------------
  // shared components

  const STATUS_LABEL = { critical: "Critical", high: "High", elevated: "Elevated", watch: "Watch", quiet: "Quiet" };
  const TREND = {
    escalating: ["up", "▲ Escalating"], "de-escalating": ["down", "▼ De-escalating"],
    steady: ["", "● Steady"], quiet: ["", "○ Quiet"],
  };
  const statusPill = (t) => el("span", { class: `pill st st-${t.status}`, text: STATUS_LABEL[t.status] || t.status });
  const trendBadge = (t) => { const [cls, label] = TREND[t.trend] || ["", t.trend]; return el("span", { class: `trend ${cls}`, text: label }); };
  const theaterName = (id) => { const t = theaterById(id); return t ? t.name : id; };
  const theaterById = (id) => (S.conflicts ? S.conflicts.theaters.find((t) => t.id === id) : null);
  const regionLabel = (id) => ((S.index.regions || []).find((r) => r.id === id) || {}).label || id;
  const catLabel = (id) => ((S.index.categories || []).find((c) => c.id === id) || {}).label || id;

  function sevBars(n) {
    return el("span", { class: "sev", title: `Severity ${n} of 5`, "aria-label": `Severity ${n} of 5`, role: "img" },
      ...[1, 2, 3, 4, 5].map((i) => el("i", { class: i <= n ? "on" : "" })));
  }

  function sparkline(t) {
    const max = Math.max(1, ...t.history.map((d) => d.severity));
    return el("span", { class: "spark", "aria-hidden": "true" },
      ...t.history.map((d) => el("i", { class: d.severity ? "" : "zero", style: { height: `${Math.max(8, (100 * d.severity) / max)}%` } })));
  }

  function storyItem(a, opts = {}) {
    const url = safeUrl(a.url);
    const img = opts.noImage ? null : a.image && safeUrl(a.image);
    const tone = { crisis: "Crisis", deal: "Deal", mixed: "Deal · Crisis" }[a.tone];
    const topics = (a.categories || []).filter((c) => !["crises", "deals", "conflict"].includes(c)).slice(0, 2);
    const saveBtn = el("button", { class: "icon-btn", "aria-label": "Save story", "aria-pressed": String(isSaved(a.id)) }, icon("bookmark"));
    saveBtn.addEventListener("click", () => { toggleSave(a, saveBtn); if (opts.onChange) opts.onChange(); });

    const others = opts.cluster ? S.all.filter((x) => x.cluster === a.id && x.id !== a.id) : [];
    return el("li", { class: "story" + (img ? "" : " noimg") },
      el("div", { class: "story-main" },
        el("div", {},
          el("div", { class: "byline" },
            a.severity >= 2 ? sevBars(a.severity) : (tone ? el("span", { class: `tag ${a.tone}`, text: tone }) : null),
            el("b", { text: a.source.name }),
            el("time", { datetime: a.published_at, title: new Date(a.published_at).toLocaleString(), text: ago(a.published_at) }),
            a.coverage > 1 ? el("span", { text: `· ${a.coverage} outlets` }) : null),
          el("h3", {}, el("a", { href: url, target: "_blank", rel: "noopener", text: a.title })),
          a.insight
            ? el("p", { class: "insight" }, el("span", { class: "badge ai", text: "AI" }), el("span", { text: a.insight }))
            : a.summary ? el("p", { class: "excerpt", text: a.summary }) : null),
        img ? el("img", { src: img, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer", onerror: (e) => e.target.remove() }) : null),
      others.length
        ? el("details", { class: "also" },
            el("summary", { text: `More coverage · ${others.length} ${others.length === 1 ? "report" : "reports"}` }),
            el("ul", {}, ...others.map((o) => el("li", {}, el("a", { href: safeUrl(o.url), target: "_blank", rel: "noopener", text: `${o.source.name}: ${o.title}` })))))
        : null,
      el("div", { class: "story-foot" },
        el("div", { class: "tags" },
          ...(a.theaters || []).map((id) => el("a", { href: `#/conflict/${id}`, text: theaterName(id) })),
          ...topics.map((c) => el("span", { text: catLabel(c) })),
          ...(a.theaters && a.theaters.length ? [] : (a.regions || []).slice(0, 2).map((r) => el("span", { text: regionLabel(r) })))),
        el("div", { class: "actions" },
          saveBtn,
          el("button", { class: "icon-btn", "aria-label": "Share story", onclick: () => share(a.title, url) }, icon("share")))));
  }

  function sectionHead(title, link) {
    return el("div", { class: "section-h" }, el("h2", { text: title }), link || null);
  }

  // ---------------------------------------------------------------------------
  // map

  const MAP_VIEWS = {
    hot: ["Hotspots", -25, 135, 58, -12],
    world: ["World", -180, 180, 75, -45],
    europe: ["Europe", -12, 55, 62, 34],
    "middle-east": ["Middle East", 25, 65, 42, 8],
    africa: ["Africa", -20, 55, 28, -18],
    asia: ["Asia", 58, 140, 48, -8],
    americas: ["Americas", -110, -50, 30, -2],
  };

  function mapCard(theaters) {
    const wrap = el("div", { class: "map-wrap" });
    const zoom = el("div", { class: "map-zoom", role: "group", "aria-label": "Map region" });
    const draw = () => {
      const [, lon0, lon1, lat1, lat0] = MAP_VIEWS[S.mapView];
      const w = lon1 - lon0, h = lat1 - lat0, k = w / 160;
      const root = svg("svg", { class: "map", viewBox: `${lon0 + 180} ${TOP_LAT - lat1} ${w} ${h}`, preserveAspectRatio: "xMidYMid meet", role: "img", "aria-label": "Map of tracked conflicts" });
      if (window.WP_LAND) root.append(svg("path", { class: "land", d: window.WP_LAND.d }));
      const shown = theaters.filter((t) => t.stories_7d > 0).sort((a, b) => a.intensity - b.intensity);
      for (const t of shown) {
        const cx = t.lon + 180, cy = TOP_LAT - t.lat, r = k * (1.6 + t.intensity / 28);
        const g = svg("g", { class: `st st-${t.status}`, tabindex: "0", role: "link", "aria-label": `${t.name}: ${STATUS_LABEL[t.status]}, ${t.trend}` });
        if (t.status === "critical" || t.trend === "escalating") g.append(svg("circle", { class: "ring", cx, cy, r, "stroke-width": k * 0.6 }));
        g.append(svg("circle", { class: "dot", cx, cy, r, "stroke-width": k * 0.4 }, svg("title", { text: t.name })));
        if (t.status === "critical" || t.status === "high" || k < 0.6) {
          g.append(svg("text", { class: "label", x: cx + r + k * 1.2, y: cy + k * 1.5, "font-size": k * 4.4, "stroke-width": k * 1.2, text: t.name }));
        }
        const go = () => { location.hash = `#/conflict/${t.id}`; };
        g.addEventListener("click", go);
        g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
        root.append(g);
      }
      wrap.replaceChildren(root);
      zoom.replaceChildren(...Object.entries(MAP_VIEWS).map(([id, [label]]) =>
        el("button", { class: "chip", "aria-pressed": String(S.mapView === id), onclick: () => { S.mapView = id; draw(); } }, label)));
    };
    draw();
    const legend = el("div", { class: "map-legend" },
      ...["critical", "high", "elevated", "watch"].map((s) => el("span", { class: `st st-${s}` }, el("i"), STATUS_LABEL[s])),
      el("span", { text: "Pulsing = critical or escalating" }));
    return el("div", { class: "card map-card" }, wrap, zoom, legend);
  }

  // ---------------------------------------------------------------------------
  // views

  function theaterCard(t) {
    const an = t.analysis;
    return el("a", { class: `card theater st st-${t.status}`, href: `#/conflict/${t.id}` },
      el("div", { class: "theater-top" },
        el("div", {}, el("h3", { text: t.name }), el("span", { class: "region", text: regionLabel(t.region) })),
        el("div", { class: "pills" }, statusPill(t))),
      an && an.summary ? el("p", { text: an.summary }) : null,
      el("div", { class: "meter" },
        trendBadge(t),
        el("span", { class: "bar", "aria-hidden": "true" }, el("i", { style: { width: `${t.intensity}%` } })),
        el("span", { text: `${t.stories_24h} today` }),
        sparkline(t)));
  }

  function topStories(limit) {
    const now = Date.now();
    const leads = S.all.filter((a) => (a.cluster || a.id) === a.id && now - new Date(a.published_at) < 864e5);
    const score = (a) => 2 * (a.coverage || 1) + 1.5 * (a.severity || 0) + ((a.categories || []).some((c) => c === "crises" || c === "deals") ? 1.5 : 0) - hoursOld(a.published_at) / 8;
    return leads.sort((a, b) => score(b) - score(a)).slice(0, limit);
  }

  function briefCard() {
    const b = S.brief;
    if (!b) return null;
    const isAI = b.source === "ai";
    return el("article", { class: "card brief" },
      el("div", { class: "kicker" }, "World brief",
        el("span", { class: `badge ${isAI ? "ai" : ""}`, text: isAI ? "AI · Claude" : "Automated" })),
      el("h2", { text: b.headline }),
      el("ol", { class: "bullets" }, ...b.bullets.map((x) => el("li", {},
        el("p", { text: x.text }),
        x.stories.length ? el("div", { class: "cites" }, ...x.stories.map((s) => el("a", { class: "cite", href: safeUrl(s.url), target: "_blank", rel: "noopener", text: s.coverage > 1 ? `${s.source.name} +${s.coverage - 1}` : s.source.name }))) : null))),
      b.watch ? el("p", { class: "watch" }, el("b", { text: "Watch next · " }), b.watch) : null,
      el("div", { class: "brief-foot" },
        el("p", { class: "fine", text: `${ago(b.generated_at)} · ${b.disclaimer}` }),
        el("button", { class: "btn ghost share-brief", onclick: () => share(`Today's world brief: ${b.headline}`, appUrl("#/brief")) },
          icon("share"), "Share")));
  }

  function renderBrief() {
    const st = S.state, conf = S.conflicts;
    const ov = conf ? conf.overview : null;
    const hot = conf ? conf.theaters.filter((t) => t.stories_24h > 0).slice(0, 6) : [];
    const left = el("div", {},
      briefCard(),
      sectionHead("Top stories · 24h", el("a", { href: "#/feed", text: "All news" })),
      el("ol", { class: "stories" }, ...topStories(10).map((a) => storyItem(a, { cluster: true }))));
    const right = el("div", {},
      ov ? el("div", { class: "pulse-row" },
        el("a", { class: "stat", href: "#/conflicts" }, el("b", { text: ov.active }), el("span", { text: "active conflicts" })),
        el("a", { class: "stat", href: "#/conflicts" }, el("b", { text: ov.critical, style: { color: ov.critical ? "var(--st-critical)" : "" } }), el("span", { text: "critical" })),
        el("a", { class: "stat", href: "#/conflicts" }, el("b", { text: ov.escalating }), el("span", { text: "escalating" }))) : null,
      hot.length ? sectionHead("Hotspots", el("a", { href: "#/conflicts", text: "Tracker" })) : null,
      hot.length ? el("div", { class: "hotspots" }, ...hot.map((t) => el("a", { class: `card hot st st-${t.status}`, href: `#/conflict/${t.id}` },
        el("div", { class: "pills" }, statusPill(t), trendBadge(t)),
        el("h3", { text: t.name }),
        el("p", { text: t.analysis ? t.analysis.summary : "" })))) : null,
      st ? sectionHead("Global tension") : null,
      st ? el("div", { class: "card" },
        el("div", { class: "theater-top" }, el("b", { style: { font: "700 20px/1.2 var(--serif)" }, text: st.mood }), el("b", { text: `${st.tension_index}/100` })),
        el("div", { class: "gauge", role: "img", "aria-label": `Tension index ${st.tension_index} of 100` }, el("i", { style: { left: `${st.tension_index}%` } })),
        el("div", { class: "gauge-legend" }, el("span", { text: "Deals" }), el("span", { text: "Crises" })),
        el("p", { class: "fine", text: st.explanation })) : null,
      adSlot());
    return el("div", { class: "brief-grid" }, left, right);
  }

  function renderConflicts() {
    const conf = S.conflicts;
    if (!conf) return el("p", { class: "empty", text: "Conflict data is not available yet." });
    const all = conf.theaters;
    const filters = {
      active: ["Active", (t) => t.stories_24h > 0],
      escalating: ["Escalating", (t) => t.trend === "escalating"],
      all: ["All", () => true],
    };
    const list = el("div", { class: "theater-list" });
    const chips = el("div", { class: "chips", role: "group", "aria-label": "Filter conflicts" });
    const draw = () => {
      const [, fn] = filters[S.conflictFilter];
      const shown = all.filter(fn);
      chips.replaceChildren(...Object.entries(filters).map(([id, [label, f]]) =>
        el("button", { class: "chip", "aria-pressed": String(S.conflictFilter === id), onclick: () => { S.conflictFilter = id; draw(); } },
          label, el("span", { class: "n", text: all.filter(f).length }))));
      list.replaceChildren(...(shown.length ? shown.map(theaterCard) : [el("p", { class: "empty", text: "Nothing here right now." })]));
    };
    draw();
    const ov = conf.overview;
    return el("div", {},
      el("p", { class: "muted", style: { margin: "4px 0 12px" }, text: `${ov.active} conflicts with reports in the last 24h · ${ov.critical} critical · ${ov.escalating} escalating · ${ov.de_escalating} de-escalating` }),
      mapCard(all),
      el("div", { style: { height: "14px" } }),
      chips,
      el("div", { style: { height: "12px" } }),
      list,
      el("p", { class: "fine", text: "Intensity combines the number and severity of reports in the last 24 hours. It reflects news coverage, not verified casualty data." }));
  }

  function dayLabel(iso) {
    const d = new Date(iso), today = new Date();
    const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  }

  function renderConflict(id) {
    const t = theaterById(id);
    if (!t) return el("p", { class: "empty", text: "This conflict isn't tracked." });
    setTitle(t.name);
    const an = t.analysis;
    const isAI = an && an.source === "ai";
    const max = Math.max(1, ...t.history.map((d) => d.severity));
    const stories = S.all.filter((a) => (a.theaters || []).includes(t.id));
    const timeline = el("div");
    let shown = 20;
    const drawTimeline = () => {
      const groups = [];
      for (const a of stories.slice(0, shown)) {
        const label = dayLabel(a.published_at);
        if (!groups.length || groups[groups.length - 1][0] !== label) groups.push([label, []]);
        groups[groups.length - 1][1].push(a);
      }
      timeline.replaceChildren(
        ...groups.map(([label, items]) => el("div", {}, el("p", { class: "day-h", text: label }), el("ol", { class: "stories" }, ...items.map((a) => storyItem(a, { noImage: true }))))),
        stories.length > shown ? el("button", { class: "more-btn", text: `Show ${Math.min(20, stories.length - shown)} more`, onclick: () => { shown += 20; drawTimeline(); } }) : null);
    };
    drawTimeline();
    const sig = t.signals_24h;
    return el("div", { class: `st st-${t.status}` },
      el("div", { class: "detail-head" },
        el("div", { class: "pills" }, statusPill(t), trendBadge(t), el("span", { class: "fine", text: regionLabel(t.region) })),
        el("h2", { text: t.name }),
        el("p", { class: "muted", style: { margin: 0 }, text: t.description })),
      el("div", { class: "kpis" },
        el("div", {}, el("b", { text: t.intensity }), el("span", { text: "intensity /100" })),
        el("div", {}, el("b", { text: t.stories_24h }), el("span", { text: "reports · 24h" })),
        el("div", {}, el("b", { text: t.stories_7d }), el("span", { text: "reports · 7 days" }))),
      an ? el("section", { class: "card situation" },
        el("div", { class: "kicker" }, "Situation", el("span", { class: `badge ${isAI ? "ai" : ""}`, text: isAI ? "AI · Claude" : "Automated" })),
        el("p", { text: an.summary }),
        an.outlook ? el("p", { class: "outlook" }, el("b", { text: "Outlook · " }), an.outlook) : null,
        an.developments.length ? el("ul", { class: "devs" }, ...an.developments.map((d) => el("li", {},
          el("div", { text: d.text }),
          el("a", { href: safeUrl(d.story.url), target: "_blank", rel: "noopener", text: `${d.story.source.name} · ${ago(d.story.published_at)}` })))) : null,
        el("p", { class: "fine", text: isAI ? `${ago(an.generated_at)} · Written by AI from the linked reports; it can make mistakes.` : "Automated summary from report counts." })) : null,
      sectionHead("Last 7 days"),
      el("div", { class: "card" },
        el("div", { class: "chart", role: "img", "aria-label": "Daily report severity over 7 days" },
          ...t.history.map((d) => el("div", { title: `${d.date}: ${d.stories} reports, severity ${d.severity}` },
            el("span", { text: d.stories || "" }),
            el("i", { style: { height: `${(80 * d.severity) / max}%` } }),
            el("span", { text: new Date(d.date + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "narrow" }) })))),
        el("div", { class: "signals" },
          el("span", { text: `▲ ${sig.escalation} escalation` }),
          el("span", { text: `▼ ${sig["de-escalation"]} de-escalation` }),
          el("span", { text: `✚ ${sig.humanitarian} humanitarian` }),
          el("span", { text: `◆ ${sig.diplomatic} diplomatic` })),
        el("p", { class: "fine", text: "Signals count today's reports by what they describe." })),
      el("div", { class: "section-h" }, el("h2", { text: `Reports (${stories.length})` }),
        el("button", { onclick: () => share(`${t.name}: ${STATUS_LABEL[t.status]}, ${t.trend} — World Pulse conflict tracker`, appUrl(`#/conflict/${t.id}`)), text: "Share" })),
      timeline);
  }

  function renderFeed(_, params) {
    const f = S.feed;
    if (params) { f.cat = params.get("c") || ""; f.region = params.get("r") || ""; f.q = params.get("q") || ""; }
    const chips = el("div", { class: "chips", role: "group", "aria-label": "Topics" });
    const region = el("select", { "aria-label": "Region" }, el("option", { value: "", text: "All regions" }),
      ...S.index.regions.map((r) => el("option", { value: r.id, text: r.label })));
    const q = el("input", { type: "search", placeholder: "Search news", "aria-label": "Search news", value: f.q, enterkeyhint: "search" });
    const count = el("p", { class: "count" });
    const list = el("ol", { class: "stories" });
    const more = el("button", { class: "more-btn", text: "Show more" });

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
      const cats = [{ id: "", label: "All" }, ...S.index.categories];
      chips.replaceChildren(...cats.map((c) => el("button", { class: "chip", "aria-pressed": String(f.cat === c.id), onclick: () => { f.cat = c.id; f.shown = PAGE; draw(); } }, c.label)));
      region.value = f.region;
      const items = matches();
      count.textContent = items.length ? `${items.length} stories` : "";
      list.replaceChildren(...(items.length ? items.slice(0, f.shown).map((a) => storyItem(a, { cluster: true })) : [el("li", { class: "empty", text: "No stories match these filters." })]));
      more.hidden = items.length <= f.shown;
    };
    region.addEventListener("change", () => { f.region = region.value; f.shown = PAGE; draw(); });
    let timer;
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { f.q = q.value; f.shown = PAGE; draw(); }, 180); });
    more.addEventListener("click", () => { f.shown += PAGE; draw(); });
    draw();
    return el("div", {}, chips, el("div", { class: "filters" }, region, q), count, list, more);
  }

  function renderSaved() {
    const wrap = el("div");
    const draw = () => {
      const list = savedList();
      if (!list.length) {
        wrap.replaceChildren(el("div", { class: "empty" }, icon("empty"), el("p", { text: "Nothing saved yet. Tap the bookmark on any story to keep it here — saved stories stay on this device, even offline." })));
        return;
      }
      wrap.replaceChildren(
        el("div", { class: "section-h" }, el("h2", { text: `${list.length} saved` }),
          el("button", { text: "Clear all", onclick: () => { if (confirm("Remove all saved stories?")) { store.set(SAVED_KEY, []); draw(); } } })),
        el("ol", { class: "stories" }, ...list.map((a) => storyItem({ coverage: 1, ...a }, { onChange: draw }))));
    };
    draw();
    return wrap;
  }

  function renderMore() {
    const idx = S.index;
    const rev = idx.revenue || {};
    const theme = store.get("wp.theme", "system");
    const seg = el("div", { class: "seg", role: "group", "aria-label": "Theme" });
    const drawSeg = (cur) => seg.replaceChildren(...["system", "light", "dark"].map((m) =>
      el("button", { "aria-pressed": String(cur === m), onclick: () => setTheme(m, drawSeg), text: m[0].toUpperCase() + m.slice(1) })));
    drawSeg(theme);

    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone || window.Capacitor;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    let install;
    if (standalone) install = el("span", { class: "ok", text: "Installed" });
    else if (S.installEvent) install = el("button", { class: "btn", text: "Install app", onclick: async () => { S.installEvent.prompt(); await S.installEvent.userChoice; S.installEvent = null; render(); } });
    else if (ios) install = el("span", { class: "fine", text: "Tap Share, then “Add to Home Screen”" });
    else install = el("span", { class: "fine", text: "Use your browser menu: “Install app”" });

    const ai = idx.ai || {};
    const sourcesBox = el("div", {}, el("button", { class: "btn ghost", text: `Show ${idx.sources_total} sources`, onclick: showSources }));
    async function showSources() {
      try {
        if (!S.sources) S.sources = (await getJSON(CFG.apiBase, "sources.json")).data;
      } catch { try { S.sources = (await getJSON(CFG.bundledApi, "sources.json")).data; } catch { toast("Couldn't load sources"); return; } }
      sourcesBox.replaceChildren(el("ul", { class: "list" }, ...S.sources.map((s) => el("li", {},
        el("a", { href: safeUrl(s.homepage) || safeUrl(s.feed), target: "_blank", rel: "noopener", text: s.name }),
        el("span", { class: s.ok ? "ok fine" : "bad fine", text: s.ok ? `${s.items} items` : "unavailable" })))));
    }

    const support = [...(rev.donate || []).map((d) => [d.label, d.url])];
    if (rev.newsletter_url) support.push(["Newsletter", rev.newsletter_url]);
    if (rev.advertise_email) support.push(["Advertise", `mailto:${rev.advertise_email}`]);
    const supportLinks = support.filter(([, u]) => u.startsWith("mailto:") || safeUrl(u));
    const docs = new URL("docs.html", location.href).href;

    return el("div", {},
      sectionHead("App"),
      el("div", { class: "card" }, el("ul", { class: "list" },
        el("li", {}, el("span", { text: "Install on this device" }), install),
        el("li", {}, el("span", { text: "Appearance" }), seg),
        el("li", {}, el("span", { text: "Data updated" }), el("span", { class: "fine", text: S.generatedAt ? new Date(S.generatedAt).toLocaleString() : "—" })))),
      sectionHead("AI analysis"),
      el("div", { class: "card" },
        el("p", { style: { marginTop: 0 }, text: ai.enabled
          ? `Every hour, Claude (${ai.model}) reads new conflict reports to tag the conflict, severity and signal, and writes the world brief and situation summaries. ${ai.analysed_stories} stories in this edition were analysed by AI.`
          : "AI analysis is off for this edition, so the brief and situation summaries are automated from rules." }),
        el("p", { class: "fine", style: { marginBottom: 0 }, text: "AI output is labelled wherever it appears and always links to the original reporting. It can make mistakes — check the sources for anything important." })),
      sectionHead("Sources"),
      el("div", { class: "card" },
        el("p", { style: { marginTop: 0 }, text: `${idx.sources_ok} of ${idx.sources_total} public news and humanitarian feeds were reachable at the last update. Headlines and excerpts belong to their publishers.` }),
        sourcesBox),
      sectionHead("Developers"),
      el("div", { class: "card" }, el("ul", { class: "list" },
        el("li", {}, el("a", { href: docs, text: "Free public API — docs" }), el("span", { class: "fine", text: "JSON · no key" })),
        el("li", {}, el("a", { href: new URL(CFG.apiBase + "openapi.json", location.href).href, text: "OpenAPI spec" }), el("span", { class: "fine", text: "v1" })),
        el("li", {}, el("a", { href: new URL(CFG.apiBase + "conflicts.xml", location.href).href, text: "Conflicts RSS" }), el("span", { class: "fine", text: "RSS" })),
        el("li", {}, el("a", { href: "https://github.com/ilicvix02/Claude", target: "_blank", rel: "noopener", text: "Source code" }), el("span", { class: "fine", text: "MIT" })))),
      supportLinks.length ? sectionHead("Keep it free") : null,
      supportLinks.length ? el("div", { class: "card" },
        el("p", { style: { marginTop: 0 }, text: "World Pulse has no paywall and no tracking. Sponsors and readers keep it running." }),
        el("div", { class: "support-links" }, ...supportLinks.map(([l, u]) => el("a", { class: "btn", href: u, target: "_blank", rel: "noopener", text: l })))) : null,
      adSlot(),
      el("p", { class: "fine", style: { textAlign: "center", marginTop: "28px" }, text: `World Pulse · build ${CFG.build}` }));
  }

  let adLoaded = false;
  function adSlot() {
    const pub = S.index && S.index.revenue && S.index.revenue.ethicalads_publisher;
    if (!pub) return null;
    const slot = el("div", { style: { marginTop: "24px" } }, el("div", { "data-ea-publisher": pub, "data-ea-type": "image", class: "horizontal" }));
    if (!adLoaded) { adLoaded = true; document.body.append(el("script", { src: "https://media.ethicalads.io/media/client/ethicalads.min.js", async: true })); }
    else if (window.ethicalads) setTimeout(() => window.ethicalads.load(), 0);
    return slot;
  }

  function setTheme(mode, redraw) {
    store.set("wp.theme", mode);
    if (mode === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = mode;
    if (redraw) redraw(mode);
  }

  // ---------------------------------------------------------------------------
  // router

  const ROUTES = {
    brief: ["Today", renderBrief],
    conflicts: ["Conflict tracker", renderConflicts],
    conflict: ["Conflict", renderConflict],
    feed: ["Latest news", renderFeed],
    saved: ["Saved", renderSaved],
    more: ["More", renderMore],
  };

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, qs] = raw.split("?");
    const [name, arg] = (path || "").split("/");
    return { name: ROUTES[name] ? name : "brief", arg: arg ? decodeURIComponent(arg) : "", params: new URLSearchParams(qs || "") };
  }

  function setTitle(text) {
    $("#view-title").textContent = text;
    document.title = text === "Today" ? "World Pulse" : `${text} · World Pulse`;
  }

  function render() {
    const r = parseHash();
    const changed = !S.route || S.route.name !== r.name || S.route.arg !== r.arg;
    S.route = r;
    const tab = r.name === "conflict" ? "conflicts" : r.name;
    document.querySelectorAll(".tabbar a").forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $("#back").hidden = r.name !== "conflict";
    $(".brand").hidden = r.name === "conflict";
    setTitle(ROUTES[r.name][0]);
    if (!S.index) return;
    view.replaceChildren(ROUTES[r.name][1](r.arg, r.params));
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
      if (manual) toast("Up to date");
    } catch (err) {
      if (!S.index) {
        view.replaceChildren(el("div", { class: "empty" }, icon("globe"),
          el("p", { text: "Couldn't load the news. Check your connection and try again." }),
          el("button", { class: "btn", text: "Try again", onclick: () => refresh(true) })));
      } else if (manual) toast("Couldn't refresh — showing saved data");
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
    else location.hash = "#/conflicts";
  });
  window.addEventListener("hashchange", () => { inAppNavs++; render(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - S.loadedAt > 15 * 60 * 1000) refresh(false);
  });
  setInterval(() => { if (S.generatedAt) $("#updated").textContent = `Updated ${ago(S.generatedAt)}`; }, 60 * 1000);

  const offline = $("#offline");
  const net = () => { offline.hidden = navigator.onLine; };
  window.addEventListener("online", () => { net(); refresh(false); });
  window.addEventListener("offline", net);
  net();

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
