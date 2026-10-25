import { getDb } from "@/lib/db.ts";
import { ok } from "@/lib/http.ts";
import { mapData } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok(await mapData(await getDb()), 20);
}
