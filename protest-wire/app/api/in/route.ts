import { anonHash, ipKey, validDeviceId } from "@/lib/auth.ts";
import { minuteInfo } from "@/lib/data.ts";
import { getDb } from "@/lib/db.ts";
import { city } from "@/lib/geo.ts";
import { body, fail, ok } from "@/lib/http.ts";
import { addCheckin, getSettings, rateLimit, stats } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

// "I'm in" (once per device) and "I'm standing" during the Global Minute (once per device per day).
export async function POST(req: Request) {
  const b = await body<{ city: string; ref: string; deviceId: string; kind: string }>(req);
  const kind = b.kind === "minute" ? "minute" : "in";
  const place = city(String(b.city ?? ""));
  if (!place) return fail(400, "pick a city");
  if (!validDeviceId(b.deviceId)) return fail(400, "missing device id");
  const db = await getDb();
  // Stops scripts from inflating the count: at most 30 new people per network per hour.
  if (!(await rateLimit(db, `in:${ipKey(req)}`, 30, 3600))) return fail(429, "too many from this network, try later");
  const settings = await getSettings(db);
  const minute = minuteInfo(settings.minuteUtc);
  if (kind === "minute" && !minute.active) return fail(409, "the Global Minute is not on right now");
  const day = new Date().toISOString().slice(0, 10);
  const fp = anonHash(kind, kind === "minute" ? `${b.deviceId}:${day}` : b.deviceId);
  const res = await addCheckin(db, { kind, cityKey: place.key, refCity: String(b.ref ?? ""), fp });
  return ok({ ...res, city: place.key, stats: await stats(db, minute.active ? minute.startsAt : undefined) });
}
