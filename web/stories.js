/* World Pulse Stories: the full-screen, swipeable home feed (brief cards first, then the curated news items). */
(() => {
  "use strict";
  const I = window.WP_I18N, t = I.t;
  const DWELL = 30000; // ms per card before it moves on
  const GROUP = 6; // progress bars shown per chapter
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const NS = "http://www.w3.org/2000/svg";
  const P = {
    listen: "M3 14v-2a9 9 0 0 1 18 0v2M2.5 14h5v7h-3a2 2 0 0 1-2-2zM21.5 14h-5v7h3a2 2 0 0 0 2-2z",
    stop: "M7 7h10v10H7z",
    share: "M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6",
    save: "M6 3h12v18l-6-4-6 4z",
    sources: "M9 6l6 6-6 6",
  };
  const COLORS = ["#B91C1C", "#1D4ED8", "#0F766E", "#7C3AED", "#B45309", "#BE185D"];

  let A = null, cards = [], idx = 0, tab = "today", root = null, timer = 0, startAt = 0, left = DWELL, speaking = false, wheelLock = 0;

  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "text") n.textContent = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
    return n;
  }
  function ico(name) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "ico"); s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(NS, "path"); p.setAttribute("d", P[name]); s.append(p);
    return s;
  }
  const hash = (s) => { let x = 7; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };
  const initials = (name) => (name || "?").replace(/^(the|die|der|la|le)\s+/i, "").split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  // ---------------------------------------------------------------- data -> cards
  function theaterOf(a) {
    const id = a && (a.theaters || [])[0];
    const th = id && A.S.conflicts && A.S.conflicts.theaters.find((x) => x.id === id);
    return th || null;
  }
  // "Headline | Top updates", "Headline - Outlet": drop the publisher's tail.
  const clean = (x) => (x || "").replace(/\s+[|\u2013\u2014-]\s+(?:[^\s|]+\s?){1,4}$/u, "").trim() || x;
  // A brief bullet reads as a card: its first sentence is the headline, the rest the summary.
  function split(text) {
    const m = /^(.{18,120}?[.!?])\s+(.+)$/su.exec(text || "");
    return m ? [m[1].replace(/[.]$/, ""), m[2]] : [text, ""];
  }
  function fromItem(a, kind, summary, title) {
    const st = A.storyText(a), L = A.readLang();
    const brief = (a.story_brief || {})[L] || (a.story_brief || {}).en;
    return {
      id: a.id, kind, item: a, title: title || clean(st.title),
      summary: summary || st.summary || st.insight || (Array.isArray(brief) ? brief.slice(0, 2).join(" ") : ""),
      coverage: a.coverage || 1, countries: a.countries || 0,
      sources: (a.sources && a.sources.length ? a.sources : [a.source]).map((s) => s && s.name).filter(Boolean),
      ai: a.written_by === "ai" || !!st.insight || kind === "brief", theater: theaterOf(a), when: a.published_at,
    };
  }
  function build() {
    const S = A.S, out = [];
    if (tab !== "all" && S.brief && S.brief.bullets) {
      const text = A.briefText(S.brief);
      S.brief.bullets.forEach((b, i) => {
        if (!text.bullets[i]) return;
        const a = (b.stories || []).map((s) => A.itemFor(s.id)).find(Boolean);
        const [hl, rest] = split(text.bullets[i]);
        if (a) out.push(fromItem(a, "brief", rest, hl));
        else out.push({ id: "", kind: "brief", title: hl, summary: rest, coverage: (b.stories || []).length, countries: 0, sources: (b.stories || []).map((s) => s.source && s.source.name).filter(Boolean), ai: true, theater: null, when: S.brief.generated_at });
      });
    }
    const seen = new Set(out.map((c) => c.id));
    for (const a of S.all) {
      if (seen.has(a.id) || (tab === "fronts" && !(a.theaters || []).length)) continue;
      if (tab === "fronts" && out.length >= 60) break;
      out.push(fromItem(a, "news"));
      if (out.length >= 60) break;
    }
    if (tab === "fronts") return out.filter((c) => c.theater || (c.item && (c.item.theaters || []).length));
    return out;
  }

  // ---------------------------------------------------------------- views
  function headline(text) {
    const words = text.split(" ");
    const n = words.length > 5 ? 2 : words.length > 2 ? 1 : 0;
    const head = words.slice(0, words.length - n).join(" ");
    return [head, n ? " " : "", n ? h("em", { text: words.slice(-n).join(" ") }) : ""];
  }
  function bg(c, i) {
    const k = hash(c.id || c.title + i), x = 48 + (k % 34), y = 20 + ((k >>> 5) % 16);
    const art = h("div", { class: "sx-bg", "aria-hidden": "true", style: `--x:${x}%;--y:${y}%` },
      h("div", { class: "sx-grid" }), h("div", { class: "sx-sweep" }),
      h("div", { class: "sx-radar" }, h("i"), h("i"), h("i"), h("i"), h("b")));
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("class", "sx-arc"); s.setAttribute("viewBox", "0 0 390 200"); s.setAttribute("preserveAspectRatio", "none");
    const yy = 60 + (k % 40);
    s.innerHTML = `<path d="M-10 150 C 80 150 110 ${yy} 170 ${yy + 10} S ${x * 3.4} 110 ${x * 3.9} ${y * 3.4}" stroke="rgba(253,186,116,.55)" stroke-width="1.5" fill="none" stroke-dasharray="3 6"/><circle cx="-4" cy="150" r="3" fill="#FDBA74"/>`;
    art.append(s);
    return art;
  }
  function chip(c) {
    const th = c.theater, out = [];
    if (th && ["critical", "high"].includes(th.status)) out.push(h("span", { class: `chip c-${th.status}` }, h("i", { class: "dot" }), A.statusLabel(th.status)));
    if (th) out.push(h("span", { class: "chip c-th" }, `${A.tName(th)}${th.trend === "escalating" ? " ↑" : th.trend === "de-escalating" ? " ↓" : ""}`));
    else if (c.item && (c.item.categories || [])[0]) out.push(h("span", { class: "chip c-th", text: t(`cat.${c.item.categories[0]}`) }));
    return out;
  }
  function card(c, i) {
    const len = c.title.length, size = len > 90 ? "xl" : len > 64 ? "l" : len > 40 ? "m" : "s";
    const when = c.when ? new Date(c.when) : null;
    const place = c.theater ? A.tName(c.theater) : c.item && (c.item.regions || [])[0] ? t(`region.${c.item.regions[0]}`) : "";
    const coord = h("div", { class: "sx-coord", "aria-hidden": "true" }, c.kind === "brief" ? t("stories.brief_kicker") : t("stories.live"),
      h("span", { text: [place, when ? `${when.toISOString().slice(11, 16)} UTC` : ""].filter(Boolean).join(" · ") }));
    const n = cards.length;
    const srcs = [...new Set(c.sources)].slice(0, 4);
    return h("section", { class: "sx-card", "data-i": i, "aria-roledescription": "slide", "aria-label": t("stories.label", { i: i + 1, n }) },
      bg(c, i), coord,
      h("div", { class: "sx-content" },
        h("div", { class: "sx-meta" }, chip(c)),
        h("div", { class: "sx-kick", text: t("stories.kicker", { i: (i % GROUP) + 1, n: Math.min(GROUP, n - i + (i % GROUP)) }) }),
        h("h2", { class: `sx-h sx-${size}`, lang: c.item && !A.storyText(c.item).translated ? c.item.lang : null }, headline(c.title)),
        c.summary ? h("p", { class: "sx-sum", text: c.summary }) : null,
        h("div", { class: "sx-src" },
          h("div", { class: "sx-stack", "aria-hidden": "true" }, srcs.map((s) => h("span", { style: `background:${COLORS[hash(s) % COLORS.length]}`, text: initials(s) }))),
          h("p", {}, h("strong", { text: c.countries > 1 ? t("stories.reports_countries", { n: c.coverage, c: c.countries }) : t("stories.reports", { n: c.coverage }) }), h("br"),
            h("span", { class: "sx-ai" }, c.ai ? h("b", { text: t("stories.ai_badge") }) : null, c.ai ? t("stories.ai") : srcs.join(", "))))));
  }
  function railBtn(name, label, onclick, extra) {
    return h("button", Object.assign({ class: `sx-rb${name === "listen" ? " hot" : ""}`, type: "button", "data-act": name, onclick }, extra || {}), h("span", { class: "c" }, ico(name)), h("span", { class: "l", text: label }));
  }

  // ---------------------------------------------------------------- behaviour
  const cur = () => cards[idx];
  function go(n, user) {
    if (!root) return;
    const max = cards.length; // index max == end card
    n = Math.max(0, Math.min(max, n));
    if (n === idx && !user) return;
    if (speaking && user) stopVoice();
    idx = n;
    const track = root.querySelector(".sx-track");
    track.style.transform = `translate3d(0,${-idx * 100}%,0)`;
    root.querySelectorAll(".sx-card, .sx-end").forEach((c, i) => c.setAttribute("aria-hidden", String(i !== idx)));
    sync();
    if (speaking) speak();
  }
  function sync() {
    const c = cur(), end = !c;
    root.classList.toggle("at-end", end);
    const g = Math.floor(Math.min(idx, cards.length - 1) / GROUP), from = g * GROUP, to = Math.min(cards.length, from + GROUP);
    const bars = root.querySelector(".sx-bars");
    bars.replaceChildren(...Array.from({ length: to - from }, (_, k) => h("i", { class: from + k < idx ? "done" : from + k === idx ? "now" : "" })));
    const save = root.querySelector('[data-act="save"]');
    const can = c && c.item;
    save.disabled = !can;
    save.setAttribute("aria-pressed", String(!!(can && A.isSaved(c.id))));
    save.querySelector(".l").textContent = can && A.isSaved(c.id) ? t("stories.saved") : t("stories.save");
    root.querySelectorAll(".sx-rail button").forEach((b) => { if (b.dataset.act !== "save") b.disabled = end; });
    restart();
  }
  function restart() {
    clearTimeout(timer);
    left = DWELL;
    const now = root.querySelector(".sx-bars .now");
    if (!now || reduced.matches) return;
    now.style.setProperty("--dur", `${DWELL}ms`);
    if (!speaking) resume();
    else now.classList.add("paused");
  }
  function pause() { clearTimeout(timer); left -= Date.now() - startAt; const n = root && root.querySelector(".sx-bars .now"); if (n) n.classList.add("paused"); }
  function resume() {
    if (reduced.matches || speaking || !root || document.hidden) return;
    const n = root.querySelector(".sx-bars .now"); if (n) n.classList.remove("paused");
    startAt = Date.now(); clearTimeout(timer);
    timer = setTimeout(() => { if (alive() && idx < cards.length) go(idx + 1); }, Math.max(0, left));
  }
  const alive = () => root && root.isConnected;

  function voiceFor() {
    const L = I.locale.toLowerCase(), base = L.split("-")[0];
    const vs = speechSynthesis.getVoices();
    return vs.find((v) => v.lang.toLowerCase() === L) || vs.find((v) => v.lang.toLowerCase().startsWith(base)) || (base === "sr" ? vs.find((v) => /^(hr|bs)/i.test(v.lang)) : null);
  }
  function speak() {
    const c = cur();
    speechSynthesis.cancel();
    if (!c) { stopVoice(); return; }
    const u = new SpeechSynthesisUtterance(`${c.title}. ${c.summary}`);
    u.lang = I.locale; const v = voiceFor(); if (v) u.voice = v;
    u.onend = () => { if (speaking && alive() && cur() === c) { if (idx + 1 < cards.length) go(idx + 1); else stopVoice(); } };
    speechSynthesis.speak(u);
  }
  function setListen(on) {
    speaking = on;
    if (!root) return;
    root.classList.toggle("speaking", on);
    const b = root.querySelector('[data-act="listen"]');
    b.querySelector(".c").replaceChildren(ico(on ? "stop" : "listen"));
    b.querySelector(".l").textContent = on ? t("stories.stop") : t("stories.listen");
    b.setAttribute("aria-pressed", String(on));
    root.querySelector(".sx-play").setAttribute("aria-pressed", String(on));
  }
  function startVoice() {
    if (!("speechSynthesis" in window)) { A.toast(t("stories.no_voice")); return; }
    pause(); setListen(true); speak();
  }
  function stopVoice() { if ("speechSynthesis" in window) speechSynthesis.cancel(); setListen(false); resume(); }
  const toggleVoice = () => (speaking ? stopVoice() : startVoice());

  function onKey(e) {
    if (!alive() || e.target.closest("input, textarea, select") || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (["ArrowDown", "PageDown", "j", "ArrowRight"].includes(k)) { e.preventDefault(); go(idx + 1, true); }
    else if (["ArrowUp", "PageUp", "k", "ArrowLeft"].includes(k)) { e.preventDefault(); go(idx - 1, true); }
    else if (k === "Enter" && !e.target.closest("button, a") && cur() && cur().id) location.hash = `#/story/${cur().id}`;
  }
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", () => { if (!alive()) return; if (document.hidden) pause(); else resume(); });
  window.addEventListener("hashchange", () => { if (!alive() && speaking) { speechSynthesis.cancel(); speaking = false; } clearTimeout(timer); });

  function wire(stage) {
    let y0 = null, x0 = 0, dy = 0, t0 = 0;
    const track = stage.querySelector(".sx-track");
    stage.addEventListener("touchstart", (e) => { if (e.target.closest(".sx-rail, .sx-player, a, button")) return; y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0; t0 = Date.now(); track.style.transition = "none"; pause(); }, { passive: true });
    stage.addEventListener("touchmove", (e) => {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      e.preventDefault();
      track.style.transform = `translate3d(0,calc(${-idx * 100}% + ${dy}px),0)`;
    }, { passive: false });
    stage.addEventListener("touchend", (e) => {
      if (y0 == null) return;
      track.style.transition = "";
      const dx = e.changedTouches[0].clientX - x0, fast = Date.now() - t0 < 300;
      y0 = null;
      if (Math.abs(dy) > 60 || (fast && Math.abs(dy) > 25)) go(idx + (dy < 0 ? 1 : -1), true);
      else if (dx < -70 && cur() && cur().id) location.hash = `#/story/${cur().id}`;
      else { go(idx, true); }
    });
    stage.addEventListener("wheel", (e) => {
      if (Math.abs(e.deltaY) < 12) return;
      e.preventDefault();
      const now = Date.now(); if (now < wheelLock) return; wheelLock = now + 650;
      go(idx + (e.deltaY > 0 ? 1 : -1), true);
    }, { passive: false });
    // Tap the right side for the next card, the left edge for the previous one (as in story apps).
    stage.addEventListener("click", (e) => {
      if (e.target.closest("a, button, .sx-rail, .sx-player")) return;
      const r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
      if (x > 0.66) go(idx + 1, true); else if (x < 0.25) go(idx - 1, true);
    });
  }

  function render(api, arg) {
    A = api;
    const prev = cur() && cur().id;
    if (arg && ["today", "fronts", "all"].includes(arg)) { if (arg !== tab) { tab = arg; idx = 0; } }
    cards = build();
    const keep = prev ? cards.findIndex((c) => c.id === prev) : -1;
    idx = keep >= 0 ? keep : Math.min(idx, cards.length);
    if (speaking) { speechSynthesis.cancel(); speaking = false; }

    const tabs = h("div", { class: "sx-tabs", role: "tablist" }, ["today", "fronts", "all"].map((k) =>
      h("a", { href: `#/stories/${k}`, role: "tab", class: k === tab ? "on" : null, "aria-selected": String(k === tab), text: t(`stories.${k}`) })));
    const c0 = cards[0];
    const end = h("section", { class: "sx-end" },
      h("div", { class: "sx-bg", "aria-hidden": "true", style: "--x:50%;--y:34%" }, h("div", { class: "sx-radar" }, h("i"), h("i"), h("i"), h("i"), h("b"))),
      h("div", { class: "sx-end-in" },
        h("h2", { class: "sx-h sx-m", text: cards.length ? t("stories.end_title") : t("stories.empty") }),
        h("p", { class: "sx-sum", text: t("stories.end_text") }),
        h("a", { class: "sx-cta", href: "#/conflicts", text: t("stories.end_cta") }),
        h("button", { class: "sx-again", type: "button", text: t("stories.again"), onclick: () => go(0, true) })));
    const stage = h("div", { class: "sx-stage" }, h("div", { class: "sx-track" }, cards.map(card), end));
    root = h("div", { class: "sx", "aria-roledescription": "carousel", "aria-label": t("stories.tab") },
      stage,
      h("div", { class: "sx-top" },
        h("div", { class: "sx-bars", "aria-hidden": "true" }),
        h("div", { class: "sx-head" },
          h("a", { class: "sx-brand", href: "#/brief", "aria-label": t("stories.front_page") },
            h("img", { src: "icons/icon.svg", width: 30, height: 30, alt: "" }), h("span", { class: "wm", text: "World Pulse" })),
          tabs)),
      h("div", { class: "sx-rail" },
        railBtn("listen", t("stories.listen"), toggleVoice, { "aria-pressed": "false" }),
        railBtn("share", t("stories.share"), () => { const c = cur(); if (c) A.share(c.title, A.appUrl(c.id ? `#/story/${c.id}` : "#/stories")); }),
        railBtn("save", t("stories.save"), (e) => { const c = cur(); if (c && c.item) { A.toggleSave(c.item); sync(); } e.currentTarget.blur(); }),
        railBtn("sources", t("stories.sources"), () => { const c = cur(); location.hash = c && c.id ? `#/story/${c.id}` : "#/brief"; })),
      h("div", { class: "sx-player" },
        h("button", { class: "sx-play", type: "button", "aria-label": t("stories.listen"), "aria-pressed": "false", onclick: toggleVoice },
          (() => { const s = document.createElementNS(NS, "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.innerHTML = '<path class="pl" d="M7 4.5v15l12.5-7.5z"/><path class="ps" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>'; return s; })()),
        h("div", { class: "sx-pl-t" }, h("b", { text: t("stories.player", { n: cards.length }) }), h("span", { text: t("stories.voice", { lang: (I.LANGS[I.lang] || {}).short || I.lang.toUpperCase() }) })),
        h("div", { class: "sx-wave", "aria-hidden": "true" }, [8, 14, 22, 12, 26, 18, 9, 20, 28, 16, 10, 22, 14, 6, 18, 24, 12, 8].map((v, i) => h("i", { style: `height:${v}px;--d:${(i % 6) * 0.12}s` })))),
      h("p", { class: "sx-hint", "aria-hidden": "true", text: t("stories.hint") }));
    if (!c0) root.classList.add("at-end");
    wire(stage);
    const track = stage.querySelector(".sx-track");
    track.style.transition = "none";
    track.style.transform = `translate3d(0,${-idx * 100}%,0)`;
    requestAnimationFrame(() => { track.style.transition = ""; if (alive()) sync(); });
    root.querySelectorAll(".sx-card, .sx-end").forEach((c, i) => c.setAttribute("aria-hidden", String(i !== idx)));
    setTimeout(() => { if (alive()) sync(); }, 0);
    return root;
  }

  window.WP_STORIES = { render };
})();
