// Claude API: captions for protest clips, wire stories from news articles, and translations.
// Every call uses structured JSON output and is counted against a daily budget (AI_DAILY_BUDGET_USD).

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Db } from "./db.ts";
import { env, features } from "./env.ts";
import { addCounter, getCounter } from "./repo.ts";

// List prices per million tokens for the default model (claude-sonnet-5-5). Used for the budget cap.
const PRICE_IN = 2;
const PRICE_OUT = 10;

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropicKey, maxRetries: 2, timeout: 90_000 });
  return client;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function aiSpentToday(db: Db): Promise<number> {
  return getCounter(db, `ai_usd:${today()}`);
}

export async function aiAvailable(db: Db): Promise<boolean> {
  return features.ai && (await aiSpentToday(db)) < env.aiDailyBudgetUsd;
}

export class AiRefusal extends Error {}

/** One structured-output call. Returns the parsed object, or throws. */
async function callJson<T>(db: Db, opts: { system: string; user: string; schema: Record<string, unknown>; validate: z.ZodType<T>; maxTokens: number }): Promise<T> {
  const res = await anthropic().beta.messages.create({
    model: env.aiModel,
    max_tokens: opts.maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    // If a safety classifier declines, the API retries on Anthropic's recommended fallback model.
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: opts.schema } },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  const cost = (res.usage.input_tokens * PRICE_IN + res.usage.output_tokens * PRICE_OUT) / 1_000_000;
  await addCounter(db, `ai_usd:${today()}`, cost);
  if (res.stop_reason === "refusal") throw new AiRefusal("Claude declined this request");
  if (res.stop_reason === "max_tokens") throw new Error("AI output was cut off (max_tokens)");
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return opts.validate.parse(JSON.parse(text));
}

const str = { type: "string" } as const;
const num = { type: "number" } as const;
const bool = { type: "boolean" } as const;
function obj(properties: Record<string, unknown>) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

// ---------------------------------------------------------------- clips

export interface ClipInput { index: number; platform: string; author: string; text: string; hashtags: string[]; postedAt: string }
export interface ClipVerdict {
  index: number; relevant: boolean; firsthand: boolean; caption: string; place: string; country: string; lat: number; lon: number;
}

const CLIP_SYSTEM = `You curate Protest Wire, a feed of protest videos filmed by the people who were there, from every country.
For each social media post you get (platform, author, post text, hashtags), decide:
- relevant: true only if the video very likely shows a real protest, march, rally, strike, blockade or street gathering.
- firsthand: true if it looks filmed by a participant or bystander. False for TV channels, news outlets, studio shows, commentary, edits/compilations, reaction videos, ads, music videos or political party channels.
- caption: one punchy, dramatic, present-tense English line (max 110 characters) that makes people want to watch, e.g. "Students flood the bridge as the city lights up behind them". Use only what the post itself says or shows. Never invent numbers, places, injuries or causes. If the post makes a claim, attribute it ("crowd says...", "poster says..."). No hashtags, no emojis, no taking sides.
- place: the city (or region) in English, empty if unknown. country: ISO 3166-1 alpha-2 code, empty if unknown.
- lat/lon: approximate coordinates of that city, 0 if unknown.
Return one result per post, using the same index.`;

const clipSchema = obj({
  results: { type: "array", items: obj({ index: { type: "integer" }, relevant: bool, firsthand: bool, caption: str, place: str, country: str, lat: num, lon: num }) },
});
const clipValidate = z.object({
  results: z.array(z.object({
    index: z.number().int(), relevant: z.boolean(), firsthand: z.boolean(), caption: z.string(), place: z.string(), country: z.string(), lat: z.number(), lon: z.number(),
  })),
});

export async function classifyClips(db: Db, clips: ClipInput[]): Promise<ClipVerdict[]> {
  if (!clips.length) return [];
  const user = clips
    .map((c) => `#${c.index} [${c.platform}] author: ${c.author || "unknown"} · posted ${c.postedAt}\ntext: ${c.text.slice(0, 600) || "(no text)"}\nhashtags: ${c.hashtags.join(" ") || "-"}`)
    .join("\n\n");
  const out = await callJson(db, { system: CLIP_SYSTEM, user, schema: clipSchema, validate: clipValidate, maxTokens: 4000 + clips.length * 150 });
  return out.results.map((r) => ({ ...r, country: /^[A-Z]{2}$/.test(r.country.toUpperCase()) ? r.country.toUpperCase() : "" }));
}

// ---------------------------------------------------------------- wire stories

export interface ArticleInput { index: number; source: string; title: string; summary: string; publishedAt: string }
export interface RecentInput { id: string; title: string; place: string }
export interface StoryVerdict {
  index: number; action: "new" | "duplicate" | "skip"; duplicateOf: string;
  title: string; body: string; tag: "incident" | "alert" | "turnout" | "results" | "rally" | "official";
  place: string; country: string; lat: number; lon: number;
}

const STORY_SYSTEM = `You write The Wire for Protest Wire: short, fast updates about protests around the world.
For each news article (headline + summary, in any language) decide an action:
- "skip": not about a protest, demonstration, strike, blockade, election dispute or the official response to one.
- "duplicate": the same event as one of the RECENT updates (give its id in duplicate_of) or as an earlier article in this batch (give "article:<index>").
- "new": write a new update.
For "new", write in English, in your own words (never copy sentences):
- title: a dramatic, inspiring, active-voice headline, max 90 characters, e.g. "Tens of thousands pack Slavija as students vow to keep going". It must stay strictly factual.
- body: 1-2 sentences with the key facts and who said what.
Rules: attribute every claim ("police said", "students say", "organisers claim"). Never invent or estimate numbers: use a number only if it appears in the article, attributed to its source. No opinions, no loaded words, do not take sides.
- tag: incident (clashes, arrests, injuries, violence), alert (warnings, calls to gather, road closures), turnout (crowd size, how many cities), results (election or vote results, court rulings, outcomes), rally (marches and gatherings), official (statements or actions by governments, police, institutions).
- place: city in English (or country if no city); country: ISO 3166-1 alpha-2; lat/lon: approximate coordinates of the place (0 if unknown).
For skip/duplicate, return empty strings and zeros for the unused fields.`;

const storySchema = obj({
  results: {
    type: "array",
    items: obj({
      index: { type: "integer" }, action: { type: "string", enum: ["new", "duplicate", "skip"] }, duplicate_of: str,
      title: str, body: str, tag: { type: "string", enum: ["incident", "alert", "turnout", "results", "rally", "official"] },
      place: str, country: str, lat: num, lon: num,
    }),
  },
});
const storyValidate = z.object({
  results: z.array(z.object({
    index: z.number().int(), action: z.enum(["new", "duplicate", "skip"]), duplicate_of: z.string(), title: z.string(), body: z.string(),
    tag: z.enum(["incident", "alert", "turnout", "results", "rally", "official"]), place: z.string(), country: z.string(), lat: z.number(), lon: z.number(),
  })),
});

export async function writeStories(db: Db, articles: ArticleInput[], recent: RecentInput[]): Promise<StoryVerdict[]> {
  if (!articles.length) return [];
  const user = [
    "RECENT updates (last 6 hours):",
    recent.length ? recent.map((r) => `- ${r.id}: ${r.title} (${r.place})`).join("\n") : "- none",
    "",
    "ARTICLES:",
    articles.map((a) => `#${a.index} [${a.source}, ${a.publishedAt}]\n${a.title}\n${a.summary.slice(0, 900)}`).join("\n\n"),
  ].join("\n");
  const out = await callJson(db, { system: STORY_SYSTEM, user, schema: storySchema, validate: storyValidate, maxTokens: 4000 + articles.length * 400 });
  return out.results.map((r) => ({
    index: r.index, action: r.action, duplicateOf: r.duplicate_of, title: r.title, body: r.body, tag: r.tag,
    place: r.place, country: /^[A-Z]{2}$/.test(r.country.toUpperCase()) ? r.country.toUpperCase() : "", lat: r.lat, lon: r.lon,
  }));
}

// ---------------------------------------------------------------- translation

const translateSchema = obj({ translations: { type: "array", items: str } });
const translateValidate = z.object({ translations: z.array(z.string()) });

export async function translateTexts(db: Db, texts: string[], languageName: string): Promise<string[]> {
  if (!texts.length) return [];
  const system = `Translate each string into ${languageName}. Keep the tone (punchy headlines stay punchy), keep names, @handles, #hashtags, numbers and URLs exactly as they are. For Serbian use the Latin script and ekavian. Return exactly one translation per input, in the same order.`;
  const user = JSON.stringify(texts);
  const out = await callJson(db, { system, user, schema: translateSchema, validate: translateValidate, maxTokens: 2000 + texts.join("").length * 3 });
  if (out.translations.length !== texts.length) throw new Error("translation count mismatch");
  return out.translations;
}
