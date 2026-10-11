// Render the video brief (web/story.html) to a 1080x1920 MP4 for TikTok, Reels and Shorts.
//
//   python3 -m worldpulse.build --out public
//   node scripts/render_story.mjs --site public --out world-brief.mp4
//
// Each slide is captured as a lossless frame and joined with short crossfades by ffmpeg, so text
// stays sharp. Needs ffmpeg on PATH and Playwright's Chromium (npx playwright install chromium).

import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const site = resolve(args.site || "public");
const out = resolve(args.out || "world-brief.mp4");
const FADE = 0.35; // seconds of crossfade between slides
const END_HOLD = 1.5; // extra seconds on the end card

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".xml": "application/xml" };

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

if (!existsSync(join(site, "story.html"))) throw new Error(`${site}/story.html not found: build the site first`);
const server = await serve(site);
const frames = mkdtempSync(join(tmpdir(), "wp-story-"));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, colorScheme: "dark" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/story.html`);
  await page.waitForFunction(() => window.__story && window.__story.count > 0, null, { timeout: 20000 });
  const count = await page.evaluate(() => window.__story.count);
  const durations = [];
  for (let i = 0; i < count; i++) {
    await page.evaluate((n) => window.__story.show(n), i);
    await page.waitForTimeout(700); // let the slide's entrance transition finish
    await page.screenshot({ path: join(frames, `slide-${String(i).padStart(2, "0")}.png`) });
    durations.push((await page.evaluate((n) => window.__story.ms(n), i)) / 1000);
  }
  if (errors.length) throw new Error(`page errors: ${errors.join("; ")}`);
  durations[count - 1] += END_HOLD;

  // ffmpeg: one looping input per slide, chained crossfades, silent audio track for platform compatibility.
  const inputs = [];
  durations.forEach((d, i) => inputs.push("-loop", "1", "-t", (d + FADE).toFixed(3), "-i", join(frames, `slide-${String(i).padStart(2, "0")}.png`)));
  let filter = "", last = "[0:v]", offset = 0;
  for (let i = 1; i < count; i++) {
    offset += durations[i - 1];
    const label = `[v${i}]`;
    filter += `${last}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}${label};`;
    last = label;
  }
  const total = durations.reduce((a, b) => a + b, 0);
  filter += `${last}fps=30,format=yuv420p[out]`;
  const ffmpeg = spawnSync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    ...inputs,
    "-f", "lavfi", "-t", total.toFixed(3), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", filter, "-map", "[out]", "-map", `${count}:a`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "96k",
    "-t", total.toFixed(3), "-movflags", "+faststart", out,
  ], { stdio: "inherit" });
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed with status ${ffmpeg.status}`);
  console.log(`Rendered ${count} slides, ${total.toFixed(1)}s → ${out}`);
} finally {
  await browser.close();
  server.close();
  rmSync(frames, { recursive: true, force: true });
}
