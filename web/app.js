(() => {
  "use strict";
  const API = "api/v1/";
  const PAGE = 30;
  const $ = (id) => document.getElementById(id);
  const state = { articles: [], cat: "", region: "", q: "", shown: PAGE, index: null };

  const getJSON = (path) => fetch(API + path, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  });

  // Only ever put http(s) links into the page.
  const safeUrl = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) n.append(k);
    return n;
  }

  function ago(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  }

  // ---- URL state -----------------------------------------------------------
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    state.cat = p.get("c") || ""; state.region = p.get("r") || ""; state.q = p.get("q") || "";
  }
  function writeHash() {
    const p = new URLSearchParams();
    if (state.cat) p.set("c", state.cat);
    if (state.region) p.set("r", state.region);
    if (state.q) p.set("q", state.q);
    const h = p.toString();
    history.replaceState(null, "", h ? `#${h}` : location.pathname + location.search);
  }

  // ---- rendering -------------------------------------------------------------
  function renderTabs() {
    const cats = state.index.categories;
    const tabs = [{ id: "", label: "All", count: state.articles.length }, ...cats];
    $("tabs").replaceChildren(...tabs.map((c) => el("button", {
      role: "tab", "aria-selected": String(state.cat === c.id),
      onclick: () => { state.cat = c.id; state.shown = PAGE; update(); },
    }, c.label, el("span", { class: "n", text: c.count }))));
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return state.articles.filter((a) =>
      (!state.cat || a.categories.includes(state.cat)) &&
      (!state.region || a.regions.includes(state.region)) &&
      (!q || (a.title + " " + a.summary + " " + a.source.name).toLowerCase().includes(q)));
  }

  const regionLabel = (id) => (state.index.regions.find((r) => r.id === id) || {}).label || id;
  const catLabel = (id) => (state.index.categories.find((c) => c.id === id) || {}).label || id;

  function articleItem(a) {
    const url = safeUrl(a.url);
    const img = a.image && safeUrl(a.image);
    const toneTag = { crisis: "Crisis", deal: "Deal", mixed: "Deal · Crisis" }[a.tone];
    const topics = a.categories.filter((c) => c !== "crises" && c !== "deals").map(catLabel);
    return el("li", { class: "article" + (img ? "" : " noimg") },
      el("div", {},
        el("div", { class: "byline" },
          toneTag && el("span", { class: `tag ${a.tone}`, text: toneTag }),
          el("b", { text: a.source.name }),
          el("time", { datetime: a.published_at, title: new Date(a.published_at).toLocaleString(), text: ago(a.published_at) })),
        el("h3", {}, el("a", { href: url, target: "_blank", rel: "noopener", text: a.title })),
        a.summary && el("p", { text: a.summary }),
        topics.length || a.regions.length ? el("div", { class: "tags" },
          ...topics.map((t) => el("span", { text: t })),
          ...a.regions.map((r) => el("span", { text: regionLabel(r) }))) : null),
      img && el("img", { src: img, alt: "", loading: "lazy", referrerpolicy: "no-referrer", onerror: (e) => e.target.remove() }));
  }

  function renderArticles() {
    const list = filtered();
    $("articles").replaceChildren(...list.slice(0, state.shown).map(articleItem));
    $("status").textContent = list.length ? `${list.length} stories` : "No stories match these filters.";
    $("more").hidden = list.length <= state.shown;
  }

  function update() {
    writeHash();
    renderTabs();
    $("region").value = state.region;
    if ($("q").value !== state.q) $("q").value = state.q;
    renderArticles();
  }

  function renderState(s) {
    $("mood").textContent = s.mood;
    $("tension").textContent = s.tension_index;
    $("gauge-marker").style.left = `${s.tension_index}%`;
    $("gauge-img").setAttribute("aria-label", `Tension index ${s.tension_index} of 100: ${s.mood}`);
    $("state-explain").textContent = s.explanation;

    $("history").replaceChildren(...s.history.map((d) => {
      const h = d.articles ? Math.max(6, d.tension) : 3;
      const day = new Date(d.date + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "narrow" });
      const color = d.articles ? `color-mix(in srgb, var(--crisis) ${d.tension}%, var(--deal))` : "";
      return el("div", { class: "bar", style: `height:${h}%;${color ? `background:${color}` : ""}`,
        title: `${d.date}: tension ${d.tension} (${d.crises} crisis / ${d.deals} deal stories)` }, el("span", { text: day }));
    }));

    $("regions").replaceChildren(...s.regions.filter((r) => r.articles).map((r) => {
      const t = r.crises + r.deals || 1;
      return el("li", { onclick: () => { state.region = state.region === r.id ? "" : r.id; state.shown = PAGE; update(); } },
        el("span", { class: "r-name", text: r.label }),
        el("span", { class: "r-meta", text: `${r.articles} stories · tension ${r.tension}` }),
        el("span", { class: "r-bar", title: `${r.deals} deal / ${r.crises} crisis stories` },
          el("i", { style: `width:${(100 * r.deals) / t}%;background:var(--deal)` }),
          el("i", { style: `width:${(100 * r.crises) / t}%;background:var(--crisis)` })));
    }));

    $("trending").replaceChildren(...s.trending.map((t) =>
      el("button", { class: "chip", onclick: () => { state.q = t.term; state.shown = PAGE; update(); } }, t.term)));
  }

  function renderRevenue(rev) {
    if (rev.sponsor && safeUrl(rev.sponsor.url)) {
      $("sponsor").hidden = false;
      $("sponsor").replaceChildren("Presented by ", el("a", { href: safeUrl(rev.sponsor.url), rel: "sponsored noopener", target: "_blank", text: rev.sponsor.text }));
    }
    const links = [...rev.donate.map((d) => [d.label, d.url])];
    if (rev.newsletter_url) links.push(["Newsletter", rev.newsletter_url]);
    if (rev.advertise_email) links.push(["Advertise", `mailto:${rev.advertise_email}`]);
    const ok = links.filter(([, u]) => u.startsWith("mailto:") || safeUrl(u));
    if (ok.length) {
      $("support").hidden = false; $("support-link").hidden = false;
      $("support-links").replaceChildren(...ok.map(([l, u]) => el("a", { href: u, target: "_blank", rel: "noopener", text: l })));
    }
    if (rev.ethicalads_publisher) {
      const slot = $("ad-slot");
      slot.hidden = false;
      slot.append(el("div", { "data-ea-publisher": rev.ethicalads_publisher, "data-ea-type": "image", class: "horizontal" }));
      document.body.append(el("script", { src: "https://media.ethicalads.io/media/client/ethicalads.min.js", async: "" }));
    }
  }

  // ---- boot ------------------------------------------------------------------
  async function boot() {
    readHash();
    try {
      const [index, all, st] = await Promise.all([getJSON("index.json"), getJSON("all.json"), getJSON("state.json")]);
      state.index = index.data;
      state.articles = all.data;
      if (index.data.site.tagline) $("tagline").textContent = index.data.site.tagline;
      $("region").append(...index.data.regions.map((r) => el("option", { value: r.id, text: `${r.label} (${r.count})` })));
      renderState(st.data);
      renderRevenue(index.data.revenue);
      $("footer-meta").textContent = `Updated ${new Date(all.meta.generated_at).toLocaleString()} · ${index.data.sources_ok}/${index.data.sources_total} sources healthy · ${all.meta.count} stories in the last ${all.meta.retention_days} days.`;
      update();
    } catch (err) {
      $("status").textContent = `Could not load the news API (${err.message}). Run the build first: python -m worldpulse.build`;
    }
  }

  $("region").addEventListener("change", (e) => { state.region = e.target.value; state.shown = PAGE; update(); });
  let t;
  $("q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; state.shown = PAGE; update(); }, 150); });
  $("more").addEventListener("click", () => { state.shown += PAGE; renderArticles(); });
  window.addEventListener("hashchange", () => { readHash(); update(); });
  boot();
})();
