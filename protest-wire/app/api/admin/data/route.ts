import { isAdmin } from "@/lib/admin.ts";
import { aiSpentToday } from "@/lib/ai.ts";
import { getDb } from "@/lib/db.ts";
import { env, features } from "@/lib/env.ts";
import { fail, ok } from "@/lib/http.ts";
import * as repo from "@/lib/repo.ts";
import { quotaUsedToday } from "@/lib/sources/youtube.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) return fail(401, "login required");
  const db = await getDb();
  const [pending, review, approved, items, settings, poll, runs, aiUsd, ytUnits, live] = await Promise.all([
    repo.clipsByStatus(db, "pending", 100),
    repo.clipsByStatus(db, "review", 50),
    repo.clipsByStatus(db, "approved", 60),
    repo.listItems(db, { limit: 120, includeHidden: true }),
    repo.getSettings(db),
    repo.activePoll(db),
    repo.recentRuns(db, 12),
    aiSpentToday(db),
    quotaUsedToday(db),
    repo.liveStreams(db),
  ]);
  return ok({
    pending, review, approved, items, settings, poll, runs, live,
    usage: { aiUsd, aiBudget: env.aiDailyBudgetUsd, ytUnits, ytQuota: env.youtubeDailyQuota },
    features: { db: features.db, ai: features.ai, youtube: features.youtube, instagram: features.instagram, autoApprove: env.autoApproveSubmissions },
  });
}
