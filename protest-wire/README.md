# Protest Wire

**The world is rising. Watch it, join it, share it.**

Protest Wire is a mobile-first web app that brings protesters together across the world. It shows raw videos filmed by people in the streets (not TV channels), lets anyone count themselves in with one tap, and gives people shareable cards, flags and signs to spread the movement on TikTok, Instagram and everywhere else. It runs in 41 languages, including every national language in Europe, Serbian Latin and Serbian Cyrillic, and English.

## What's inside

| Feature | What it does |
|---|---|
| **From the streets** | A TikTok-style vertical feed of protest videos from TikTok, Instagram, X, YouTube, Bluesky and Mastodon. Every video is an **official embed**: nothing is downloaded or re-hosted. Claude filters out news outlets, TV studios and commentary, and writes a short, punchy, factual caption. |
| **Live from the streets** | Citizen live streams through the official YouTube IFrame Player API, with a strip of other live channels you can switch to. News outlets are excluded. |
| **I'm in** | One tap counts you in, anonymously. You get your number ("You're #4,812") and a 9:16 **Story card** to post on Instagram or TikTok, with your **invite link**. |
| **City race** | Each invite counts for the city it came from: Belgrade vs Tbilisi vs Lima. |
| **The world is rising (map)** | A live map of cities in the movement. **Solidarity lines** connect each inviter's city to the new person's city. No tile server, so nobody else sees who looks at the map. |
| **The Global Minute** | Every day at the same moment (18:00 UTC by default), everyone stands up for one minute and taps "I'm standing". There's a countdown, a live count and a share card. |
| **Raise your flag** | A profile-picture frame with the movement's mark. Your photo is edited on your phone and never uploaded. |
| **Make a sign** | Type a slogan and get a protest-sign image ready to post. |
| **The People's Pulse** | One question a day for the whole movement, with a shareable result card. |
| **Make it trend** | The hashtag hub: one tap to copy #ProtestWire, with links to the tag on TikTok, Instagram, X, YouTube and Bluesky. |
| **Drop your clip** | Protesters paste a link to their own post. On Android, once the app is installed, **Share → Protest Wire** works straight from TikTok or Instagram. A moderator approves each clip. |
| **The Wire** | Short, sourced updates about protests (Danas, N1, Nova, Nedeljnik, Insajder, Al Jazeera, Reuters, BBC World, plus GDELT worldwide). Claude rewrites them in its own words with dramatic but strictly factual headlines, attributes every claim and merges duplicates. Any number that isn't in the source holds the update for a moderator. |
| **Admin** (`/admin`) | Approve or reject clips, pin a live stream, edit or hide updates, and set the headline, announcement bar, Global Minute time, hashtags and polls. |

Media-proofing: approved posts are sent to the Internet Archive's Wayback Machine. If a platform deletes a post, the card shows an "Archived copy" link, and every card always keeps the original author, time and platform link.

## The keys you need

Put them in `.env.local` for local runs and in Vercel → Project → Settings → Environment Variables for the live site. `.env.example` lists them all with explanations.

| Key | Needed? | What for | Where to get it |
|---|---|---|---|
| `DATABASE_URL` | **Yes, live** (not locally) | Stores clips, counts, updates | Neon or Supabase (free tiers), see step 3 |
| `ADMIN_PASSWORD` | **Yes, live** | Logs you into `/admin` | Make up a long random password |
| `CRON_SECRET` | **Yes, live** | Protects the pipeline URL | Make up a long random string |
| `ANTHROPIC_API_KEY` | Strongly recommended | Captions, filtering out news channels, The Wire, translations | console.anthropic.com → API Keys |
| `YOUTUBE_API_KEY` | Recommended | Citizen live streams and Shorts | Google Cloud Console, see step 2 |
| `NEXT_PUBLIC_SITE_URL` | Recommended | Correct links in share previews | Your Vercel address, e.g. `https://protestwire.vercel.app` |
| `NEXT_PUBLIC_HASHTAG` | Optional | Your movement's hashtag (default `ProtestWire`) | Your choice |
| `AI_DAILY_BUDGET_USD` | Optional | Daily spending cap for Claude (default `2`) | Your choice |
| `AUTO_APPROVE_SUBMISSIONS` | Optional | `manual` (default) or `ai` | See "Moderation" |
| `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID` | Optional, advanced | Finds Instagram Reels by hashtag | Meta for Developers, see "Instagram" |
| `META_OEMBED_TOKEN` | Optional | Previews for submitted Instagram links | Meta app: `APP_ID|APP_SECRET` |

Bluesky, Mastodon, the news feeds, GDELT, TikTok previews and the map need **no keys**.

## Step 1: Run it on your computer (10 minutes)

You need [Node.js](https://nodejs.org) **22.18 or newer** (choose the "LTS" download) and [Git](https://git-scm.com).

```bash
git clone https://github.com/ilicvix02/claude.git
cd claude/protest-wire
npm install
cp .env.example .env.local      # on Windows: copy .env.example .env.local
npm run dev
```

Open http://localhost:3000. It works straight away with a built-in database (PGlite, stored in the `.data/` folder).

To fill it with real content, open a second terminal in the same folder and run:

```bash
npm run cron
```

This fetches protest videos from Bluesky and Mastodon and news from the outlets. Run it again any time. Without an Anthropic key, posts are filtered by keywords only, so you'll see some off-topic or news-channel clips. With the key, Claude filters them out.

To try the admin page locally, set `ADMIN_PASSWORD=something` in `.env.local`, restart `npm run dev` and open http://localhost:3000/admin.

## Step 2: Get the API keys

**Anthropic (Claude).** Sign in at https://console.anthropic.com, open **API Keys → Create key**, and copy it into `ANTHROPIC_API_KEY`. Add a little credit under **Billing**. For an absolute spending ceiling, leave auto-reload off. The app also stops by itself at `AI_DAILY_BUDGET_USD` per day.

**YouTube Data API.**
1. Go to https://console.cloud.google.com and create a project (any name).
2. Open **APIs & Services → Library**, search for **YouTube Data API v3** and click **Enable**.
3. Open **APIs & Services → Credentials → Create credentials → API key**, and copy it into `YOUTUBE_API_KEY`.
4. Recommended: click the key, choose **Restrict key → YouTube Data API v3**, and save.

The free quota is 10,000 units a day. Each search costs 100, so the app runs one search every 15 minutes (rotating live streams, Shorts and recent uploads) and checks stream status cheaply in between. It stops at 90% of the quota. If you need more, Google grants quota increases for free through a form in the console.

## Step 3: Create the database

Use either one.

**Neon (simplest).** Sign up at https://neon.tech → **Create project** → copy the **pooled** connection string (it contains `-pooler`) into `DATABASE_URL`.

**Supabase.** Sign up at https://supabase.com → **New project** → **Connect** → **Transaction pooler** → copy the URI (port `6543`) and put your database password into it. Paste it into `DATABASE_URL`.

The tables are created automatically on first use. To create them right away, run `npm run db:setup` with `DATABASE_URL` set in `.env.local`.

## Step 4: Put it online with Vercel (15 minutes)

1. Sign up at https://vercel.com with your GitHub account.
2. **Add New → Project** → import the `claude` repository.
3. **Root Directory: `protest-wire`** (important: click **Edit** and choose the folder). The framework is detected as Next.js.
4. Open **Environment Variables** and add `DATABASE_URL`, `ADMIN_PASSWORD`, `CRON_SECRET`, `ANTHROPIC_API_KEY`, `YOUTUBE_API_KEY` and `NEXT_PUBLIC_SITE_URL` (you can fill in the last one after the first deploy, then redeploy).
5. Click **Deploy**. Your site is live at `https://<name>.vercel.app`.

## Step 5: Run the pipeline every 3–5 minutes

The pipeline lives at `https://<your-site>/api/cron` and needs your `CRON_SECRET`.

Vercel's free **Hobby** plan only allows cron jobs **once a day**, and a more frequent schedule makes the deploy fail. So `vercel.json` contains a safe daily run, and you pick one of these for the real schedule:

- **Free, recommended: cron-job.org.** Create a free account at https://cron-job.org → **Create cronjob**.
  - URL: `https://<your-site>/api/cron`
  - Schedule: every 3 or 5 minutes
  - Under **Advanced → Headers**, add `Authorization` with the value `Bearer <your CRON_SECRET>`. Alternatively, use the URL `https://<your-site>/api/cron?key=<your CRON_SECRET>`.
  - Request timeout: 120 seconds.
- **Vercel Pro ($20/month):** change the schedule in `vercel.json` to `"*/5 * * * *"` and redeploy. Vercel sends the secret automatically.
- **GitHub Actions (free):** copy `deploy/github-cron.yml` to `.github/workflows/` and add the `PROTEST_WIRE_URL` and `CRON_SECRET` repository secrets. GitHub's timing is less punctual.

You can also press **Run pipeline now** in `/admin` at any time.

## Step 6: Make it yours

Open `/admin` and log in with `ADMIN_PASSWORD`.

- **Site & Pulse** tab: the hero headline (wrap words in `*asterisks*` to make them lime), the lede, the live pill text, the lime announcement bar (the single most important update), the daily Global Minute time (UTC), extra hashtags, and today's People's Pulse question. Write in English; every other language is translated automatically.
- **Clips** tab: approve or reject community clips, fix captions and places, pin a clip to the top, or add one yourself.
- **Live** tab: pin a YouTube live stream from someone on the ground.
- **Wire** tab: edit or hide updates. Updates held because of an unverified number appear first.

## How the videos get in (and the honest limits)

| Platform | How | Notes |
|---|---|---|
| Bluesky | Automatic: public hashtag search (#ProtestWire, #protest, #protesti, #GenZProtest…) | No key needed |
| Mastodon | Automatic: hashtag timelines on mastodon.social | No key needed |
| YouTube | Automatic: Shorts, recent uploads and live streams, excluding news outlets | Needs `YOUTUBE_API_KEY` |
| TikTok | **Community submissions** (paste a link or use Share → Protest Wire) | TikTok has no public search API for apps like this; its Research API is limited to academics. Previews use TikTok's official oEmbed. |
| Instagram | **Community submissions**; optional automatic hashtag search | Automatic search needs Meta's Graph API with "Instagram Public Content Access" (app review) and allows 30 hashtags a week |
| X | **Community submissions** | X's API is paid; embeds use the official widget |

The **hashtag** is the bridge: ask people to post with `#ProtestWire` (or your own tag in `NEXT_PUBLIC_HASHTAG`). On Bluesky, Mastodon and YouTube those posts are picked up automatically. On TikTok and Instagram, people tap Share → Protest Wire.

News outlets are excluded from the video feed by a built-in list (N1, Nova S, Insajder, Vreme, RTS, Danas, Al Jazeera, Reuters), a name check (news, TV, radio, media…) and Claude's "first-hand footage" check. Add more channel IDs with `BLOCKED_YOUTUBE_CHANNELS`.

### Instagram hashtag search (optional, advanced)

1. Convert your Instagram account to **Business** or **Creator** and link it to a Facebook Page.
2. At https://developers.facebook.com create an app (type **Business**), add **Instagram Graph API**, and request the **Instagram Public Content Access** feature (this requires app review).
3. Generate a long-lived user access token with `instagram_basic` and `pages_show_list`, and find your Instagram Business account ID (`GET /me/accounts`, then `?fields=instagram_business_account`).
4. Set `INSTAGRAM_ACCESS_TOKEN` and `INSTAGRAM_USER_ID`. The pipeline then searches #ProtestWire and #protest a few times a day.

## Moderation and safety

- **Community clips wait for a moderator** by default. Set `AUTO_APPROVE_SUBMISSIONS=ai` to let clips that Claude judges to be first-hand protest footage go live immediately.
- Three reports from different people pull a clip until a moderator decides.
- Community clips are labelled "Community clip · not independently verified".
- **No accounts, no names, no tracking.** "I'm in" stores only a city and a salted one-way hash of a random device ID. IP addresses are only used, as daily-rotating hashes, to rate-limit. Geolocation is turned into the nearest city on the phone and never sent anywhere.
- The submit form reminds people not to show the faces of those who didn't agree to be filmed.
- Headlines are written to be dramatic and inspiring, but Claude may only use facts and numbers from the source and must attribute claims.

## What it costs

| Piece | Cost |
|---|---|
| Vercel Hobby | $0 |
| Neon / Supabase free tier | $0 |
| cron-job.org | $0 |
| YouTube Data API | $0 (within the free quota) |
| Claude (`claude-sonnet-5-5`) | Roughly $0.30–$2 a day depending on news volume and languages used; capped by `AI_DAILY_BUDGET_USD` |

The app calls Claude with the server-side **fallback** option (`fallbacks: "default"`). If Claude's safety system declines a request in certain categories, Anthropic retries it on a recommended fallback model instead of failing.

## Languages

There are 41 interface languages: English, Serbian (Latin), Serbian (Cyrillic), Albanian, Armenian, Azerbaijani, Belarusian, Bosnian, Bulgarian, Catalan, Croatian, Czech, Danish, Dutch, Estonian, Finnish, French, Georgian, German, Greek, Hungarian, Icelandic, Irish, Italian, Latvian, Lithuanian, Luxembourgish, Macedonian, Maltese, Montenegrin, Norwegian, Polish, Portuguese, Romanian, Russian, Slovak, Slovenian, Spanish, Swedish, Turkish and Ukrainian.

- Interface text lives in `lib/i18n.ts` (English) and `locales/<code>.json`. The translations were written by AI, so **ask native speakers to review them** before a big launch. `npm test` checks that every file has every key.
- Serbian Cyrillic is generated from Serbian Latin with `toCyrillic()` in `lib/translit.ts`. It handles lj, nj and dž, and leaves words containing w, q, x or y (and links, @handles and #hashtags) unchanged.
- Content (captions, updates, polls, admin text) is written once in English. It's translated by Claude the first time someone reads it in a language, then cached, so each text is paid for only once per language. New content is pre-translated into Serbian.
- The chosen language is remembered in `localStorage` (and in a cookie, so the page loads in that language with no flash). The first visit uses the browser's language.

## Development

```bash
npm run dev         # local site on http://localhost:3000
npm run cron        # run the pipeline once
npm test            # unit + integration tests (in-memory Postgres; AI tested against a local mock, no cost)
npm run typecheck
npm run build
```

Project layout:

```
app/            pages (/, /c/[id] shared clip, /drop share target, /admin) and API routes
components/     the UI (Hero, Clips feed, Join flow, Map, Spread tools, Wire, Admin)
lib/            database, pipeline, AI, sources (YouTube, Bluesky, Mastodon, Instagram, RSS, GDELT, oEmbed), i18n
locales/        interface translations
public/         icons, manifest (with share target), land outlines for the map
tests/          node:test suites
```

Choices worth knowing:

- **Polling every 30 seconds** instead of server-sent events, because it works reliably on serverless hosting and is cached at the edge.
- **One database code path.** Real Postgres (`postgres` driver) in production and PGlite (Postgres compiled to WebAssembly) locally and in tests.
- **The map draws its own outlines** (Natural Earth, public domain) instead of loading third-party tiles. That avoids API keys and avoids leaking viewers' IP addresses to a tile provider.
- **The "Rise" mark** (three chevrons in a hexagon) is original artwork, free for anyone to reuse on flags, signs and profile pictures.
