// Creates the tables (safe to run again): `npm run db:setup`. The app also does this on first use.
import { getDb } from "../lib/db.ts";

const db = await getDb();
const rows = await db.query<{ table_name: string }>(
  "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
);
console.log(`Database ready (${process.env.DATABASE_URL ? "Postgres" : "local PGlite"}). Tables: ${rows.map((r) => r.table_name).join(", ")}`);
await db.close();
