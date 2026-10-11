# World Pulse

**An open-source, mobile-first app and free public API for the world's conflicts, crises and major deals, with AI analysis on top.**

Every hour World Pulse reads 26 public news and humanitarian feeds: BBC regional desks, Al Jazeera, The Guardian, DW, France 24, NPR, Kyiv Independent, Middle East Eye, AllAfrica, The New Humanitarian, International Crisis Group, UN News, ReliefWeb, WHO, GDACS and others. From them it publishes:

- **AI world brief.** Claude writes a short "state of the world" with every point linked to its sources, plus what to watch next.
- **Conflict tracker.** 19 conflict theaters (Russia–Ukraine, Israel–Palestine, Sudan, Myanmar, Sahel, DR Congo, Yemen & Red Sea, Taiwan Strait and others), each with an intensity score, status (critical/high/elevated/watch), trend, 7-day history, signal breakdown, an AI situation summary and a timeline. All of it is shown on a live map.
- **Smart feed.** Stories from different outlets about the same event are grouped together ("covered by 7 outlets"). Each story is tagged by topic, region, conflict theater, severity and signal, and conflict stories get an AI one-line "why it matters".
- **The app.** Built for phones first and installable as a PWA on iOS, Android and desktop. It works offline, and stories can be bookmarked and shared. It's also packaged as a native **Android** app (APK built on free GitHub runners), with an **iOS** project via Capacitor.
- **Public API.** Keyless, CORS-enabled JSON plus RSS, with an OpenAPI spec. It serves the same data the app uses.

Everything is static files, so it needs no server, no database and no paid hosting.

## What it costs

| Piece | Cost |
|---|---|
| Hosting, CDN, HTTPS | **$0**: GitHub Pages (Cloudflare Pages or Netlify also work) |
| Hourly builds | **$0**: GitHub Actions (unlimited minutes for public repos) |
| News data | **$0**: public RSS/Atom feeds, no API keys |
| Web app on iOS, Android, desktop | **$0**: installable PWA, no app store needed |
| Android APK | **$0**: built by the `Android app` workflow; sideload it or attach it to GitHub Releases |
| Store listings (optional) | Google Play one-time $25 developer fee; Apple App Store $99/year and a Mac to build |
| **AI analysis (optional)** | **Pay-per-use Anthropic API**: see below. With no key, the app uses rule-based analysis and costs nothing |

### AI cost, and how it's kept bounded

AI runs **once per hourly build, in CI. It never runs per reader**, so the cost is the same whether you have 10 readers or 10 million. Each build:

1. Sends only *new*, conflict-related stories (40 at most) to Claude for tagging. Stories it has already analysed keep their results across builds.
2. Writes the world brief and the conflict summaries at most every `brief_every_hours` (default 3). In between, the previous brief is reused.
3. Logs the tokens used in every run (`AI usage: …` in the build log), so you can measure your real spend.

These are rough monthly estimates, assuming about 15–40 new conflict stories an hour and a brief every 3 hours. They come from list prices, not from measured runs, so check them against your own build logs:

| `ai.model` in `config/site.json` | Approx. per month |
|---|---|
| `claude-opus-5-5` (highest quality) | ~$40–90 |
| `claude-sonnet-5-5` | ~$20–45 |
| `claude-haiku-5-5` (configured) | ~$1–3 |

Changing the model is a one-line edit. Raising `brief_every_hours` or lowering `max_articles_per_run` cuts the cost further.

## Quick start

```bash
python3 -m worldpulse.build --out public          # fetch feeds, build app + API (Python 3.10+, stdlib only)
python3 -m http.server -d public 8000             # open http://localhost:8000
python3 -m unittest discover -s tests             # offline tests
```

To enable AI locally: `pip install -r requirements-ai.txt`, copy `.env.example` to `.env` and put your key there. `.env` is git-ignored, so it never reaches GitHub; for the hourly build on GitHub, store the key as the `ANTHROPIC_API_KEY` repository secret.

## Deploy

**Web app + API (GitHub Pages, about 2 minutes)**

1. Push this repo to GitHub as a public repo.
2. **Settings → Pages → Source: GitHub Actions.**
3. **Actions → Build & publish → Run workflow.** It then rebuilds every hour at `https://<user>.github.io/<repo>/`.
4. *(Optional, for AI)* **Settings → Secrets and variables → Actions → New repository secret:** `ANTHROPIC_API_KEY`.

> GitHub pauses scheduled workflows in repos with 60 days of no activity. If that happens, re-enable the workflow in the Actions tab.

**Android app**

**Actions → Android app → Run workflow** builds `app-debug.apk`, which you can download from the run's artifacts. Pushing a `v*` tag attaches the APK to a GitHub Release. The app loads live data from your Pages site and ships a bundled copy so the first launch also works offline. To publish on Google Play, add the four `ANDROID_*` keystore secrets listed in `.github/workflows/android.yml`, and the workflow will also produce a signed `.aab`.

To build locally you need Node 22, JDK 21 and the Android SDK:

```bash
WORLDPULSE_APP_API_BASE=https://<user>.github.io/<repo>/api/v1/ python3 -m worldpulse.build --out public
npm ci && npm run cap:android && (cd android && ./gradlew assembleDebug)
```

**iOS app**

On a Mac with Xcode, run `npm ci && npm run cap:ios && npx cap open ios`. Distributing through the App Store requires the Apple Developer Program. Without it, iPhone users can install the PWA for free: open the site in Safari, then **Share → Add to Home Screen**.

## API

The base path is `/api/v1/`. Full docs are at `/docs.html`; the spec is at `/api/v1/openapi.json`.

| Endpoint | Description |
|---|---|
| `brief.json` | World brief: headline, cited bullets, what to watch. `source` is `ai` or `rules` |
| `conflicts.json` | All theaters: intensity, status, trend, history, signals, situation analysis, latest stories |
| `conflicts/{id}.json` | One theater with all its stories from the last 7 days |
| `conflicts.xml` | RSS of conflict reports |
| `latest.json` / `all.json` | Latest 300 stories / rolling 7-day archive |
| `state.json` | Tension index, mood, regions, trending terms, conflict overview |
| `categories/{id}.json` / `.xml`, `regions/{id}.json` | Filtered views |
| `index.json`, `sources.json` | Discovery, AI status, feed health |

```bash
curl -s https://YOUR-SITE/api/v1/conflicts.json | jq '.data.theaters[] | {name, status, trend, intensity}'
```

**Intensity and trend measure news coverage, not verified events or casualties.**

## How the analysis works

1. **Rules first.** Keyword rules tag topics and regions (`worldpulse/classify.py`) and conflict theaters (`config/conflicts.json`), and score severity and signal from word lists (`worldpulse/conflicts.py`). Coverage of the same event is grouped by headline similarity (`worldpulse/cluster.py`).
2. **AI on top** (`worldpulse/ai.py`). Claude re-judges new conflict stories (theaters, severity 0–5, signal, a one-line insight), then writes the brief and situation summaries from the top stories. Requests use structured outputs (a JSON schema) and the server-side refusal fallback. Every field is validated before use: unknown ids are dropped, enums are checked and lengths are clamped. Feed text is passed as data that the model is told never to treat as instructions.
3. **Honest labelling.** AI output is badged "AI · Claude" wherever it appears, carries a "can make mistakes" note, and always links to the original reports. If the AI layer fails, the build keeps going with rules (or with the previous AI brief, if it's under 12 hours old).

## Customise

- **Sources:** `config/sources.json`. A failing feed is logged in `sources.json` and the build carries on.
- **Conflict theaters:** `config/conflicts.json`. Each has names, optional `pairs` (both words must appear), map coordinates and a neutral description.
- **AI:** the `ai` block in `config/site.json` sets the model, effort, how many stories per run, and how often the brief is rewritten.
- **Branding and revenue:** `config/site.json`. App id and name live in `capacitor.config.json`. Icons are generated from `assets/logo.png`.
- **Map:** `web/land.js` is generated from Natural Earth (public domain) by `scripts/make_map.py`.

## Making money from it

The revenue hooks are built in and stay off until you fill in `config/site.json`. **Nothing here guarantees income.** It depends on traffic, and traffic depends on promotion.

| Stream | How |
|---|---|
| **Sponsor slot** | `revenue.sponsor` shows "Presented by …" in the app **and in the `meta` of every API response**. Sell it weekly or monthly |
| **Privacy-friendly ads** | `revenue.ethicalads_publisher` once you're approved at [EthicalAds](https://www.ethicalads.io/publishers/). No tracking cookies |
| **Donations** | `revenue.donate` links (GitHub Sponsors, Ko-fi, Open Collective) appear in the app's "Keep it free" card. Uncomment `.github/FUNDING.yml` too |
| **Newsletter** | Point `revenue.newsletter_url` at Buttondown or Substack and send the daily `brief.json` as a digest. Sell sponsorships or a paid tier |
| **API plans** | List `openapi.json` on RapidAPI for higher-SLA or historical access. The static API stays free |
| **Paid archive / alerts** | Long-term history of `conflicts.json` and escalation alerts are natural paid products for analysts, NGOs and newsrooms |

For traffic: submit `feed.xml` and `conflicts.xml` to feed readers, list the API in public-API directories, share the daily brief on social media, and set `base_url` to enable the sitemap.

## Content and fair use

Only headlines, short excerpts, feed-supplied thumbnails and links are republished, and every item credits and links to its publisher. Some publishers' terms restrict commercial reuse of their feeds, so **check each source's terms before you monetise**, and remove any source you're unsure of. The code is MIT-licensed. The articles belong to their publishers.

## Project layout

```
config/       sources.json, conflicts.json (theaters), site.json (branding, AI, revenue)
worldpulse/   feeds.py · classify.py · conflicts.py · cluster.py · briefing.py · ai.py · build.py
web/          the app: index.html, app.js, styles.css, sw.js (offline), manifest, icons, land.js (map)
assets/       logo used to generate native icons and splash screens
scripts/      make_map.py (map data generator)
tests/        offline unit + end-to-end tests (AI tested with a fake client)
.github/      hourly build-and-deploy workflow, Android APK workflow
package.json, capacitor.config.json   native wrapper (Capacitor 8)
```
