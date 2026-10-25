import { homeData } from "@/lib/data.ts";
import { ok } from "@/lib/http.ts";
import { isLocale } from "@/lib/i18n.ts";

export const dynamic = "force-dynamic";

// Polled by the page every 30 seconds: new clips, wire items, counters and live streams.
export async function GET(req: Request) {
  const lang = new URL(req.url).searchParams.get("lang");
  return ok(await homeData(isLocale(lang) ? lang : "en"), 10);
}
