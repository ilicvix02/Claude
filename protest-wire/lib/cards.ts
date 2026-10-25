"use client";
// Share images drawn on the phone (canvas): Story cards, profile-picture frames, protest signs, poll results.
// Everything happens on the device; user photos are never uploaded.

const LIME = "#D4F94E";
const INK = "#0A0B0A";

function fonts(): { display: string; wide: string } {
  const cs = getComputedStyle(document.documentElement);
  return {
    display: cs.getPropertyValue("--font-display").trim() || "system-ui, sans-serif",
    wide: cs.getPropertyValue("--font-wide").trim() || "system-ui, sans-serif",
  };
}

export async function ready(): Promise<void> {
  try { await document.fonts.ready; } catch { /* fine */ }
}

function mark(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color = LIME): void {
  const s = size / 64;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(32, 3); ctx.lineTo(57, 17.5); ctx.lineTo(57, 46.5); ctx.lineTo(32, 61); ctx.lineTo(7, 46.5); ctx.lineTo(7, 17.5); ctx.closePath();
  ctx.stroke();
  ctx.lineWidth = 5;
  for (const y of [42, 33, 24]) {
    ctx.beginPath(); ctx.moveTo(19, y); ctx.lineTo(32, y - 11); ctx.lineTo(45, y); ctx.stroke();
  }
  ctx.restore();
}

function stage(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w, h);
  // Spotlight beams
  for (let i = 0; i < 5; i++) {
    const x = (w / 6) * (i + 1);
    const g = ctx.createLinearGradient(x, 0, x, h * 0.75);
    g.addColorStop(0, "rgba(212,249,78,0.32)");
    g.addColorStop(1, "rgba(212,249,78,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 10, 0); ctx.lineTo(x + 10, 0);
    ctx.lineTo(x + 170 + (i - 2) * 60, h * 0.75); ctx.lineTo(x - 170 + (i - 2) * 60, h * 0.75);
    ctx.closePath();
    ctx.fill();
  }
  // Chevrons
  ctx.save();
  ctx.strokeStyle = LIME;
  ctx.shadowColor = LIME;
  ctx.shadowBlur = 24;
  for (let i = 0; i < 4; i++) {
    ctx.globalAlpha = 0.55 - i * 0.12;
    ctx.lineWidth = 8 - i * 1.5;
    const off = w * 0.3 + i * 90;
    ctx.beginPath(); ctx.moveTo(w / 2 - off + 90, h * 0.12); ctx.lineTo(w / 2 - off, h * 0.33); ctx.lineTo(w / 2 - off + 90, h * 0.54); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w / 2 + off - 90, h * 0.12); ctx.lineTo(w / 2 + off, h * 0.33); ctx.lineTo(w / 2 + off - 90, h * 0.54); ctx.stroke();
  }
  ctx.restore();
  // Floor grid
  ctx.save();
  ctx.strokeStyle = "rgba(212,249,78,0.18)";
  ctx.lineWidth = 2;
  const horizon = h * 0.78;
  for (let i = -12; i <= 12; i++) {
    ctx.beginPath(); ctx.moveTo(w / 2 + i * 30, horizon); ctx.lineTo(w / 2 + i * 260, h); ctx.stroke();
  }
  for (let k = 0; k < 8; k++) {
    const y = horizon + (h - horizon) * (k / 8) ** 1.8;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.restore();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** Fit text into a box: shrink font size until the wrapped lines fit. Returns size and lines. */
function fit(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, maxW: number, maxH: number, start: number, lineH = 1.02) {
  let px = start;
  let lines: string[] = [];
  while (px > 18) {
    ctx.font = font(px);
    lines = wrap(ctx, text, maxW);
    if (lines.length * px * lineH <= maxH && lines.every((l) => ctx.measureText(l).width <= maxW)) break;
    px -= 4;
  }
  return { px, lines };
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export interface StoryCard {
  number: string;
  line: string;
  cityLine: string;
  cta: string;
  url: string;
}

/** 1080×1920 Instagram/TikTok Story: "I'm #4,812". */
export function drawStory(canvas: HTMLCanvasElement, c: StoryCard): void {
  const w = 1080, h = 1920;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const f = fonts();
  stage(ctx, w, h);

  ctx.save();
  ctx.shadowColor = LIME; ctx.shadowBlur = 50;
  mark(ctx, w / 2, 470, 260);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.font = `800 52px ${f.wide}`;
  ctx.fillText("PROTEST WIRE", w / 2, 720);

  ctx.save();
  ctx.fillStyle = LIME;
  ctx.shadowColor = LIME; ctx.shadowBlur = 40;
  const n = fit(ctx, c.number, (px) => `800 ${px}px ${f.display}`, w - 140, 300, 300);
  ctx.font = `800 ${n.px}px ${f.display}`;
  ctx.fillText(c.number, w / 2, 720 + 40 + n.px * 0.85);
  ctx.restore();

  ctx.fillStyle = "#fff";
  const body = fit(ctx, c.line, (px) => `800 ${px}px ${f.display}`, w - 160, 330, 84, 1.08);
  ctx.font = `800 ${body.px}px ${f.display}`;
  let y = 1180;
  for (const l of body.lines) { ctx.fillText(l, w / 2, y); y += body.px * 1.08; }

  ctx.font = `700 46px ${f.display}`;
  ctx.fillStyle = LIME;
  ctx.fillText(c.cityLine, w / 2, y + 40);

  // CTA pill
  ctx.save();
  ctx.shadowColor = LIME; ctx.shadowBlur = 50;
  ctx.fillStyle = LIME;
  pill(ctx, 110, 1640, w - 220, 130, 65);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = INK;
  const cta = fit(ctx, c.cta.toUpperCase(), (px) => `800 ${px}px ${f.wide}`, w - 300, 70, 44);
  ctx.font = `800 ${cta.px}px ${f.wide}`;
  ctx.fillText(cta.lines[0], w / 2, 1722);
  ctx.fillStyle = "rgba(255,255,255,.75)";
  ctx.font = `600 34px ${f.display}`;
  ctx.fillText(c.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), w / 2, 1850);
}

export type FlagStyle = "ring" | "banner" | "duo";

/** 1080×1080 profile picture: the user's photo framed with the Rise mark (Twibbon-style). */
export function drawFlag(canvas: HTMLCanvasElement, img: HTMLImageElement | null, style: FlagStyle, text: string): void {
  const s = 1080;
  canvas.width = s; canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  const f = fonts();
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, s, s);
  if (img) {
    const scale = Math.max(s / img.naturalWidth, s / img.naturalHeight);
    const iw = img.naturalWidth * scale, ih = img.naturalHeight * scale;
    ctx.save();
    if (style === "duo") ctx.filter = "grayscale(1) contrast(1.15)";
    ctx.drawImage(img, (s - iw) / 2, (s - ih) / 2, iw, ih);
    ctx.restore();
    if (style === "duo") {
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = LIME;
      ctx.fillRect(0, 0, s, s);
      ctx.restore();
    }
  } else {
    stage(ctx, s, s);
  }
  const label = text.toUpperCase();
  if (style === "ring") {
    ctx.save();
    ctx.strokeStyle = LIME; ctx.lineWidth = 70; ctx.shadowColor = LIME; ctx.shadowBlur = 30;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 35, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    // Text along the bottom of the ring, letters upright towards the centre.
    ctx.save();
    ctx.fillStyle = INK;
    ctx.font = `800 40px ${f.wide}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const chars = [...`${label} · PROTEST WIRE`];
    const r = s / 2 - 35;
    const span = Math.min(Math.PI * 1.3, chars.length * 0.062);
    let a = Math.PI / 2 + span / 2;
    for (const ch of chars) {
      ctx.save();
      ctx.translate(s / 2 + r * Math.cos(a), s / 2 + r * Math.sin(a));
      ctx.rotate(a - Math.PI / 2);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      a -= span / chars.length;
    }
    ctx.restore();
    ctx.save();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(s - 190, s - 190, 120, 0, Math.PI * 2); ctx.fill();
    mark(ctx, s - 190, s - 190, 150);
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = LIME; ctx.shadowColor = LIME; ctx.shadowBlur = 30;
    ctx.fillRect(0, s - 230, s, 230);
    ctx.restore();
    mark(ctx, 130, s - 115, 140, INK);
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    const t = fit(ctx, label, (px) => `800 ${px}px ${f.wide}`, s - 290, 190, 80, 1.0);
    ctx.font = `800 ${t.px}px ${f.wide}`;
    let y = s - 115 - ((t.lines.length - 1) * t.px) / 2 + t.px * 0.35;
    for (const l of t.lines) { ctx.fillText(l, 240, y); y += t.px; }
  }
}

export type SignStyle = "cardboard" | "lime" | "night";

/** 1080×1350 protest sign. */
export function drawSign(canvas: HTMLCanvasElement, text: string, style: SignStyle, footer: string): void {
  const w = 1080, h = 1350;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const f = fonts();
  const bg = style === "cardboard" ? "#C99A5B" : style === "lime" ? LIME : INK;
  const fg = style === "night" ? LIME : INK;
  if (style === "night") stage(ctx, w, h);
  else {
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, w, h);
  }
  // The sign board
  ctx.save();
  ctx.translate(w / 2, h / 2 - 40);
  ctx.rotate(style === "cardboard" ? -0.035 : 0);
  ctx.fillStyle = style === "night" ? "rgba(10,11,10,.85)" : bg;
  ctx.shadowColor = style === "night" ? LIME : "rgba(0,0,0,.6)";
  ctx.shadowBlur = style === "night" ? 50 : 40;
  ctx.fillRect(-440, -470, 880, 900);
  ctx.shadowBlur = 0;
  if (style === "night") { ctx.strokeStyle = LIME; ctx.lineWidth = 10; ctx.strokeRect(-440, -470, 880, 900); }
  if (style === "cardboard") {
    ctx.strokeStyle = "rgba(90,60,20,.35)"; ctx.lineWidth = 3;
    for (let i = -400; i < 420; i += 22) { ctx.beginPath(); ctx.moveTo(i, -470); ctx.lineTo(i, 430); ctx.stroke(); }
  }
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  const t = fit(ctx, text.toUpperCase(), (px) => `800 ${px}px ${f.display}`, 760, 760, 190, 0.98);
  ctx.font = `800 ${t.px}px ${f.display}`;
  let y = -((t.lines.length - 1) * t.px * 0.98) / 2 + t.px * 0.35 - 20;
  for (const l of t.lines) { ctx.fillText(l, 0, y); y += t.px * 0.98; }
  ctx.restore();
  // Stick
  if (style === "cardboard") { ctx.fillStyle = "#8a6a3d"; ctx.fillRect(w / 2 - 22, h / 2 + 400, 44, 300); }
  ctx.fillStyle = LIME;
  ctx.textAlign = "center";
  ctx.font = `800 34px ${f.wide}`;
  ctx.fillText(footer, w / 2, h - 50);
}

/** 1080×1350 poll result card. */
export function drawPulse(canvas: HTMLCanvasElement, question: string, options: string[], counts: number[], footer: string): void {
  const w = 1080, h = 1350;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const f = fonts();
  stage(ctx, w, h);
  ctx.fillStyle = "rgba(10,11,10,.7)";
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = "left";
  ctx.fillStyle = LIME;
  ctx.font = `800 36px ${f.wide}`;
  ctx.fillText("THE PEOPLE'S PULSE", 90, 160);
  ctx.fillStyle = "#fff";
  const q = fit(ctx, question, (px) => `800 ${px}px ${f.display}`, w - 180, 330, 84, 1.05);
  ctx.font = `800 ${q.px}px ${f.display}`;
  let y = 260;
  for (const l of q.lines) { ctx.fillText(l, 90, y); y += q.px * 1.05; }
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  y = Math.max(y + 40, 640);
  options.forEach((o, i) => {
    const pct = Math.round((counts[i] / total) * 100);
    ctx.fillStyle = "rgba(255,255,255,.12)";
    pill(ctx, 90, y, w - 180, 110, 55); ctx.fill();
    ctx.fillStyle = LIME;
    pill(ctx, 90, y, Math.max(110, ((w - 180) * pct) / 100), 110, 55); ctx.fill();
    ctx.fillStyle = pct > 45 ? INK : "#fff";
    ctx.font = `800 40px ${f.display}`;
    ctx.fillText(wrap(ctx, o, w - 420)[0], 130, y + 70);
    ctx.textAlign = "right";
    ctx.fillStyle = "#fff";
    ctx.fillText(`${pct}%`, w - 130, y + 70);
    ctx.textAlign = "left";
    y += 140;
  });
  ctx.fillStyle = LIME;
  ctx.textAlign = "center";
  ctx.font = `800 34px ${f.wide}`;
  ctx.fillText(footer, w / 2, h - 60);
}
