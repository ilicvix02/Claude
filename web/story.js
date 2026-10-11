(() => {
  "use strict";

  const CFG = Object.assign({ apiBase: "api/v1/", bundledApi: "api/v1/" }, window.WP_CONFIG || {});
  const TOP = (window.WP_LAND && window.WP_LAND.top) || 84;
  const $ = (id) => document.getElementById(id);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const STATUS = { critical: "Critical", high: "High", elevated: "Elevated", watch: "Watch", quiet: "Quiet" };
  const TREND = { escalating: "▲ Escalating", "de-escalating": "▼ Calming", steady: "Steady", quiet: "Quiet" };
  const STATUS_COLOR = { critical: "#ef4444", high: "#f97316", elevated: "#eab308", watch: "#60a5fa", quiet: "#78716c" };

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "text") n.textContent = v; else if (k === "class") n.className = v; else n.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
    return n;
  }
  function svg(tag, attrs, ...kids) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
    for (const k of kids) n.append(k);
    return n;
  }
  const logo = (cls) => svg("svg", { viewBox: "0 0 32 32", class: cls, "aria-hidden": "true" },
    svg("circle", { cx: 16, cy: 16, r: 11 }), svg("path", { d: "M3 17h6l3-7 5 13 3-6h9" }));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const readMs = (text) => clamp(1500 + text.length * 40, 3000, 6000); // short-video pace: ~45s in total

  async function getJSON(base, file) {
    const r = await fetch(base + file, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
    return r.json();
  }
  async function loadFrom(base) {
    const [brief, conflicts, state] = await Promise.all(["brief.json", "conflicts.json", "state.json"].map((f) => getJSON(base, f).then((j) => j.data)));
    return { brief, conflicts, state };
  }
  async function load() {
    try { return await loadFrom(CFG.apiBase); } catch (err) {
      if (CFG.bundledApi && CFG.bundledApi !== CFG.apiBase) return loadFrom(CFG.bundledApi);
      throw err;
    }
  }

  function sourceLine(stories) {
    if (!stories.length) return null;
    if (stories.length === 1) {
      const s = stories[0], more = (s.coverage || 1) - 1;
      return [el("span", { text: "Source: " }), el("b", { text: s.source.name }), more > 0 ? ` and ${more} more outlet${more > 1 ? "s" : ""}` : ""];
    }
    const names = [...new Set(stories.map((s) => s.source.name))];
    return [el("span", { text: "Sources: " }), el("b", { text: names.slice(0, 2).join(", ") }), names.length > 2 ? ` and ${names.length - 2} more` : ""];
  }

  function hotspotMap(theaters) {
    // 16:10 window over the conflict belt: lon -25..135, lat 73..-27 (x = lon + 180, y = TOP - lat)
    const root = svg("svg", { class: "map", viewBox: `155 ${TOP - 73} 160 100`, preserveAspectRatio: "xMidYMid meet", "aria-hidden": "true" });
    if (window.WP_LAND) root.append(svg("path", { class: "land", d: window.WP_LAND.d }));
    for (const t of [...theaters].sort((a, b) => a.intensity - b.intensity)) {
      const cx = t.lon + 180, cy = TOP - t.lat, r = 1.8 + t.intensity / 25, c = STATUS_COLOR[t.status];
      if (t.status === "critical" || t.trend === "escalating") root.append(svg("circle", { class: "ring", cx, cy, r, stroke: c, "stroke-width": 0.7 }));
      root.append(svg("circle", { cx, cy, r, fill: c, stroke: "#0e0c0a", "stroke-width": 0.5 }));
    }
    return root;
  }

  function buildSlides({ brief, conflicts, state }) {
    const slides = [];
    const date = new Date(brief.generated_at).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    const tension = state ? state.tension_index : null;

    slides.push({
      ms: clamp(3000 + brief.headline.length * 25, 3800, 5500),
      node: el("div", { class: "slide" },
        el("div", { class: "kicker", text: "World brief" }),
        el("div", { class: "date", text: date }),
        el("h2", { class: "headline", text: brief.headline }),
        state ? el("div", { class: "pill", style: `--dot:${tension >= 58 ? "#ef4444" : tension > 42 ? "#eab308" : "#2dd4bf"}` },
          el("i"), `Tension ${tension}/100 · ${state.mood}`) : null,
        el("div", { class: "brandline" }, logo(), "World Pulse")),
    });

    const active = conflicts ? conflicts.theaters.filter((t) => t.stories_24h > 0) : [];
    if (active.length) {
      const top = [...active].sort((a, b) => b.intensity - a.intensity).slice(0, 4);
      slides.push({
        ms: 5500,
        node: el("div", { class: "slide" },
          el("div", { class: "kicker", text: `Hotspots right now · ${active.length} active` }),
          hotspotMap(active),
          el("ul", { class: "hot-list" }, ...top.map((t) => el("li", { class: `st-${t.status}` },
            el("span", { text: t.name }),
            el("span", { class: "meta", text: t.trend === "escalating" || t.trend === "de-escalating" ? TREND[t.trend] : STATUS[t.status] }))))),
      });
    }

    brief.bullets.forEach((b, i) => {
      slides.push({
        ms: readMs(b.text),
        node: el("div", { class: "slide" },
          el("div", { class: "counter" }, el("b", { text: String(i + 1) }), ` of ${brief.bullets.length}`),
          el("p", { class: "big", text: b.text }),
          el("div", { class: "source" }, sourceLine(b.stories || []))),
      });
    });

    if (brief.watch) {
      slides.push({
        ms: readMs(brief.watch),
        node: el("div", { class: "slide" }, el("div", { class: "kicker", text: "What to watch" }), el("p", { class: "big", text: brief.watch })),
      });
    }

    const ai = brief.source === "ai";
    slides.push({
      ms: 4000,
      node: el("div", { class: "slide end" },
        logo("end-logo"),
        el("h2", { class: "end-name", text: "World Pulse" }),
        el("p", { class: "end-tag", text: "The world's conflicts, briefed every hour." }),
        el("div", { class: "cta", text: "Free app · link in bio" }),
        el("p", { class: "disclosure", text: ai
          ? "Summaries written by AI (Claude) from the linked news reports. It can make mistakes. Every point links to its sources in the app."
          : "An automated digest of the most-covered stories. Every point links to its sources in the app." })),
    });
    return slides;
  }

  // ---------------------------------------------------------------------------
  // player

  let slides = [], index = -1, timer = null, playing = false;
  const bars = $("bars"), host = $("slides");

  function show(i) {
    index = clamp(i, 0, slides.length - 1);
    slides.forEach((s, j) => s.node.classList.toggle("on", j === index));
    [...bars.children].forEach((bar, j) => {
      const fill = bar.firstChild;
      bar.classList.toggle("done", j < index);
      fill.style.transition = "none";
      fill.style.width = j < index ? "100%" : "0";
    });
    clearTimeout(timer);
    window.__storyDone = index === slides.length - 1;
    if (!playing) return;
    const fill = bars.children[index].firstChild;
    void fill.offsetWidth; // restart the transition
    fill.style.transition = `width ${slides[index].ms}ms linear`;
    fill.style.width = "100%";
    if (index < slides.length - 1) timer = setTimeout(() => show(index + 1), slides[index].ms);
  }

  function start() {
    $("intro").hidden = true;
    playing = true;
    show(0);
  }

  $("stage").addEventListener("click", (e) => {
    if (!playing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    show(e.clientX - rect.left < rect.width * 0.3 ? index - 1 : index + 1);
  });
  document.addEventListener("keydown", (e) => {
    if (!playing) return;
    if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); show(index + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); show(index - 1); }
  });

  load().then((data) => {
    slides = buildSlides(data);
    host.replaceChildren(...slides.map((s) => s.node));
    bars.replaceChildren(...slides.map(() => el("span", {}, el("i"))));
    window.__storyTotal = slides.reduce((t, s) => t + s.ms, 0);
    // Lets a script step through the slides to render a video file (see scripts/render_story.js).
    window.__story = { count: slides.length, ms: (i) => slides[i].ms, show: (i) => { $("intro").hidden = true; playing = false; show(i); } };
    show(0);
    const btn = $("play");
    btn.disabled = false;
    btn.textContent = `Play · about ${Math.round(window.__storyTotal / 1000)} seconds`;
    btn.addEventListener("click", start);
    btn.focus();
    if (location.hash === "#autoplay") setTimeout(start, 600);
  }).catch((err) => {
    const btn = $("play");
    btn.textContent = "Couldn't load today's brief";
    console.warn(err);
  });
})();
