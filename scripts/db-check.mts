/** Verifies the Neon schema matches what the app expects. `npm run db:check` */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

const EXPECTED = ["analyses", "comments", "jobs", "videos"];

const tables = await sql`
  select t.table_name,
    (select count(*) from information_schema.columns c
      where c.table_name = t.table_name and c.table_schema = 'public') as cols
  from information_schema.tables t
  where t.table_schema = 'public'
  order by t.table_name`;

console.log("tables:");
for (const t of tables) console.log(`  ${t.table_name}  (${t.cols} columns)`);

const names = tables.map((t) => t.table_name as string);
const missing = EXPECTED.filter((e) => !names.includes(e));
console.log(missing.length ? `\nMISSING: ${missing.join(", ")}` : "\nall expected tables present");

const idx = await sql`
  select indexname from pg_indexes
  where schemaname = 'public' and tablename = 'comments'
  order by indexname`;
console.log("\ncomments indexes:");
for (const r of idx) console.log("  " + r.indexname);

const fks = await sql`
  select tc.table_name, kcu.column_name, ccu.table_name as refs
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
  join information_schema.constraint_column_usage ccu
    on tc.constraint_name = ccu.constraint_name
  where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`;
console.log("\nforeign keys:");
for (const f of fks) console.log(`  ${f.table_name}.${f.column_name} -> ${f.refs}`);

if (missing.length) process.exit(1);
