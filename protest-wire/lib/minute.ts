// The Global Minute: every day at a fixed UTC time, for a short window, everyone stands up together.

export interface MinuteInfo { startsAt: string; endsAt: string; active: boolean }

const MINUTE_WINDOW_MS = 3 * 60_000;

/** The Global Minute happens every day at Settings.minuteUtc (UTC); people can join for 3 minutes. */
export function minuteInfo(minuteUtc: string, now = Date.now()): MinuteInfo {
  const [h, m] = (/^\d{1,2}:\d{2}$/.test(minuteUtc) ? minuteUtc : "18:00").split(":").map(Number);
  const d = new Date(now);
  let start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m);
  if (now >= start + MINUTE_WINDOW_MS) start += 86_400_000;
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(start + MINUTE_WINDOW_MS).toISOString(), active: now >= start && now < start + MINUTE_WINDOW_MS };
}
