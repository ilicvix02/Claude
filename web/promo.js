/* World Pulse TikTok promo: a ~30 s ad on the same deterministic renderAt(t) engine as the video brief
 * (story.js: globe, sky, markers, callouts, grain), with fast cuts, big kinetic captions and a plan card.
 * Rendered by: node scripts/render_story.mjs --page promo.html --music promo (npm run promo).
 */
(() => {
  "use strict";

  const CFG = Object.assign({ apiBase: "api/v1/", bundledApi: "api/v1/" }, window.WP_CONFIG || {});
  const LAND = window.WP_LAND || null;
  const TOP = LAND ? LAND.top : 84;
  const RENDER = location.hash === "#render";
  const $ = (id) => document.getElementById(id);
  const stage = $("stage"), ui = $("ui");
  const DEG = Math.PI / 180;

  // ---------------------------------------------------------------------------
  // math

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const prog = (t, start, dur) => clamp((t - start) / dur, 0, 1);
  const E = {
    outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    outCubic: (x) => 1 - Math.pow(1 - x, 3),
    inCubic: (x) => x * x * x,
    inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outBack: (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  };
  function mulberry32(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const sph = (lat, lon) => [Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG), Math.cos(lat * DEG) * Math.cos(lon * DEG)];

  const STATUS = { critical: "Critical", high: "High", elevated: "Elevated", watch: "Watch", quiet: "Quiet" };
  const TREND = { escalating: "Escalating", "de-escalating": "Calming", steady: "Steady", quiet: "Quiet" };
  const COLOR = { critical: "#ef4444", high: "#f97316", elevated: "#eab308", watch: "#60a5fa", quiet: "#8a8178" };

  // ---------------------------------------------------------------------------
  // DOM helpers

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function logoSvg(cls) {
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg");
    s.setAttribute("viewBox", "0 0 32 32");
    if (cls) s.setAttribute("class", cls);
    s.setAttribute("aria-hidden", "true");
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", "16"); c.setAttribute("cy", "16"); c.setAttribute("r", "11"); c.setAttribute("pathLength", "1");
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", "M3 17h6l3-7 5 13 3-6h9"); p.setAttribute("pathLength", "1");
    s.append(c, p);
    return { svg: s, circle: c, path: p };
  }
  /** Words in overflow masks, for rise-and-unfold reveals. Returns the inner spans. */
  function maskedWords(parent, text) {
    const out = [];
    for (const w of String(text).split(/\s+/).filter(Boolean)) {
      const outer = el("span", "word"), inner = el("span", null, w);
      outer.append(inner);
      parent.append(outer, " ");
      out.push(inner);
    }
    return out;
  }
  /** Plain word spans with the fraction of the text at which each word starts and ends (for spoken highlighting). */
  function captionWords(parent, text) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const total = words.reduce((n, w) => n + w.length + 1, 0);
    let at = 0;
    return words.map((w) => {
      const span = el("span", "w", w);
      parent.append(span, " ");
      const from = at / total;
      at += w.length + 1;
      return { el: span, from, to: at / total };
    });
  }
  const tf = (node, transform, opacity) => {
    node.style.transform = transform;
    if (opacity !== undefined) node.style.opacity = opacity;
  };

  // ---------------------------------------------------------------------------
  // data and narration

  async function getJSON(base, file) {
    const r = await fetch(base + file, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
    return r.json();
  }
  async function loadFrom(base) {
    const [c, l] = await Promise.all(["conflicts.json", "latest.json"].map((f) => getJSON(base, f)));
    return { conflicts: c.data, latest: Array.isArray(l.data) ? l.data : [] };
  }
  async function loadData() {
    try { return await loadFrom(CFG.apiBase); } catch (err) {
      if (CFG.bundledApi && CFG.bundledApi !== CFG.apiBase) return loadFrom(CFG.bundledApi);
      throw err;
    }
  }

  const NUM = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

  function buildScenes(d) {
    const theaters = d.conflicts ? d.conflicts.theaters : [];
    const ids = new Map(theaters.map((t) => [t.id, t]));
    const live = theaters.filter((t) => t.stories_24h > 0).sort((a, b) => b.intensity - a.intensity);
    const esc = live.filter((t) => t.trend === "escalating");
    const n = esc.length >= 2 && esc.length <= 10 ? esc.length : 3;
    const hot = (esc.length ? esc : live).slice(0, 4);
    const reports = live.reduce((a, t) => a + t.stories_24h, 0);
    const seen = new Set(), heads = [];
    const heat = (a) => Math.max(0, ...(a.theaters || []).map((id) => (ids.get(id) || {}).intensity || 0));
    for (const a of [...d.latest].sort((x, y) => heat(y) - heat(x))) {
      if (heads.length >= 3) break;
      if (!(a.theaters || []).length || !a.title || a.title.length > 110 || seen.has(a.source.name)) continue;
      seen.add(a.source.name);
      heads.push({ title: a.title, source: a.source.name, theater: ids.get(a.theaters[0]) || null });
    }
    const hop = (list, dist) => list.map((t) => ({ lat: t.lat, lon: t.lon, dist, shift: 0.4, spin: 0, theater: t.id }));
    const wide = (lon, dist, spin) => ({ lat: 18, lon, dist, shift: 0.42, spin });
    const h0 = hot[0] || { lat: 20, lon: 40 };

    const out = [
      { id: "hook", kind: "hook", min: 2.3, n, say: `${NUM[n]} wars escalated while you slept.`, focus: { lat: h0.lat, lon: h0.lon - 25, dist: 3.6, shift: 0.38, spin: 9 } },
      { id: "ask", kind: "ask", min: 2.1, names: hot.map((t) => t.name), say: "Can you name them?", seq: hop(hot.slice(0, 3), 4.2).map((k) => ({ ...k, theater: null })) },
      { id: "track", kind: "track", min: 4.4, tracked: theaters.length, live: live.length, reports, say: "World Pulse tracks every conflict, live.", seq: hop(live.slice(0, 3), 3.3) },
      { id: "brief", kind: "brief", min: 4.6, heads, say: "One A.I. brief. Every point sourced.",
        seq: heads.map((h) => (h.theater ? { lat: h.theater.lat, lon: h.theater.lon, dist: 4.4, shift: 0.42, spin: 2 } : wide(30, 5, 4))) },
      { id: "lang", kind: "lang", min: 2.6, say: "In English, German and Serbian.", focus: wide(15, 6.4, 16) },
      { id: "free", kind: "free", min: 2.4, say: "Free. No paywall on the news.", focus: wide(60, 5.2, -12) },
      { id: "pro", kind: "pro", min: 6.0, beats: 3, say: "Go Pro for three dollars a month: a daily intelligence briefing, ninety-day trends, instant alerts.", focus: { lat: 26, lon: 40, dist: 8.2, shift: 0.62, spin: 8 } },
      { id: "end", kind: "end", min: 3.4, say: "World Pulse. Link in bio.", focus: { lat: 16, lon: h0.lon + 30, dist: 6.6, shift: 0.42, spin: 9 } },
    ];
    out.forEach((s) => { s.beats = s.beats || (s.seq ? s.seq.length : 1); });
    return { scenes: out, active: live, byId: ids };
  }

  // ---------------------------------------------------------------------------
  // timeline and camera

  const LEAD = 0.12, TAIL = 0.32, END_HOLD = 0.6;
  let scenes = [], active = [], byId = new Map(), total = 0, camKeys = [], cuts = [];
  const estimate = (text) => text.split(/\s+/).filter(Boolean).length / 3.6;

  function setTimeline(speech) {
    let t = 0;
    cuts = [];
    scenes.forEach((s, i) => {
      s.speech = speech && speech[s.id] != null ? Number(speech[s.id]) : estimate(s.say);
      s.start = t;
      s.voiceAt = i === 0 ? 0.04 : LEAD;
      s.dur = Math.max(s.min, s.voiceAt + s.speech + TAIL);
      for (let b = 0; b < s.beats; b++) cuts.push(t + (b * s.dur) / s.beats);
      t += s.dur;
    });
    total = t + END_HOLD;
    camKeys = buildCamKeys();
    return { total, cuts: cuts.slice(1), scenes: scenes.map((s) => ({ id: s.id, start: s.start, dur: s.dur, voiceAt: s.start + s.voiceAt, speech: s.speech, say: s.say })) };
  }

  const CAM0 = { lat: 6, lon: -12, dist: 11.5, shift: 0.08 };
  function buildCamKeys() {
    const keys = [];
    let last = null;
    for (const s of scenes) {
      if (s.seq) {
        const step = s.dur / s.seq.length;
        s.seq.forEach((f, i) => keys.push({ t: s.start + i * step + (i === 0 ? 0.15 : 0), ...f }));
        last = s.seq[s.seq.length - 1];
      } else if (s.focus) {
        keys.push({ t: s.start, ...s.focus });
        last = s.focus;
      } else if (last) {
        keys.push({ t: s.start, ...last, dist: last.dist + 0.6, spin: 3, theater: null });
      }
    }
    return keys.sort((a, b) => a.t - b.t);
  }

  /** Camera at time t: a critically damped spring chasing the active key, integrated from t = 0. */
  function cameraAt(t) {
    const w = 5.5, dt = 1 / 60;
    const x = { ...CAM0 }, v = { lat: 0, lon: 0, dist: 0, shift: 0 };
    let k = 0;
    const steps = Math.floor(t / dt);
    for (let i = 0; i <= steps; i++) {
      const time = i === steps ? t : i * dt;
      const h = i === steps ? t - steps * dt : dt;
      while (k + 1 < camKeys.length && camKeys[k + 1].t <= time) k++;
      const key = camKeys[k];
      if (!key) break;
      let lon = key.lon + (key.spin || 0) * Math.max(0, time - key.t);
      while (lon - x.lon > 180) lon -= 360;
      while (lon - x.lon < -180) lon += 360;
      const tgt = { lat: key.lat, lon, dist: key.dist, shift: key.shift };
      for (const p in tgt) {
        const a = w * w * (tgt[p] - x[p]) - 2 * w * v[p];
        v[p] += a * h;
        x[p] += v[p] * h;
      }
    }
    return { ...x, index: k, key: camKeys[k] || null, next: camKeys[k + 1] || null };
  }

  // ---------------------------------------------------------------------------
  // projection (matches the vertex shader)

  const FOV = 30 * DEG, F = 1 / Math.tan(FOV / 2);
  let W = 1080, H = 1920, ASPECT = W / H, U = 1;

  function rotation(cam) {
    const a = -cam.lon * DEG, b = cam.lat * DEG;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    return [ca, 0, sa, sb * sa, cb, -sb * ca, -cb * sa, sb, cb * ca]; // Rx(lat) · Ry(-lon), row-major
  }
  function project(lat, lon, cam, R) {
    const p = sph(lat, lon);
    const x = R[0] * p[0] + R[1] * p[1] + R[2] * p[2];
    const y = R[3] * p[0] + R[4] * p[1] + R[5] * p[2];
    const z = R[6] * p[0] + R[7] * p[1] + R[8] * p[2];
    const wv = cam.dist - z;
    const cx = (F / ASPECT) * (x / wv), cy = F * (y / wv) + cam.shift;
    return { x: ((cx + 1) / 2) * W, y: ((1 - cy) / 2) * H, facing: z - 1 / cam.dist };
  }
  function globeCircle(cam) {
    const r = (F / Math.sqrt(cam.dist * cam.dist - 1)) * (H / 2);
    return { x: W / 2, y: ((1 - cam.shift) / 2) * H, r };
  }

  // ---------------------------------------------------------------------------
  // WebGL globe

  const VS = `#version 300 es
in vec3 aPos; in vec2 aUv;
uniform mat3 uRot; uniform float uDist, uF, uAspect, uShift;
out vec3 vN; out vec2 vUv; out vec3 vV;
void main() {
  vec3 p = uRot * aPos;
  vN = p; vUv = aUv;
  vec3 view = p - vec3(0.0, 0.0, uDist);
  vV = -view;
  float w = -view.z, n = 0.1, f = uDist + 2.0;
  gl_Position = vec4(uF / uAspect * view.x, uF * view.y + uShift * w, (f + n) / (n - f) * view.z + 2.0 * f * n / (n - f), w);
}`;
  const FS = `#version 300 es
precision highp float;
in vec3 vN; in vec2 vUv; in vec3 vV;
uniform sampler2D uTex; uniform vec3 uLight;
out vec4 o;
void main() {
  vec3 N = normalize(vN), V = normalize(vV);
  vec4 tex = texture(uTex, vUv);
  float land = tex.r, coast = tex.g;
  // land as a dot matrix that resolves as the camera moves in, solid when the dots get too small
  vec2 g = vUv * vec2(720.0, 360.0);
  float fw = min(fwidth(g.x), 2.0);
  float ppc = 1.0 / max(fw, 1e-4);
  float aa = fw * 0.75;
  float dots = 1.0 - smoothstep(0.30 - aa, 0.30 + aa, length(fract(g) - 0.5));
  float dotMix = smoothstep(3.0, 7.0, ppc);
  float diff = max(dot(N, uLight), 0.0);
  float light = 0.26 + 0.92 * diff;
  vec3 col = mix(vec3(0.028, 0.030, 0.038), vec3(0.16, 0.14, 0.12), land);
  col += vec3(0.66, 0.57, 0.47) * land * mix(0.34, dots, dotMix) * 0.85;
  col *= light;
  col += vec3(1.0, 0.52, 0.18) * coast * (0.22 + 0.6 * diff);
  // 15-degree graticule
  vec2 ll = vec2(vUv.x * 360.0, 90.0 - vUv.y * 180.0);
  vec2 gr = abs(fract(ll / 15.0 + 0.5) - 0.5) * 15.0;
  vec2 gw = min(fwidth(ll), vec2(2.0)) * 1.2;
  float grid = max(1.0 - smoothstep(0.0, gw.x, gr.x), 1.0 - smoothstep(0.0, gw.y, gr.y));
  col += vec3(1.0, 0.7, 0.5) * grid * 0.045 * light;
  // atmosphere at the limb
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += vec3(1.0, 0.46, 0.15) * fres * 0.9;
  o = vec4(col, 1.0);
}`;

  function initGlobe(canvas) {
    // Exports render in software, where multisampling is the most expensive part of the frame.
    const gl = canvas.getContext("webgl2", { antialias: !RENDER, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) return null;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));

    const LAT = 160, LON = 320;
    const pos = new Float32Array((LAT + 1) * (LON + 1) * 3), uv = new Float32Array((LAT + 1) * (LON + 1) * 2);
    for (let i = 0, pi = 0, qi = 0; i <= LAT; i++) {
      for (let j = 0; j <= LON; j++) {
        pos.set(sph(90 - (180 * i) / LAT, -180 + (360 * j) / LON), pi); pi += 3;
        uv[qi++] = j / LON; uv[qi++] = i / LAT;
      }
    }
    const idx = new Uint32Array(LAT * LON * 6);
    for (let i = 0, n = 0; i < LAT; i++) {
      for (let j = 0; j < LON; j++) {
        const a = i * (LON + 1) + j, b = a + LON + 1;
        idx.set([a, b, a + 1, b, b + 1, a + 1], n); n += 6;
      }
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const attr = (name, data, size) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attr("aPos", pos, 3);
    attr("aUv", uv, 2);
    const ibuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    // land mask texture: red = land, green = coastline
    const TW = 4096, TH = 2048;
    const c = document.createElement("canvas");
    c.width = TW; c.height = TH;
    const g = c.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, TW, TH);
    if (LAND) {
      const path = new Path2D(LAND.d);
      g.setTransform(TW / 360, 0, 0, TH / 180, 0, ((90 - TOP) * TH) / 180);
      g.fillStyle = "rgb(255,0,0)";
      g.fill(path);
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = "rgb(0,255,0)";
      g.lineWidth = 0.16;
      g.lineJoin = "round";
      g.stroke(path);
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    if (aniso && !RENDER) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));

    const loc = (n) => gl.getUniformLocation(prog, n);
    const UL = { rot: loc("uRot"), dist: loc("uDist"), f: loc("uF"), aspect: loc("uAspect"), shift: loc("uShift"), tex: loc("uTex"), light: loc("uLight") };
    const L = [-0.5, 0.56, 0.66], ln = Math.hypot(...L);

    return {
      draw(cam, R) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(prog);
        gl.bindVertexArray(vao);
        gl.uniformMatrix3fv(UL.rot, false, [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]);
        gl.uniform1f(UL.dist, cam.dist);
        gl.uniform1f(UL.f, F);
        gl.uniform1f(UL.aspect, ASPECT);
        gl.uniform1f(UL.shift, cam.shift);
        gl.uniform3f(UL.light, L[0] / ln, L[1] / ln, L[2] / ln);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(UL.tex, 0);
        gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 2D layers: sky, markers and callouts, grain

  const STARS = (() => {
    const r = mulberry32(7);
    return Array.from({ length: 520 }, () => ({ x: r(), y: r(), s: r() < 0.08 ? 2 : 1, a: 0.2 + r() * 0.6, tw: 0.6 + r() * 2.2, ph: r() * 6.28, d: 0.3 + r() * 0.7 }));
  })();
  const DUST = (() => {
    const r = mulberry32(11);
    return Array.from({ length: 34 }, () => ({ x: r(), y: r(), r: 2 + r() * 7, a: 0.03 + r() * 0.08, sp: 0.006 + r() * 0.012, d: 0.6 + r() * 1.2 }));
  })();
  const NEBULA = [
    { x: 0.12, y: 0.16, r: 0.75, c: "rgba(249,115,22,0.11)", d: 0.6 },
    { x: 0.92, y: 0.34, r: 0.6, c: "rgba(239,68,68,0.075)", d: 0.9 },
    { x: 0.55, y: 0.98, r: 0.85, c: "rgba(96,165,250,0.045)", d: 0.4 },
  ];
  const wrap01 = (v) => ((v % 1) + 1) % 1;

  let skyCache = null;
  function drawSky(ctx, t, cam) {
    // gradient and nebula are painted once into an oversized canvas and slid for parallax
    const PAD = 0.25;
    if (!skyCache) {
      skyCache = document.createElement("canvas");
      skyCache.width = Math.round(W * (1 + 2 * PAD));
      skyCache.height = Math.round(H * (1 + 2 * PAD));
      const g = skyCache.getContext("2d");
      const lg = g.createLinearGradient(0, 0, 0, skyCache.height);
      lg.addColorStop(0, "#160f0b");
      lg.addColorStop(0.55, "#0b0908");
      lg.addColorStop(1, "#060505");
      g.fillStyle = lg;
      g.fillRect(0, 0, skyCache.width, skyCache.height);
      for (const n of NEBULA) {
        const x = (n.x + PAD) * W, y = (n.y + PAD) * H;
        const rg = g.createRadialGradient(x, y, 0, x, y, n.r * W);
        rg.addColorStop(0, n.c);
        rg.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = rg;
        g.fillRect(0, 0, skyCache.width, skyCache.height);
      }
    }
    const ox = clamp(-PAD * W - cam.lon * 0.0012 * 0.7 * W, -2 * PAD * W, 0);
    const oy = clamp(-PAD * H + cam.lat * 0.001 * 0.7 * H, -2 * PAD * H, 0);
    ctx.drawImage(skyCache, ox, oy);
    for (const s of STARS) {
      const x = wrap01(s.x - cam.lon * 0.0009 * s.d) * W, y = wrap01(s.y + cam.lat * 0.0006 * s.d) * H;
      const a = s.a * (0.65 + 0.35 * Math.sin(t * s.tw + s.ph));
      ctx.fillStyle = `rgba(255,240,225,${a.toFixed(3)})`;
      ctx.fillRect(x, y, s.s * U * 1.5, s.s * U * 1.5);
    }
  }

  function drawMarker(ctx, p, th, t, alpha, gr) {
    const col = COLOR[th.status] || COLOR.watch;
    const base = gr * (0.009 + (th.intensity / 100) * 0.016);
    ctx.save();
    for (let i = 0; i < 2; i++) {
      const k = wrap01(t * 0.55 + i * 0.5 + th.lat * 0.013);
      ctx.globalAlpha = alpha * (1 - k) * 0.75;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1.5 * U, base * 0.2);
      ctx.beginPath();
      ctx.arc(p.x, p.y, base * (1.25 + k * 4.4), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;
    ctx.shadowColor = col;
    ctx.shadowBlur = base * 3.2;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, base, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,248,240,0.92)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, base * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCallout(ctx, p, th, amount) {
    if (amount <= 0) return;
    const col = COLOR[th.status] || COLOR.watch;
    const right = p.x < W * 0.52;
    const dir = right ? 1 : -1;
    const elbow = { x: p.x + dir * W * 0.075, y: p.y - H * 0.055 };
    const len = W * 0.27;
    const end = { x: elbow.x + dir * len, y: elbow.y };
    const seg1 = Math.hypot(elbow.x - p.x, elbow.y - p.y), totalLen = seg1 + len;
    const drawn = E.outCubic(clamp(amount * 1.4, 0, 1)) * totalLen;
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.2 * U;
    ctx.shadowColor = col;
    ctx.shadowBlur = 10 * U;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    if (drawn <= seg1) {
      const k = drawn / seg1;
      ctx.lineTo(lerp(p.x, elbow.x, k), lerp(p.y, elbow.y, k));
    } else {
      ctx.lineTo(elbow.x, elbow.y);
      ctx.lineTo(elbow.x + dir * (drawn - seg1), elbow.y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    const ta = E.outCubic(prog(amount, 0.45, 0.55));
    if (ta > 0) {
      ctx.globalAlpha = ta;
      ctx.textAlign = right ? "left" : "right";
      const x0 = right ? elbow.x + 4 * U : elbow.x - 4 * U;
      ctx.fillStyle = "#f7f1e8";
      ctx.font = `700 ${W * 0.05}px "Barlow Condensed"`;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(th.name.toUpperCase(), x0, elbow.y - 12 * U - (1 - ta) * 10 * U);
      ctx.fillStyle = col;
      ctx.font = `700 ${W * 0.031}px "Barlow Condensed"`;
      ctx.textBaseline = "top";
      ctx.fillText(`${(STATUS[th.status] || "").toUpperCase()} · ${(TREND[th.trend] || "").toUpperCase()} · ${th.stories_24h} REPORTS`, x0, elbow.y + 12 * U);
      ctx.fillRect(end.x - (right ? 9 * U : 0), end.y - 4.5 * U, 9 * U, 9 * U);
    }
    ctx.restore();
  }

  function drawFx(ctx, t, cam, R) {
    ctx.clearRect(0, 0, W, H);
    const gc = globeCircle(cam);
    // atmosphere halo just outside the limb
    const halo = ctx.createRadialGradient(gc.x, gc.y, gc.r * 0.97, gc.x, gc.y, gc.r * 1.34);
    halo.addColorStop(0, "rgba(255,138,60,0.32)");
    halo.addColorStop(0.3, "rgba(255,112,44,0.11)");
    halo.addColorStop(1, "rgba(255,96,32,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(gc.x, gc.y, gc.r * 1.34, 0, Math.PI * 2);
    ctx.fill();
    // sunlit limb bloom
    const bx = gc.x - gc.r * 0.62, by = gc.y - gc.r * 0.64;
    const bloom = ctx.createRadialGradient(bx, by, 0, bx, by, gc.r * 0.9);
    bloom.addColorStop(0, "rgba(255,190,140,0.10)");
    bloom.addColorStop(1, "rgba(255,190,140,0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(bx - gc.r * 0.9, by - gc.r * 0.9, gc.r * 1.8, gc.r * 1.8);

    for (const th of active) {
      const p = project(th.lat, th.lon, cam, R);
      if (p.facing <= 0) continue;
      drawMarker(ctx, p, th, t, clamp(p.facing * 6, 0, 1), gc.r);
    }
    const key = cam.key;
    if (key && key.theater && byId.has(key.theater)) {
      const th = byId.get(key.theater);
      const p = project(th.lat, th.lon, cam, R);
      const appear = prog(t, key.t + 0.55, 0.9);
      const vanish = cam.next ? prog(t, cam.next.t - 0.3, 0.3) : 0;
      if (p.facing > 0) drawCallout(ctx, p, th, appear * (1 - vanish));
    }
    // drifting dust in front of the globe
    if (!dustSprite) {
      dustSprite = document.createElement("canvas");
      dustSprite.width = dustSprite.height = 64;
      const g = dustSprite.getContext("2d"), rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      rg.addColorStop(0, "rgba(255,200,160,1)");
      rg.addColorStop(1, "rgba(255,200,160,0)");
      g.fillStyle = rg;
      g.fillRect(0, 0, 64, 64);
    }
    for (const d of DUST) {
      const x = wrap01(d.x - cam.lon * 0.002 * d.d) * W, y = wrap01(d.y - t * d.sp) * H, r = d.r * U * 3;
      ctx.globalAlpha = d.a;
      ctx.drawImage(dustSprite, x - r, y - r, 2 * r, 2 * r);
    }
    ctx.globalAlpha = 1;
  }
  let dustSprite = null;

  let grainTile = null;
  function drawGrain(ctx, t) {
    if (!grainTile) {
      const r = mulberry32(3), size = 256;
      grainTile = document.createElement("canvas");
      grainTile.width = grainTile.height = size;
      const g = grainTile.getContext("2d"), img = g.createImageData(size, size);
      for (let i = 0; i < img.data.length; i += 4) { const v = r() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      g.putImageData(img, 0, 0);
    }
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    const frame = Math.floor(t * 24);
    const ox = (frame * 73) % 256, oy = (frame * 151) % 256;
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.translate(-ox, -oy);
    ctx.fillStyle = ctx.createPattern(grainTile, "repeat");
    ctx.fillRect(0, 0, cw + 256, ch + 256);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // promo scenes: big kinetic captions, a hard cut every 1.5-2.5 s

  const rise = (words, tl, start, stagger = 0.05, dur = 0.5) => words.forEach((w, i) => {
    const p = E.outExpo(prog(tl, start + i * stagger, dur));
    tf(w, `translate3d(0,${(1 - p) * 108}%,0) rotateX(${(1 - p) * -82}deg)`, p);
  });
  const slam = (node, tl, start, from = 1.9, dur = 0.42) => {
    const p = E.outBack(prog(tl, start, dur));
    tf(node, `scale(${lerp(from, 1, p).toFixed(4)})`, prog(tl, start, dur * 0.35));
  };
  const slide = (node, tl, start, dx = 30, dur = 0.5) => {
    const p = E.outExpo(prog(tl, start, dur));
    tf(node, `translate3d(${(1 - p) * dx}cqw,0,0)`, p);
  };
  const beatOf = (tl, sc) => Math.min(sc.beats - 1, Math.floor(tl / (sc.dur / sc.beats)));
  const fmt = (v) => Math.round(v).toLocaleString("en-US");
  function caption(parent, text, cls = "cap") {
    const h = el("h2", cls);
    const words = maskedWords(h, text);
    parent.append(h);
    return words;
  }

  const BUILD = {
    hook(s) {
      const root = el("div"), b = el("div", "block");
      const tag = el("div", "chip alert", "Overnight");
      const num = el("div", "mega red", String(s.n));
      b.append(tag, num);
      const w1 = caption(b, "wars escalated"), w2 = caption(b, "while you slept.", "cap alt");
      root.append(b);
      return { root, update(tl) {
        slam(num, tl, 0, 2.4, 0.4);
        slide(tag, tl, 0.05, -20, 0.4);
        rise(w1, tl, 0.1, 0.07, 0.45);
        rise(w2, tl, 0.55, 0.07, 0.45);
      } };
    },

    ask(s) {
      const root = el("div"), b = el("div", "block");
      const w = caption(b, "Can you name them?", "cap big");
      const rows = el("div", "rows");
      const items = s.names.map((nm) => { const r = el("div", "row guess"); r.style.setProperty("--st", COLOR.critical); r.append(el("span", "nm", nm)); rows.append(r); return r; });
      b.append(rows);
      root.append(b);
      return { root, update(tl) {
        rise(w, tl, 0, 0.06, 0.4);
        items.forEach((r, i) => {
          slide(r, tl, 0.35 + i * 0.12, 25, 0.45);
          r.style.filter = `blur(${(lerp(2.2, 0, E.inOutCubic(prog(tl, 1.2 + i * 0.15, 0.5)))).toFixed(3)}cqw)`;
        });
      } };
    },

    track(s) {
      const root = el("div"), b = el("div", "block");
      const kick = el("div", "chip", "Live conflict tracker");
      const grid = el("div", "stats");
      const stats = [[s.tracked, "conflicts tracked"], [s.live, "active now"], [s.reports, "reports · 24h"]].map(([v, l]) => {
        const c = el("div", "stat"), n = el("div", "n", "0");
        c.append(n, el("div", "l", l));
        grid.append(c);
        return { c, n, v };
      });
      b.append(kick, grid);
      const w = caption(b, "Every conflict. Live.");
      root.append(b);
      return { root, update(tl) {
        slide(kick, tl, 0, -20, 0.4);
        stats.forEach((st, i) => {
          slam(st.c, tl, 0.15 + i * 0.12, 1.5, 0.4);
          st.n.textContent = fmt(st.v * E.outCubic(prog(tl, 0.2 + i * 0.12, 1.4)));
        });
        rise(w, tl, 0.5, 0.07, 0.45);
      } };
    },

    brief(s) {
      const root = el("div"), b = el("div", "block");
      const chip = el("div", "chip", "AI world brief");
      const w1 = caption(b, "One AI brief.");
      b.prepend(chip);
      const w2 = caption(b, "Every point sourced.", "cap alt");
      const lts = el("div", "lts");
      const cards = s.heads.map((h) => {
        const c = el("div", "lt");
        c.append(el("div", "lt-src", h.source), el("div", "lt-ttl", h.title));
        lts.append(c);
        return c;
      });
      b.append(lts);
      root.append(b);
      return { root, update(tl, sc) {
        slide(chip, tl, 0, -20, 0.4);
        rise(w1, tl, 0.05, 0.07, 0.45);
        rise(w2, tl, sc.dur / sc.beats * 0.6, 0.07, 0.45);
        const k = beatOf(tl, sc), step = sc.dur / sc.beats;
        cards.forEach((c, i) => {
          c.style.display = i === k ? "" : "none";
          if (i !== k) return;
          const p = E.outExpo(prog(tl, i * step + 0.1, 0.45));
          tf(c, `translate3d(${(1 - p) * 40}cqw,0,0) skewX(${(1 - p) * -10}deg)`, p);
        });
      } };
    },

    lang() {
      const root = el("div"), b = el("div", "block");
      const kick = el("div", "chip", "3 languages");
      b.append(kick);
      const rows = [["EN", "English"], ["DE", "Deutsch"], ["SR", "Srpski"]].map(([c, n]) => {
        const r = el("div", "lang");
        r.append(el("span", "code", c), el("span", "nm", n));
        b.append(r);
        return r;
      });
      root.append(b);
      return { root, update(tl) {
        slide(kick, tl, 0, -20, 0.4);
        rows.forEach((r, i) => slam(r, tl, 0.12 + i * 0.32, 1.7, 0.38));
      } };
    },

    free() {
      const root = el("div"), b = el("div", "block");
      const mega = el("div", "mega accent", "FREE");
      b.append(mega);
      const w = caption(b, "No paywall on the news.");
      const note = el("div", "chip ghost", "No account · No ads wall");
      b.append(note);
      root.append(b);
      return { root, update(tl) {
        slam(mega, tl, 0, 2.2, 0.4);
        rise(w, tl, 0.5, 0.07, 0.45);
        slide(note, tl, 1.0, -20, 0.4);
      } };
    },

    pro(s) {
      const root = el("div"), b = el("div", "block");
      const card = el("div", "plan");
      const head = el("div", "plan-h");
      head.append(el("span", "plan-nm", "World Pulse Pro"), el("span", "chip kofi", "Ko-fi"));
      const price = el("div", "price");
      price.append(el("span", "cur", "$"), el("span", "amt", "3"), el("span", "per", "/month"));
      const feats = ["Daily AI intelligence briefing", "90-day trends", "Instant alerts", "Watchlist"].map((f) => {
        const r = el("div", "feat");
        r.append(el("i", null, "✓"), el("span", null, f));
        return r;
      });
      const biz = el("div", "biz", "Business · $49/month");
      card.append(head, price, ...feats, biz);
      b.append(card);
      root.append(b);
      return { root, update(tl, sc) {
        const step = sc.dur / sc.beats;
        slam(card, tl, 0, 1.35, 0.45);
        slam(price, tl, 0.3, 2.0, 0.4);
        const at = [step * 0.75, step * 1.05, step * 1.65, step * 2.05];
        feats.forEach((f, i) => slide(f, tl, at[i], 25, 0.4));
        slide(biz, tl, step * 2.4, 25, 0.4);
      } };
    },

    end() {
      const root = el("div"), b = el("div", "block end");
      const logo = logoSvg("end-logo");
      const name = el("h2", "end-name");
      const nameWords = maskedWords(name, "World Pulse");
      const cta = el("div", "cta", "Link in bio");
      const shine = el("i", "shine");
      cta.append(shine);
      const url = el("p", "end-tag", "ilicvix02.github.io/Claude");
      b.append(logo.svg, name, cta, url);
      root.append(b);
      [logo.circle, logo.path].forEach((n) => { n.style.strokeDasharray = "1"; });
      return { root, update(tl) {
        logo.circle.style.strokeDashoffset = String(1 - E.inOutCubic(prog(tl, 0.05, 0.7)));
        logo.path.style.strokeDashoffset = String(1 - E.inOutCubic(prog(tl, 0.35, 0.7)));
        slam(logo.svg, tl, 0, 1.6, 0.5);
        rise(nameWords, tl, 0.2, 0.1, 0.6);
        slam(cta, tl, 0.8, 1.8, 0.45);
        shine.style.transform = `translateX(${lerp(-150, 360, E.inOutCubic(prog(tl, 1.4, 0.9)))}%)`;
        slide(url, tl, 1.1, -15, 0.5);
      } };
    },
  };

  let hud = null, flash = null;
  function buildDom() {
    ui.replaceChildren();
    const root = el("div", "hud"), logo = logoSvg(), txt = el("div"), live = el("div", "live"), dot = el("span", "dot");
    live.append(dot, el("span", null, "Live"));
    txt.append(el("div", "nm", "WORLD PULSE"), live);
    root.append(logo.svg, txt);
    ui.append(root);
    hud = { root, dot };
    for (const s of scenes) {
      s.dom = BUILD[s.kind](s);
      s.dom.root.classList.add("scene");
      ui.append(s.dom.root);
    }
    flash = $("flash");
  }

  // ---------------------------------------------------------------------------
  // frame

  let globe = null, ctxSky = null, ctxFx = null, ctxGrain = null;

  function resize() {
    const rect = stage.getBoundingClientRect();
    const dpr = RENDER ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(2, Math.round(rect.width * dpr));
    H = Math.max(2, Math.round(rect.height * dpr));
    ASPECT = W / H;
    U = W / 1080;
    const scale = { bg: 1, globe: RENDER ? 0.75 : 1, fx: 1, grain: 0.5 };
    for (const id of Object.keys(scale)) {
      const c = $(id);
      c.width = Math.round(W * scale[id]);
      c.height = Math.round(H * scale[id]);
    }
    skyCache = null;
  }

  function renderAt(t) {
    t = clamp(t, 0, total);
    const cam = cameraAt(t);
    // a zoom punch on every cut
    let punch = 0;
    for (const c of cuts) if (t >= c) punch = 1 - E.outCubic(prog(t, c, 0.35));
    const camP = { ...cam, dist: cam.dist * (1 - 0.05 * punch) };
    const R = rotation(camP);
    drawSky(ctxSky, t, camP);
    if (globe) globe.draw(camP, R);
    drawFx(ctxFx, t, camP, R);
    drawGrain(ctxGrain, t);
    let fl = 0;
    for (const c of cuts) if (t >= c) fl = (1 - prog(t, c, 0.16)) * (c === 0 ? 0 : 0.32);
    flash.style.opacity = fl.toFixed(3);

    const last = scenes[scenes.length - 1];
    tf(hud.root, "none", (1 - prog(t, last.start, 0.3)));
    hud.dot.style.opacity = (0.35 + 0.65 * (0.5 + 0.5 * Math.cos(t * Math.PI * 2 * 1.2))).toFixed(3);

    scenes.forEach((s, i) => {
      const tl = t - s.start, end = i === scenes.length - 1;
      const visible = tl >= 0 && (end || tl < s.dur);
      s.dom.root.style.visibility = visible ? "visible" : "hidden";
      if (!visible) return;
      s.dom.update(tl, s, t, cam);
      const e = end ? 0 : E.inCubic(prog(tl, s.dur - 0.14, 0.14));
      s.dom.root.style.opacity = e > 0 ? (1 - e).toFixed(3) : "";
      s.dom.root.style.transform = e > 0 ? `translate3d(${(-e * 12).toFixed(3)}cqw,0,0) scale(${(1 + e * 0.08).toFixed(3)})` : "";
    });
  }

  // ---------------------------------------------------------------------------
  // boot, preview player and export API

  const ready = (async () => {
    const data = await loadData();
    await Promise.all(['700 40px "Barlow Condensed"', '600 40px "Barlow Condensed"', '500 40px "Barlow"', '600 40px "Barlow"', '700 40px "Newsreader"']
      .map((f) => document.fonts.load(f)));
    ({ scenes, active, byId } = buildScenes(data));
    buildDom();
    resize();
    ctxSky = $("bg").getContext("2d");
    ctxFx = $("fx").getContext("2d");
    ctxGrain = $("grain").getContext("2d");
    globe = initGlobe($("globe"));
    setTimeline(null);
    await document.fonts.ready;
    return data;
  })();

  window.__story = {
    ready,
    script: () => scenes.map((s) => ({ id: s.id, say: s.say })),
    setTimeline,
    renderAt,
    music: { style: "promo", bpm: 128, endSting: true },
    get total() { return total; },
  };

  if (RENDER) return;

  ready.then(() => {
    renderAt(0.9);
    let raf = 0;
    const start = () => {
      const t0 = performance.now();
      cancelAnimationFrame(raf);
      const loop = (now) => { const t = (now - t0) / 1000; renderAt(t); if (t < total) raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    };
    stage.addEventListener("click", start);
    if (location.hash === "#autoplay") setTimeout(start, 300);
    window.addEventListener("resize", () => { resize(); renderAt(0.9); });
  }).catch((err) => console.warn(err));
})();
