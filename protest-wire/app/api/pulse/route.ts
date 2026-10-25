import { anonHash, validDeviceId } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { body, fail, ok } from "@/lib/http.ts";
import { activePoll, vote } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

// The People's Pulse: one vote per device per question.
export async function POST(req: Request) {
  const b = await body<{ poll: string; option: number; deviceId: string }>(req);
  if (!validDeviceId(b.deviceId) || typeof b.option !== "number") return fail(400, "bad vote");
  const db = await getDb();
  const counted = await vote(db, String(b.poll ?? ""), b.option, anonHash("vote", `${b.deviceId}:${b.poll}`));
  return ok({ counted, poll: await activePoll(db) });
}
