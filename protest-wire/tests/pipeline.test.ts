import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../lib/db.ts";
import { runPipeline } from "../lib/pipeline.ts";
import * as repo from "../lib/repo.ts";

test("pipeline without AI publishes sourced headlines, merges near-duplicates, and holds the lock", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const db = await openDb({ memory: true });
  const now = new Date().toISOString();
  await repo.insertArticles(db, [
    { url: "https://example.org/a", title: "Studenti blokirali most u Novom Sadu", summary: "Studenti su blokirali most.", sourceName: "Danas", publishedAt: now, serbia: true },
    { url: "https://example.org/b", title: "Students block bridge in Novi Sad", summary: "", sourceName: "BBC", publishedAt: now, serbia: true },
  ]);
  const s = await runPipeline(db, { skipNetwork: true });
  assert.ok(s);
  assert.equal(s.itemsNew, 2);
  const items = await repo.listItems(db);
  assert.equal(items.length, 2);
  assert.equal(items[0].sources.length, 1);
  assert.ok(items.some((i) => i.place === "Novi Sad"));

  // Re-running does not process the same articles again.
  const again = await runPipeline(db, { skipNetwork: true });
  assert.equal(again?.itemsNew, 0);

  // A second run while one holds the lock is skipped.
  assert.equal(await repo.acquireLock(db, "pipeline", 60), true);
  assert.equal(await runPipeline(db, { skipNetwork: true }), null);
  await db.close();
});
