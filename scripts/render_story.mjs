// Render the video brief (web/story.html) to a 1080x1920 MP4 with voiceover, for TikTok, Reels and Shorts.
//
//   python3 -m worldpulse.build --out public
//   pip install -r requirements-video.txt        # for the voiceover (optional: --voice none)
//   node scripts/render_story.mjs --site public --out world-brief.mp4 [--voice af_heart] [--fps 30] [--workers 3]
//
// 1. The page lists what each scene should say; scripts/voiceover.py speaks it and reports durations.
// 2. The page times every scene to its line, so the animation is cut to the voice.
// 3. Frames are rendered from exact timestamps in parallel browser workers, each encoding its own
//    contiguous chunk with x264; the chunks are joined losslessly and the voice lines are mixed in at
//    their cue times, loudness-normalised for social platforms (-14 LUFS).
// Needs ffmpeg on PATH and Playwright's Chromium (npx playwright install chromium).

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { cpus, tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const site = resolve(args.site || "public");
const out = resolve(args.out || "world-brief.mp4");
const fps = Number(args.fps || 30);
const workers = Math.max(1, Number(args.workers || Math.min(4, Math.max(1, cpus().length - 1))));
const voice = args.voice || "af_heart";
const python = args.python || process.env.PYTHON || "python3";
const pageFile = args.page || "story.html"; // e.g. --page promo.html
const speed = args.speed; // voice speed, passed to scripts/voiceover.py
const music = args.music || "none"; // none | promo | brief: synthesized bed from scripts/music.py, cut to the edit

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".xml": "application/xml" };

function serve(root) {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(root, path);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

async function openStory(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, colorScheme: "dark" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__story, null, { timeout: 30000 });
  await page.evaluate(() => window.__story.ready);
  return { page, errors };
}

function ffmpeg(argv, opts = {}) {
  const proc = spawn("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...argv], { stdio: [opts.stdin ? "pipe" : "ignore", "inherit", "inherit"] });
  const done = new Promise((ok, fail) => proc.on("close", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited with ${code}`)))));
  return { proc, done };
}

function makeVoice(script, dir) {
  if (voice === "none") return null;
  const narration = join(dir, "narration.json");
  writeFileSync(narration, JSON.stringify(script));
  const r = spawnSync(python, [join(ROOT, "scripts", "voiceover.py"), "--in", narration, "--out", join(dir, "voice"), "--voice", voice, ...(speed ? ["--speed", String(speed)] : [])], { stdio: "inherit" });
  if (r.status !== 0) {
    console.warn("Voiceover unavailable (install requirements-video.txt); rendering without voice.");
    return null;
  }
  return JSON.parse(readFileSync(join(dir, "voice", "durations.json"), "utf8")).lines;
}

async function renderChunk(browser, url, durations, from, to, file) {
  const { page, errors } = await openStory(browser, url);
  await page.evaluate((d) => window.__story.setTimeline(d), durations);
  const cdp = await page.context().newCDPSession(page);
  const enc = ffmpeg(["-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-maxrate", "9M", "-bufsize", "18M", "-pix_fmt", "yuv420p", "-r", String(fps), file], { stdin: true });
  for (let f = from; f < to; f++) {
    await page.evaluate((t) => window.__story.renderAt(t), f / fps);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92, optimizeForSpeed: true });
    if (!enc.proc.stdin.write(Buffer.from(data, "base64"))) await new Promise((ok) => enc.proc.stdin.once("drain", ok));
  }
  enc.proc.stdin.end();
  await enc.done;
  await page.close();
  if (errors.length) throw new Error(`page errors: ${errors.join("; ")}`);
}

if (!existsSync(join(site, pageFile))) throw new Error(`${site}/${pageFile} not found: build the site first`);
const started = Date.now();
const server = await serve(site);
const url = `http://127.0.0.1:${server.address().port}/${pageFile}#render`;
const tmp = mkdtempSync(join(tmpdir(), "wp-video-"));
const browsers = [];
try {
  const launch = async () => { const b = await chromium.launch(); browsers.push(b); return b; };
  const first = await launch();
  const probe = await openStory(first, url);
  const script = await probe.page.evaluate(() => window.__story.script());
  const hints = await probe.page.evaluate(() => window.__story.music || {});
  await probe.page.close();

  const lines = makeVoice(script, tmp);
  const durations = lines ? Object.fromEntries(lines.map((l) => [l.id, l.seconds])) : null;
  const check = await openStory(first, url);
  const timeline = await check.page.evaluate((d) => window.__story.setTimeline(d), durations);
  await check.page.close();
  const frames = Math.ceil(timeline.total * fps);
  console.log(`Timeline ${timeline.total.toFixed(1)}s, ${frames} frames, ${workers} workers, voice: ${lines ? voice : "none"}`);

  // render contiguous chunks in parallel
  const per = Math.ceil(frames / workers);
  const chunks = [];
  for (let i = 0; i < workers; i++) {
    const from = i * per, to = Math.min(frames, from + per);
    if (from < to) chunks.push({ from, to, file: join(tmp, `chunk-${i}.mp4`) });
  }
  const pool = [first, ...(await Promise.all(chunks.slice(1).map(() => launch())))];
  await Promise.all(chunks.map((c, i) => renderChunk(pool[i], url, durations, c.from, c.to, c.file)));
  const rendered = Date.now();

  // music bed, cut to the scene changes (and any extra cuts the page reports)
  let bed = null;
  if (music !== "none") {
    const cutsAt = [...new Set([...timeline.scenes.slice(1).map((s) => s.start), ...(timeline.cuts || [])].map((c) => c.toFixed(3)))].sort((a, b) => a - b);
    bed = join(tmp, "music.wav");
    const r = spawnSync(python, [join(ROOT, "scripts", "music.py"), "--out", bed, "--total", timeline.total.toFixed(3), "--style", music,
      "--bpm", String(hints.bpm || 132), "--cuts", cutsAt.join(","), ...(hints.endSting ? ["--end-sting"] : [])], { stdio: "inherit" });
    if (r.status !== 0) { console.warn("Music unavailable; rendering without it."); bed = null; }
  }

  // join the chunks, mix the voice lines at their cues, normalise loudness
  writeFileSync(join(tmp, "chunks.txt"), chunks.map((c) => `file '${c.file}'`).join("\n"));
  const inputs = ["-f", "concat", "-safe", "0", "-i", join(tmp, "chunks.txt")];
  let filter = "";
  if (lines && lines.length) {
    const cue = Object.fromEntries(timeline.scenes.map((s) => [s.id, s.voiceAt]));
    lines.forEach((l, i) => {
      inputs.push("-i", l.file);
      const ms = Math.round((cue[l.id] || 0) * 1000);
      filter += `[${i + 1}:a]aresample=48000,adelay=delays=${ms}:all=1,apad=whole_dur=${timeline.total.toFixed(3)}[a${i}];`;
    });
    let mixIn = lines.map((_, i) => `[a${i}]`).join(""), count = lines.length;
    if (bed) {
      inputs.push("-i", bed);
      filter += `[${lines.length + 1}:a]aresample=48000,volume=${music === "promo" ? 0.55 : 0.4}[mus];`;
      mixIn += "[mus]"; count++;
    }
    filter += `${mixIn}amix=inputs=${count}:normalize=0:duration=longest,`
      + `loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,atrim=0:${timeline.total.toFixed(3)}[aout]`;
  } else {
    inputs.push("-f", "lavfi", "-t", timeline.total.toFixed(3), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    filter = "[1:a]anull[aout]";
  }
  await ffmpeg([...inputs, "-filter_complex", filter, "-map", "0:v", "-map", "[aout]", "-c:v", "copy",
    "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-t", timeline.total.toFixed(3), "-movflags", "+faststart", out]).done;
  const secs = (ms) => (ms / 1000).toFixed(0);
  console.log(`Rendered ${frames} frames in ${secs(rendered - started)}s, total ${secs(Date.now() - started)}s → ${out}`);
} finally {
  await Promise.all(browsers.map((b) => b.close()));
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
