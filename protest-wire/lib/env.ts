// All configuration comes from environment variables (.env.local locally, Project Settings on Vercel).

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== "" && process.env[name] !== undefined ? v : fallback;
}

function list(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export const env = {
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  get anthropicKey() { return process.env.ANTHROPIC_API_KEY ?? ""; },
  get youtubeKey() { return process.env.YOUTUBE_API_KEY ?? ""; },
  get instagramToken() { return process.env.INSTAGRAM_ACCESS_TOKEN ?? ""; },
  get instagramUserId() { return process.env.INSTAGRAM_USER_ID ?? ""; },
  get cronSecret() { return process.env.CRON_SECRET ?? ""; },
  get adminPassword() { return process.env.ADMIN_PASSWORD ?? ""; },
  get siteUrl() { return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, ""); },

  get aiModel() { return process.env.AI_MODEL || "claude-sonnet-5-5"; },
  get aiDailyBudgetUsd() { return num("AI_DAILY_BUDGET_USD", 2); },
  get aiMaxArticlesPerRun() { return num("AI_MAX_ARTICLES_PER_RUN", 10); },
  get aiMaxClipsPerRun() { return num("AI_MAX_CLIPS_PER_RUN", 30); },

  get youtubeDailyQuota() { return num("YOUTUBE_DAILY_QUOTA", 10000); },
  get youtubeSearchEveryMin() { return num("YOUTUBE_SEARCH_EVERY_MIN", 15); },

  /** "manual" (default): community clips wait for a moderator. "ai": clips the AI judges first-hand protest footage go live at once. */
  get autoApproveSubmissions() { return (process.env.AUTO_APPROVE_SUBMISSIONS ?? "manual").toLowerCase(); },
  /** Extra YouTube channel IDs to treat as media outlets (excluded from the protester feed). */
  get blockedChannels() { return list("BLOCKED_YOUTUBE_CHANNELS"); },
  /** Our own hashtag; posts on Bluesky/Mastodon/YouTube that carry it are picked up automatically. */
  get hashtag() { return (process.env.NEXT_PUBLIC_HASHTAG || "ProtestWire").replace(/^#/, ""); },
};

export const features = {
  get db() { return env.databaseUrl ? "postgres" : "pglite"; },
  get ai() { return Boolean(env.anthropicKey); },
  get youtube() { return Boolean(env.youtubeKey); },
  get instagram() { return Boolean(env.instagramToken && env.instagramUserId); },
};
