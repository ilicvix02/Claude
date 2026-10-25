import { isCronAuthorized } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { fail, ok } from "@/lib/http.ts";
import { runPipeline } from "@/lib/pipeline.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Called every few minutes by Vercel Cron (Pro), cron-job.org or any scheduler, with CRON_SECRET.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return fail(401, "unauthorized");
  const db = await getDb();
  const stats = await runPipeline(db, { deadlineMs: 100_000 });
  return ok(stats ?? { skipped: "another run is in progress" });
}
