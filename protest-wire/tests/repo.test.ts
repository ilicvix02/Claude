import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../lib/db.ts";
import * as repo from "../lib/repo.ts";

const db = await openDb({ memory: true });

test("clips: upsert, approve, list, live, cheer, report", async () => {
  const isNew = await repo.upsertClip(db, {
    id: "tiktok:1", platform: "tiktok", nativeId: "1", url: "https://www.tiktok.com/@a/video/1",
    origin: "community", status: "pending", title: "students march", postedAt: new Date().toISOString(),
  });
  assert.equal(isNew, true);
  assert.equal(await repo.upsertClip(db, { id: "tiktok:1", platform: "tiktok", nativeId: "1", url: "x", origin: "auto", status: "approved" }), false);
  assert.equal((await repo.getClip(db, "tiktok:1"))?.status, "pending", "upsert must not change moderation state");
  assert.equal((await repo.listClips(db)).length, 0);
  await repo.updateClip(db, "tiktok:1", { status: "approved", place: "Belgrade", country: "RS" });
  const list = await repo.listClips(db, { countries: ["RS"] });
  assert.equal(list.length, 1);
  assert.equal(await repo.cheerClip(db, "tiktok:1"), 1);
  for (let i = 0; i < 3; i++) await repo.reportClip(db, "tiktok:1");
  assert.equal((await repo.getClip(db, "tiktok:1"))?.status, "review");

  await repo.upsertClip(db, { id: "youtube:abcdefghijk", platform: "youtube", nativeId: "abcdefghijk", url: "u", origin: "auto", status: "approved", isLive: true, liveViewers: 50 });
  assert.equal((await repo.liveStreams(db)).length, 1);
  await repo.setLive(db, [], {}, ["youtube:abcdefghijk"]);
  assert.equal((await repo.liveStreams(db)).length, 0);
});

test("check-ins: numbering, once per fingerprint, race and lines", async () => {
  const a = await repo.addCheckin(db, { kind: "in", cityKey: "rs-belgrade", fp: "a" });
  const b = await repo.addCheckin(db, { kind: "in", cityKey: "jp-tokyo", refCity: "rs-belgrade", fp: "b" });
  const again = await repo.addCheckin(db, { kind: "in", cityKey: "jp-tokyo", fp: "b" });
  assert.deepEqual([a.n, b.n], [1, 2]);
  assert.deepEqual(again, { n: 2, isNew: false });
  const race = await repo.cityRace(db, 24);
  assert.equal(race[0].cityKey, "rs-belgrade");
  assert.equal(race[0].score, 2);
  const s = await repo.stats(db, new Date(Date.now() - 60000).toISOString());
  assert.equal(s.people, 2);
  assert.equal(s.cities, 2);
  const m = await repo.mapData(db);
  assert.equal(m.lines[0].from, "rs-belgrade");
  assert.ok(m.points.find((p) => p.key === "rs-belgrade"));
});

test("polls, settings, locks, rate limits, translations, items", async () => {
  await repo.createPoll(db, "p1", "What next?", ["A", "B"]);
  assert.equal(await repo.vote(db, "p1", 1, "x"), true);
  assert.equal(await repo.vote(db, "p1", 1, "x"), false);
  assert.equal(await repo.vote(db, "p1", 7, "y"), false);
  assert.deepEqual((await repo.activePoll(db))?.counts, [0, 1]);

  await repo.saveSettings(db, { headline: "Hi" });
  assert.equal((await repo.getSettings(db)).headline, "Hi");
  assert.equal(await repo.acquireLock(db, "t", 60), true);
  assert.equal(await repo.acquireLock(db, "t", 60), false);
  await repo.releaseLock(db, "t");
  assert.equal(await repo.acquireLock(db, "t", 60), true);
  assert.equal(await repo.rateLimit(db, "k", 2, 60), true);
  assert.equal(await repo.rateLimit(db, "k", 2, 60), true);
  assert.equal(await repo.rateLimit(db, "k", 2, 60), false);

  await repo.saveTranslations(db, "de", [["h1", "Hallo"]]);
  assert.equal((await repo.getTranslations(db, ["h1", "h2"], "de")).get("h1"), "Hallo");

  await repo.insertItem(db, { id: "i1", publishedAt: new Date().toISOString(), title: "T", body: "B", tag: "rally", place: "Lima", country: "PE", lat: null, lon: null, sources: [{ name: "BBC", url: "https://bbc.co.uk/1" }], hidden: false, reviewReason: "", ai: true });
  await repo.addSources(db, "i1", [{ name: "AJ", url: "https://aljazeera.com/1" }, { name: "BBC", url: "https://bbc.co.uk/1" }]);
  const items = await repo.listItems(db);
  assert.equal(items[0].sources.length, 2);
  assert.equal(await repo.insertArticles(db, [{ url: "u1", title: "t", summary: "", sourceName: "N1", publishedAt: new Date().toISOString(), serbia: true }]), 1);
  assert.equal(await repo.insertArticles(db, [{ url: "u1", title: "t", summary: "", sourceName: "N1", publishedAt: new Date().toISOString(), serbia: true }]), 0);
  assert.equal((await repo.pendingArticles(db, 5)).length, 1);
});
