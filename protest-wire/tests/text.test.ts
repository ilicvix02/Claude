import { test } from "node:test";
import assert from "node:assert/strict";
import { extractUrl, parseLink } from "../lib/platforms.ts";
import { hashtags, isProtestText, isSerbianProtestText, similarity, unverifiedNumbers } from "../lib/text.ts";
import { findCity, nearestCity } from "../lib/geo.ts";
import { minuteInfo } from "../lib/minute.ts";

test("protest keywords across languages and scripts", () => {
  for (const s of ["Students protest in Belgrade", "Manifestación en Madrid", "Grève générale à Paris", "Протест у Београду",
    "Kundgebung in Berlin", "Tüntetés Budapesten", "διαδήλωση στην Αθήνα", "unjuk rasa di Jakarta", "Studenti u blokadi"]) {
    assert.ok(isProtestText(s), s);
  }
  assert.ok(!isProtestText("Recipe: the best summer salad"));
  assert.ok(isSerbianProtestText("Izbori u Srbiji: studenti slave"));
});

test("platform links", () => {
  assert.deepEqual(parseLink("https://www.tiktok.com/@user.name/video/7301234567890123456?is_from_webapp=1")?.nativeId, "7301234567890123456");
  assert.equal(parseLink("https://www.instagram.com/reel/C9abcDEF123/?igsh=xyz")?.embedRef, "reel");
  assert.equal(parseLink("https://www.instagram.com/p/C9abcDEF123/")?.platform, "instagram");
  assert.equal(parseLink("https://twitter.com/someone/status/1850000000000000000")?.url, "https://x.com/someone/status/1850000000000000000");
  assert.equal(parseLink("https://youtu.be/dQw4w9WgXcQ")?.nativeId, "dQw4w9WgXcQ");
  assert.equal(parseLink("https://www.youtube.com/shorts/dQw4w9WgXcQ")?.url, "https://www.youtube.com/shorts/dQw4w9WgXcQ");
  assert.equal(parseLink("https://bsky.app/profile/did:plc:abc123/post/3kabcdefgh2x")?.embedRef, "at://did:plc:abc123/app.bsky.feed.post/3kabcdefgh2x");
  assert.equal(parseLink("https://mastodon.social/@alice/113456789012345678")?.embedRef, "https://mastodon.social/@alice/113456789012345678/embed");
  assert.equal(parseLink("https://example.com/whatever"), null);
  assert.equal(parseLink("javascript:alert(1)"), null);
  assert.equal(extractUrl("Look at this! https://vm.tiktok.com/ZMabc123/ #protest"), "https://vm.tiktok.com/ZMabc123/");
});

test("numbers in AI output must exist in the source", () => {
  assert.deepEqual(unverifiedNumbers("Police said 10,000 people marched", "Policija: 10.000 ljudi"), []);
  assert.deepEqual(unverifiedNumbers("About 10 thousand gathered", "10.000 okupljenih"), []);
  assert.deepEqual(unverifiedNumbers("50,000 people marched", "Thousands marched"), ["50000"]);
});

test("similarity, hashtags, places, Global Minute", () => {
  assert.ok(similarity("Students block Gazela bridge in Belgrade", "Belgrade: students block the Gazela bridge") > 0.5);
  assert.deepEqual(hashtags("Huge crowd #Protest #Београд #GenZ"), ["Protest", "Београд", "GenZ"]);
  assert.equal(findCity("Thousands gather in Novi Sad tonight")?.key, "rs-novi-sad");
  assert.equal(findCity("Protest u Beogradu")?.key, "rs-belgrade");
  assert.equal(nearestCity(44.8, 20.5).key, "rs-belgrade");
  const at = Date.UTC(2026, 9, 25, 18, 1);
  assert.equal(minuteInfo("18:00", at).active, true);
  assert.equal(minuteInfo("18:00", Date.UTC(2026, 9, 25, 19, 0)).startsAt, "2026-10-26T18:00:00.000Z");
});

test("links to internal hosts are refused; only http(s) URLs survive", async () => {
  const { safeUrl, isPublicHostname } = await import("../lib/platforms.ts");
  assert.equal(parseLink("https://169.254.169.254/@x/1234567"), null);
  assert.equal(parseLink("https://localhost/@x/1234567"), null);
  assert.equal(parseLink("https://db.internal/@x/1234567"), null);
  assert.equal(isPublicHostname("mastodon.social"), true);
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("https://example.com/a.jpg"), "https://example.com/a.jpg");
});
