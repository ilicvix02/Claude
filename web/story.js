/* World Pulse video brief: a motion-graphics renderer for today's brief.
 *
 * Every frame is a pure function of time (renderAt(t)), so the phone preview and the
 * frame-by-frame MP4 export (scripts/render_story.mjs) are identical. Layers, back to front:
 * starfield and nebula (2D canvas), a lit 3D globe (WebGL2), markers, callouts and a text scrim
 * (2D canvas), kinetic typography with CSS 3D transforms (DOM), and film grain with a vignette.
 * The camera follows a critically damped spring between per-scene targets. Scene timing comes
 * from the voiceover's real durations when exporting, or from reading speed in the preview.
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
    const [b, c, s] = await Promise.all(["brief.json", "conflicts.json", "state.json"].map((f) => getJSON(base, f)));
    return { brief: b.data, meta: b.meta, conflicts: c.data, state: s.data };
  }
  async function loadData() {
    try { return await loadFrom(CFG.apiBase); } catch (err) {
      if (CFG.bundledApi && CFG.bundledApi !== CFG.apiBase) return loadFrom(CFG.bundledApi);
      throw err;
    }
  }

  const spokenName = (t) => t.spoken || t.name.replace(/\s*[–—]\s*/g, " and ").replace(/\s*&\s*/g, " and ");
  const listOf = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
  function speakable(text) {
    let s = String(text || "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/(\d)\s*[–—]\s*(\d)/g, "$1 to $2")
      .replace(/\s+[–—]\s+/g, ", ")
      .replace(/[–—]/g, " and ")
      .replace(/\s*&\s*/g, " and ")
      .replace(/\bUN\b/g, "U.N.")
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/\s+/g, " ").trim();
    if (s && !/[.!?…]["']?$/.test(s)) s += ".";
    return s;
  }
  const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  function buildScenes(d) {
    const { brief, conflicts, state } = d;
    const theaters = conflicts ? conflicts.theaters : [];
    const ids = new Map(theaters.map((t) => [t.id, t]));
    const live = theaters.filter((t) => t.stories_24h > 0).sort((a, b) => b.intensity - a.intensity);
    const hottest = live[0] || null;
    const when = new Date(brief.generated_at);
    const part = (o) => when.toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
    const date = { weekday: part({ weekday: "long" }), month: part({ month: "long" }), day: Number(part({ day: "numeric" })), year: when.getUTCFullYear() };
    const theaterOf = (b) => {
      for (const s of b.stories || []) for (const id of s.theaters || []) if (ids.has(id)) return ids.get(id);
      return null;
    };

    const out = [];
    out.push({ id: "intro", kind: "intro", min: 2.6, date,
      say: `This is World Pulse, with your world brief for ${date.weekday}, ${date.month} ${ordinal(date.day)}.`,
      focus: { lat: 22, lon: 34, dist: 6.9, shift: 0.2, spin: 5 } });
    out.push({ id: "headline", kind: "headline", min: 3.2, headline: brief.headline, state,
      say: speakable(brief.headline),
      focus: { lat: 25, lon: 40, dist: 5.4, shift: 0.42, spin: 2.5 } });
    if (live.length) {
      const top = live.slice(0, 3);
      out.push({ id: "hotspots", kind: "hotspots", min: 4.5, count: live.length, top,
        say: `Right now, ${live.length} conflicts are in the news. The most intense: ${listOf(top.map(spokenName))}.`,
        seq: top.map((t) => ({ lat: t.lat, lon: t.lon, dist: 3.6, shift: 0.44, spin: 0, theater: t.id })) });
    }
    const n = brief.bullets.length;
    brief.bullets.forEach((b, i) => {
      const th = theaterOf(b);
      const text = speakable(b.text);
      const say = i === n - 1 && n > 2 ? `And finally, ${text}` : text;
      out.push({ id: `point${i + 1}`, kind: "point", index: i, text: b.text, stories: b.stories || [], theater: th, min: 2.8,
        say, prefix: say.length - text.length,
        focus: th ? { lat: th.lat, lon: th.lon, dist: 3.0, shift: 0.46, spin: 0, theater: th.id } : null });
    });
    if (brief.watch) {
      const text = speakable(brief.watch);
      out.push({ id: "watch", kind: "watch", text: brief.watch, theater: hottest, min: 2.8,
        say: `What to watch: ${text}`, prefix: "What to watch: ".length,
        focus: hottest ? { lat: hottest.lat, lon: hottest.lon, dist: 3.4, shift: 0.46, spin: 1.5, theater: hottest.id } : null });
    }
    const sponsor = d.meta && d.meta.sponsor ? String(d.meta.sponsor.text).trim() : "";
    out.push({ id: "outro", kind: "outro", min: 3.6, ai: brief.source === "ai", sponsor,
      say: `${sponsor ? `Today's brief is presented by ${speakable(sponsor)} ` : ""}Every point links to its sources. Get World Pulse free. The link is in our bio.`,
      focus: { lat: 16, lon: (hottest ? hottest.lon : 30) + 30, dist: 6.4, shift: 0.3, spin: 7 } });
    return { scenes: out, active: live, byId: ids };
  }

  // ---------------------------------------------------------------------------
  // timeline and camera

  const LEAD = 0.15, TAIL = 0.3, END_HOLD = 0.8;
  let scenes = [], active = [], byId = new Map(), total = 0, camKeys = [];
  const estimate = (text) => text.split(/\s+/).filter(Boolean).length / 3.1;

  function setTimeline(speech) {
    let t = 0;
    for (const s of scenes) {
      s.speech = speech && speech[s.id] != null ? Number(speech[s.id]) : estimate(s.say);
      s.start = t;
      s.voiceAt = LEAD;
      s.dur = Math.max(s.min, LEAD + s.speech + TAIL);
      t += s.dur;
    }
    total = t + END_HOLD;
    camKeys = buildCamKeys();
    return { total, scenes: scenes.map((s) => ({ id: s.id, start: s.start, dur: s.dur, voiceAt: s.start + s.voiceAt, speech: s.speech, say: s.say })) };
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
    const w = 3.4, dt = 1 / 60;
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
  // typography scenes

  const BUILD = {
    intro(s) {
      const root = el("div"), b = el("div", "block");
      const kicker = el("div", "kicker", "Your daily briefing");
      const title = el("h2", "title"), l1 = el("span", "ln", "World"), l2 = el("span", "ln alt", "Brief");
      title.append(l1, l2);
      const rule = el("div", "rule");
      const date = el("div", "date", `${s.date.weekday} · ${s.date.day} ${s.date.month} ${s.date.year}`);
      b.append(kicker, title, rule, date);
      root.append(b);
      return {
        root,
        update(tl) {
          const k = E.outCubic(prog(tl, 0.2, 0.6));
          tf(kicker, `translate3d(${(1 - k) * -6}cqw,0,0)`, k);
          [l1, l2].forEach((ln, i) => {
            const p = E.outExpo(prog(tl, 0.35 + i * 0.22, 1.2));
            tf(ln, `translate3d(0,${(1 - p) * 6}cqh,${(1 - p) * -90}cqw) rotateX(${(1 - p) * 62}deg)`, p);
            ln.style.letterSpacing = `${0.03 + (1 - p) * 0.45}em`;
          });
          rule.style.transform = `scaleX(${E.inOutCubic(prog(tl, 1.0, 0.9))})`;
          const pd = E.outCubic(prog(tl, 1.3, 0.9));
          date.style.opacity = pd;
          date.style.letterSpacing = `${0.32 + (1 - pd) * 0.5}em`;
        },
      };
    },

    headline(s) {
      const root = el("div"), b = el("div", "block");
      const chip = el("div", "chip", "Today's headline");
      const h = el("h2", "headline");
      const words = maskedWords(h, s.headline);
      const sweep = el("div", "sweep");
      h.append(sweep);
      b.append(chip, h);
      let meter = null;
      if (s.state) {
        meter = { root: el("div", "meter"), val: el("div", "val", "0"), lab: el("div", "lab", "Global tension"), mood: el("div", "mood", s.state.mood), bar: el("div", "bar"), fill: el("i") };
        meter.bar.append(meter.fill);
        meter.root.append(meter.val, meter.lab, meter.mood, meter.bar);
        b.append(meter.root);
      }
      root.append(b);
      return {
        root,
        update(tl) {
          const c = E.outExpo(prog(tl, 0.05, 0.7));
          tf(chip, `translate3d(${(1 - c) * -10}cqw,0,0) rotateY(${(1 - c) * 40}deg)`, c);
          words.forEach((w, i) => {
            const p = E.outExpo(prog(tl, 0.22 + i * 0.065, 1.0));
            tf(w, `translate3d(0,${(1 - p) * 108}%,0) rotateX(${(1 - p) * -82}deg)`, p);
          });
          const sw = prog(tl, 1.15, 1.15);
          sweep.style.transform = `translateX(${lerp(-110, 110, E.inOutCubic(sw))}%)`;
          sweep.style.opacity = sw > 0 && sw < 1 ? "1" : "0";
          if (meter) {
            const m = E.outCubic(prog(tl, 1.0, 0.7));
            tf(meter.root, `translate3d(0,${(1 - m) * 3}cqh,0)`, m);
            const v = Math.round(s.state.tension_index * E.outCubic(prog(tl, 1.1, 1.7)));
            meter.val.textContent = String(v);
            meter.fill.style.width = `${v}%`;
            meter.mood.style.opacity = E.outCubic(prog(tl, 2.3, 0.6));
          }
        },
      };
    },

    hotspots(s) {
      const root = el("div"), b = el("div", "block");
      const kicker = el("div", "kicker", "Live conflict tracker");
      const count = el("div", "count"), n = el("div", "n", "0"), lab = el("div", "lab");
      lab.append(el("div", null, "Active"), el("div", null, "conflicts"));
      count.append(n, lab);
      const rows = el("div", "rows");
      const items = s.top.map((t) => {
        const row = el("div", "row");
        row.style.setProperty("--st", COLOR[t.status] || COLOR.watch);
        row.append(el("span", "nm", t.name), el("span", "st", `${STATUS[t.status]} · ${TREND[t.trend] || t.trend}`.toUpperCase()));
        rows.append(row);
        return { row, id: t.id };
      });
      b.append(kicker, count, rows);
      root.append(b);
      return {
        root,
        update(tl, sc, t, cam) {
          const k = E.outCubic(prog(tl, 0.05, 0.6));
          tf(kicker, `translate3d(${(1 - k) * -6}cqw,0,0)`, k);
          const c = E.outExpo(prog(tl, 0.2, 0.9));
          tf(count, `translate3d(0,0,${(1 - c) * -60}cqw) rotateX(${(1 - c) * 50}deg)`, c);
          n.textContent = String(Math.round(s.count * E.outCubic(prog(tl, 0.3, 1.3))));
          const focus = cam.key && cam.key.theater;
          items.forEach((it, i) => {
            const p = E.outExpo(prog(tl, 0.75 + i * 0.2, 1.0));
            const on = focus === it.id ? 1 : 0;
            tf(it.row, `translate3d(${(1 - p) * 32}cqw,0,${(1 - p) * -40}cqw) rotateY(${(1 - p) * -58}deg) scale(${0.965 + on * 0.035})`, p * (0.5 + on * 0.5));
          });
        },
      };
    },

    point(s) { return captionScene(s, String(s.index + 1).padStart(2, "0"), null); },
    watch(s) { return captionScene(s, null, "What to watch"); },

    outro(s) {
      const root = el("div"), b = el("div", "block end");
      const logo = logoSvg("end-logo");
      const name = el("h2", "end-name");
      const nameWords = maskedWords(name, "World Pulse");
      const tag = el("p", "end-tag", "The world's conflicts, briefed every hour.");
      const cta = el("div", "cta", "Free app · link in bio");
      const shine = el("i", "shine");
      cta.append(shine);
      const disc = el("p", "disclosure", s.ai
        ? "Summaries written by AI (Claude) from the linked news reports. It can make mistakes. Every point links to its sources in the app."
        : "An automated digest of the most-covered stories. Every point links to its sources in the app.");
      const spon = s.sponsor ? el("p", "presented", `Presented by ${s.sponsor}`) : null;
      b.append(logo.svg, name, tag, cta, ...(spon ? [spon] : []), disc);
      root.append(b);
      [logo.circle, logo.path].forEach((n) => { n.style.strokeDasharray = "1"; });
      return {
        root,
        update(tl) {
          const lc = E.inOutCubic(prog(tl, 0.1, 1.0)), lp = E.inOutCubic(prog(tl, 0.55, 1.0));
          logo.circle.style.strokeDashoffset = String(1 - lc);
          logo.path.style.strokeDashoffset = String(1 - lp);
          const ls = E.outBack(prog(tl, 0.05, 0.9));
          tf(logo.svg, `scale(${0.7 + 0.3 * ls}) rotate(${(1 - ls) * -30}deg)`, prog(tl, 0.05, 0.3));
          nameWords.forEach((w, i) => {
            const p = E.outExpo(prog(tl, 0.6 + i * 0.12, 1.0));
            tf(w, `translate3d(0,${(1 - p) * 108}%,0) rotateX(${(1 - p) * -82}deg)`, p);
          });
          const tg = E.outCubic(prog(tl, 1.1, 0.7));
          tf(tag, `translate3d(0,${(1 - tg) * 2}cqh,0)`, tg);
          const cp = E.outBack(prog(tl, 1.5, 0.75));
          tf(cta, `scale(${0.55 + 0.45 * cp})`, prog(tl, 1.5, 0.25));
          shine.style.transform = `translateX(${lerp(-150, 360, E.inOutCubic(prog(tl, 2.3, 1.0)))}%)`;
          disc.style.opacity = String(E.outCubic(prog(tl, 2.0, 0.8)));
          if (spon) { const sp = E.outCubic(prog(tl, 1.8, 0.7)); tf(spon, `translate3d(0,${(1 - sp) * 1.5}cqh,0)`, sp); }
        },
      };
    },
  };

  function captionScene(s, numeral, kicker) {
    const root = el("div"), b = el("div", "block");
    let num = null, kick = null, chip = null;
    if (numeral) { num = el("div", "numeral", numeral); b.append(num); }
    if (kicker) { kick = el("div", "kicker", kicker); b.append(kick); }
    if (s.theater) {
      chip = el("div", "chip ghost");
      chip.style.setProperty("--st", COLOR[s.theater.status] || COLOR.watch);
      chip.append(el("i"), `${s.theater.name} · ${STATUS[s.theater.status]}`);
      b.append(chip);
    }
    const say = el("p", "say");
    const len = s.text.length;
    say.style.fontSize = `${clamp(6.9 - (len - 70) * 0.014, 5.3, 6.9).toFixed(2)}cqw`;
    const words = captionWords(say, s.text);
    b.append(say);
    let src = null;
    const stories = s.stories || [];
    if (stories.length) {
      src = el("div", "src");
      const names = [...new Set(stories.map((x) => x.source.name))];
      const more = stories.length === 1 ? (stories[0].coverage || 1) - 1 : names.length - 2;
      src.append(names.length > 1 ? "Sources · " : "Source · ", el("b", null, names.slice(0, 2).join(", ")), more > 0 ? ` +${more} more` : "");
      b.append(src);
    }
    root.append(b);
    return {
      root,
      update(tl, sc) {
        if (num) {
          const p = E.outExpo(prog(tl, 0.0, 1.1));
          tf(num, `translate3d(${(1 - p) * -26}cqw,0,${(1 - p) * -60}cqw) rotateY(${-16 - (1 - p) * 44}deg) rotateX(${(1 - p) * 20}deg)`, p);
        }
        if (kick) {
          const k = E.outCubic(prog(tl, 0.05, 0.6));
          tf(kick, `translate3d(${(1 - k) * -6}cqw,0,0)`, k);
        }
        if (chip) {
          const c = E.outExpo(prog(tl, 0.2, 0.7));
          tf(chip, `translate3d(${(1 - c) * -8}cqw,0,0) rotateY(${(1 - c) * 35}deg)`, c);
        }
        // words rise in, then light up as they are spoken
        const spoken = ((tl - sc.voiceAt) / Math.max(sc.speech, 0.1)) * sc.say.length - (sc.prefix || 0);
        const frac = spoken / Math.max(len, 1);
        words.forEach((w, i) => {
          const p = E.outCubic(prog(tl, 0.15 + i * 0.016, 0.5));
          const lit = clamp((frac - w.from) / Math.max(w.to - w.from, 0.02), 0, 1);
          w.el.style.transform = `translate3d(0,${((1 - p) * 1.4).toFixed(3)}cqh,0)`;
          w.el.style.opacity = (p * (0.3 + 0.7 * lit)).toFixed(3);
        });
        if (src) {
          const q = E.outCubic(prog(tl, 0.7, 0.6));
          tf(src, `translate3d(0,${(1 - q) * 1.5}cqh,0)`, q);
        }
      },
    };
  }

  let hud = null;
  function buildDom(data) {
    ui.replaceChildren();
    const when = new Date(data.brief.generated_at);
    const short = when.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    const root = el("div", "hud"), logo = logoSvg(), txt = el("div"), live = el("div", "live"), dot = el("span", "dot");
    live.append(dot, el("span", null, `Live · ${short}`));
    txt.append(el("div", "nm", "WORLD PULSE"), live);
    root.append(logo.svg, txt);
    ui.append(root);
    hud = { root, dot };
    for (const s of scenes) {
      s.dom = BUILD[s.kind](s, data);
      s.dom.root.classList.add("scene");
      ui.append(s.dom.root);
    }
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
    // Exports render in software, so the globe and grain use fewer pixels there (the CSS scales them up).
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
    const R = rotation(cam);
    drawSky(ctxSky, t, cam);
    if (globe) globe.draw(cam, R);
    drawFx(ctxFx, t, cam, R);
    drawGrain(ctxGrain, t);

    const outro = scenes[scenes.length - 1];
    const enter = E.outCubic(prog(t, 0.4, 0.8));
    tf(hud.root, `translate3d(${(1 - enter) * -5}cqw,0,0)`, enter * (1 - prog(t, outro.start, 0.5)));
    hud.dot.style.opacity = (0.35 + 0.65 * (0.5 + 0.5 * Math.cos(t * Math.PI * 2 * 0.8))).toFixed(3);

    scenes.forEach((s, i) => {
      const tl = t - s.start, last = i === scenes.length - 1;
      const visible = tl >= 0 && (last || tl < s.dur);
      s.dom.root.style.visibility = visible ? "visible" : "hidden";
      if (!visible) return;
      s.dom.update(tl, s, t, cam);
      const e = last ? 0 : E.inCubic(prog(tl, s.dur - 0.3, 0.3));
      s.dom.root.style.opacity = e > 0 ? (1 - e).toFixed(3) : "";
      s.dom.root.style.transform = e > 0 ? `translate3d(0,${(-e * 5).toFixed(3)}cqh,${(-e * 12).toFixed(3)}cqw)` : "";
      s.dom.root.style.filter = e > 0 ? `blur(${(e * 1.1).toFixed(3)}cqw)` : "";
    });
  }

  // ---------------------------------------------------------------------------
  // boot, preview player and export API

  const ready = (async () => {
    const data = await loadData();
    await Promise.all(['700 40px "Barlow Condensed"', '600 40px "Barlow Condensed"', '500 40px "Barlow"', '600 40px "Barlow"', '650 40px "Newsreader"', '700 40px "Newsreader"']
      .map((f) => document.fonts.load(f)));
    ({ scenes, active, byId } = buildScenes(data));
    buildDom(data);
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
    get total() { return total; },
  };

  if (RENDER) return;

  let raf = 0;
  ready.then((data) => {
    const intro = $("intro"), play = $("play"), dl = $("download");
    renderAt(Math.min(2.4, total));
    intro.hidden = false;
    play.disabled = false;
    play.textContent = `Play · about ${Math.round(total)} seconds`;
    if (data.meta && data.meta.source_code) {
      dl.href = `${data.meta.source_code}/releases/download/daily-video/world-brief.mp4`;
      dl.hidden = false;
    }
    const start = () => {
      intro.hidden = true;
      const t0 = performance.now();
      cancelAnimationFrame(raf);
      const loop = (now) => {
        const t = (now - t0) / 1000;
        renderAt(t);
        if (t < total) raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    };
    play.addEventListener("click", start);
    play.focus();
    if (location.hash === "#autoplay") setTimeout(start, 500);
    window.addEventListener("resize", () => { resize(); renderAt(Math.min(2.4, total)); });
  }).catch((err) => {
    $("intro").hidden = false;
    $("play").textContent = "Couldn't load today's brief";
    console.warn(err);
  });
})();
