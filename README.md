# World Pulse

**Global deals, crises and the state of the world, published as a free public API and news site.**

World Pulse collects headlines from public news and humanitarian feeds (BBC, Al Jazeera, The Guardian, DW, France 24, NPR, UN News, ReliefWeb, WHO, GDACS and others) every hour. It tags each story by topic and world region with transparent keyword rules, then publishes the result as:

- a fast, dependency-free **news website** with a "State of the World" panel (tension index, mood, regional breakdown, 7-day trend, trending terms);
- a keyless, CORS-enabled **JSON API** (`/api/v1/…`) with an OpenAPI description;
- **RSS feeds**, one for everything plus one per category.

The output is plain static files, so it needs no server and no database, and **hosting costs nothing.**

## Costs: $0

| Piece | Free option |
|---|---|
| Build | Python 3 standard library only, no `pip install` |
| Scheduler | GitHub Actions cron (unlimited minutes on public repos) |
| Hosting + CDN | GitHub Pages. Cloudflare Pages and Netlify also work |
| Data | Public RSS/Atom feeds, no API keys |
| Archive | A rolling 7-day archive is kept by merging the previously published `all.json` on each build, so nothing needs storing |

## Quick start

```bash
python3 -m worldpulse.build --out public      # fetch feeds, build site + API
python3 -m http.server -d public 8000         # open http://localhost:8000
python3 -m unittest discover -s tests         # offline tests
```

## Deploy (GitHub Pages, about 2 minutes)

1. Push this repo to GitHub (public, so Actions minutes are free and unlimited).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Actions → Build & publish → Run workflow** (on `main`). After that it rebuilds every hour.

Your site and API are then live at `https://<user>.github.io/<repo>/`.

> GitHub pauses scheduled workflows in repos with no activity for 60 days. If that happens, re-enable the workflow in the Actions tab, or push any commit.

**Other free hosts:** on Cloudflare Pages or Netlify, set the build command to `python3 -m worldpulse.build --out public --previous https://YOUR-SITE/api/v1/all.json` and the output dir to `public`, then trigger hourly builds with a free cron service calling their deploy hook.

## API

Base path: `/api/v1/`. Full docs are at `/docs.html`, and the spec is at `/api/v1/openapi.json`.

| Endpoint | Description |
|---|---|
| `index.json` | Discovery: endpoints, categories, regions, source health |
| `latest.json` | Latest 300 articles |
| `all.json` | Rolling archive of the last 7 days |
| `state.json` | Tension index, mood, category and region breakdown, 7-day history, trending terms, top crises and deals |
| `categories/{id}.json` / `.xml` | `deals` `crises` `conflict` `disasters` `humanitarian` `economy` `diplomacy` `climate` `health` `tech` |
| `regions/{id}.json` | `africa` `asia` `europe` `middle-east` `americas` `oceania` |
| `sources.json` | Every feed with its status from the last build |

```bash
curl -s https://YOUR-SITE/api/v1/state.json | jq '.data | {mood, tension_index}'
curl -s https://YOUR-SITE/api/v1/categories/deals.json | jq '.data[0:3][] | .title'
```

Each article contains `id`, `title`, `url`, `summary`, `image`, `source{id,name}`, `published_at`, `fetched_at`, `categories[]`, `regions[]` and `tone` (`deal` | `crisis` | `mixed` | `neutral`).

**Tension index** is the share of crisis stories among crisis plus deal stories over the last 24 hours (0 means all dealmaking, 100 means all crisis). It measures *news coverage*, not ground truth. News skews toward crises, so readings above 70 are normal.

## Customize

- **Sources:** `config/sources.json`. Add any RSS/Atom feed. A feed that fails is logged in `sources.json` and the build carries on.
- **Topics and regions:** `worldpulse/classify.py`. These are plain keyword lists; a trailing `*` marks a stem, and capitalized words such as `WHO` or `AI` match case-sensitively. Off-topic stories (sport, celebrity) are filtered out via `EXCLUDE`.
- **Branding and revenue:** `config/site.json`.

## Making money from it

All revenue hooks are built in and switched off until you fill in `config/site.json`. **Nothing here guarantees income.** Revenue depends on traffic, and traffic depends on promotion. These are the options, cheapest to set up first:

| Stream | How | Setup |
|---|---|---|
| **Sponsor slot** | `revenue.sponsor` shows a "Presented by …" line on the site **and in the `meta` of every API response**, so every developer using the API sees it. Sell it weekly or monthly. | Fill in `text` + `url` |
| **Privacy-friendly ads** | Set `revenue.ethicalads_publisher` after you're approved at [EthicalAds](https://www.ethicalads.io/publishers/). They pay per view, use no tracking cookies, and suit developer audiences. | Apply, paste ID |
| **Donations** | `revenue.donate`: GitHub Sponsors, Ko-fi, Open Collective links appear in a "Keep this free" card. Uncomment `.github/FUNDING.yml` too. | Paste links |
| **Newsletter** | Point `revenue.newsletter_url` at a free Buttondown or Substack. Feed a daily digest from `state.json` (`top_crises`, `top_deals`, `mood`), then sell sponsorships or a paid tier. | Free tier |
| **API marketplace** | Import `openapi.json` into RapidAPI and sell higher-SLA or historical access. The free static API stays free. | Listing |
| **Paid archive** | The free API keeps 7 days. Long-term history (monthly snapshots of `all.json`) is a natural paid product for researchers and analysts. | Small addition |

To get traffic, submit `feed.xml` to feed readers, post the API on public-API lists (e.g. *public-apis* on GitHub), share the daily "State of the World" on social media, and enable the sitemap by setting `base_url`.

## Content and fair use

Only headlines, excerpts of up to 320 characters, thumbnails supplied by the feed, and links are republished, and every item links to and credits its publisher. That is how feed readers work. Some publishers' terms restrict commercial reuse of their feeds, though, so **check the terms of each source before you monetize**, and remove any you're unsure about from `config/sources.json`. Code is MIT-licensed. The articles belong to their publishers.

## Project layout

```
config/       sources.json (feeds), site.json (branding, revenue)
worldpulse/   feeds.py (fetch + parse RSS/RDF/Atom), classify.py (topics/regions), build.py (API + site)
web/          index.html, docs.html, app.js, styles.css (copied into the build)
tests/        offline unit + end-to-end build tests
.github/      hourly build-and-deploy workflow
```
