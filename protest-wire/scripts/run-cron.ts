// Runs the pipeline once from the command line: `npm run cron`.
// Uses DATABASE_URL if set, otherwise the local PGlite database in .data/pglite.
import { getDb } from "../lib/db.ts";
import { runPipeline } from "../lib/pipeline.ts";

const db = await getDb();
const stats = await runPipeline(db, { deadlineMs: 120_000 });
console.log(stats ? JSON.stringify(stats, null, 2) : "Another run is in progress.");
await db.close();
