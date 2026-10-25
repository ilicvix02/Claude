// Runs the AI path of the pipeline against a local fake of the Messages API (no network, no cost).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const requests: Array<{ headers: Record<string, string | string[] | undefined>; body: any }> = [];

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw);
    requests.push({ headers: req.headers, body });
    const system: string = typeof body.system === "string" ? body.system : "";
    const user: string = body.messages[0].content;
    let out: unknown;
    if (system.startsWith("You curate Protest Wire")) {
      out = { results: user.split("\n\n").map((block, i) => {
        const ok = block.includes("Novom Sadu");
        return {
          index: i, relevant: ok, firsthand: ok, caption: ok ? "Students light up the bridge as the crowd sings" : "TV debate",
          place: ok ? "Novi Sad" : "", country: ok ? "rs" : "", lat: 45.25, lon: 19.84,
        };
      }) };
    } else if (system.startsWith("You write The Wire")) {
      out = { results: [
        { index: 0, action: "new", duplicate_of: "", title: "Students hold the bridge in Novi Sad", body: "Organisers say the blockade continues.", tag: "rally", place: "Novi Sad", country: "RS", lat: 45.25, lon: 19.84 },
        { index: 1, action: "duplicate", duplicate_of: "article:0", title: "", body: "", tag: "rally", place: "", country: "", lat: 0, lon: 0 },
        { index: 2, action: "new", duplicate_of: "", title: "50,000 march in Lima", body: "Police said the march was peaceful.", tag: "turnout", place: "Lima", country: "PE", lat: -12.05, lon: -77.04 },
        { index: 3, action: "skip", duplicate_of: "", title: "", body: "", tag: "rally", place: "", country: "", lat: 0, lon: 0 },
      ] };
    } else {
      const texts: string[] = JSON.parse(user);
      out = { translations: texts.map((t) => `[sr] ${t}`) };
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_test", type: "message", role: "assistant", model: body.model, stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify(out) }],
      usage: { input_tokens: 1000, output_tokens: 200 },
    }));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.ANTHROPIC_API_KEY = "test-key";

const { openDb } = await import("../lib/db.ts");
const { runPipeline } = await import("../lib/pipeline.ts");
const repo = await import("../lib/repo.ts");
const { lookup } = await import("../lib/translate.ts");

test("AI pipeline: captions clips, writes stories, merges duplicates, holds unverified numbers, pre-translates", async () => {
  const db = await openDb({ memory: true });
  const now = new Date().toISOString();
  await repo.upsertClip(db, { id: "bluesky:did:plc:a/1", platform: "bluesky", nativeId: "did:plc:a/1", url: "u1", origin: "auto", status: "pending", title: "Most u Novom Sadu večeras #protest" });
  await repo.upsertClip(db, { id: "bluesky:did:plc:b/2", platform: "bluesky", nativeId: "did:plc:b/2", url: "u2", origin: "auto", status: "pending", title: "TV studio debate about protests" });
  await repo.insertArticles(db, [
    { url: "https://ex.org/1", title: "Studenti drže most", summary: "Organizatori kažu da blokada traje.", sourceName: "Danas", publishedAt: now, serbia: true },
    { url: "https://ex.org/2", title: "Students hold Novi Sad bridge", summary: "", sourceName: "N1", publishedAt: now, serbia: true },
    { url: "https://ex.org/3", title: "Thousands march in Lima", summary: "Police said the march was peaceful.", sourceName: "Reuters", publishedAt: now, serbia: false },
    { url: "https://ex.org/4", title: "Football results", summary: "", sourceName: "BBC", publishedAt: now, serbia: false },
  ]);

  const s = await runPipeline(db, { skipNetwork: true });
  assert.ok(s);
  assert.deepEqual(s.errors, []);
  assert.equal(s.clipsApproved, 1);
  assert.equal(s.clipsRejected, 1);
  const approved = await repo.getClip(db, "bluesky:did:plc:a/1");
  assert.equal(approved?.status, "approved");
  assert.equal(approved?.caption, "Students light up the bridge as the crowd sings");
  assert.equal(approved?.country, "RS");
  assert.equal((await repo.getClip(db, "bluesky:did:plc:b/2"))?.status, "rejected");

  const items = await repo.listItems(db, { includeHidden: true });
  assert.equal(items.length, 2);
  const bridge = items.find((i) => i.place === "Novi Sad")!;
  assert.equal(bridge.sources.length, 2, "the duplicate article becomes a second source");
  const lima = items.find((i) => i.place === "Lima")!;
  assert.equal(lima.hidden, true, "a number the source never mentioned holds the item for review");
  assert.match(lima.reviewReason, /50000/);

  const { map } = await lookup(db, "sr", ["Students hold the bridge in Novi Sad"]);
  assert.equal(map.get("Students hold the bridge in Novi Sad"), "[sr] Students hold the bridge in Novi Sad");

  // Request shape: the model the user asked for, fallbacks, structured output.
  const first = requests[0];
  assert.equal(first.body.model, "claude-sonnet-5-5");
  assert.equal(first.body.fallbacks, "default");
  assert.equal(first.body.output_config.format.type, "json_schema");
  assert.equal(first.body.output_config.effort, "low");
  assert.match(String(first.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
  await db.close();
});

test.after(() => server.close());
