// Applies supabase/migrations/*.sql to edos_db, in order, each in its own
// transaction, recording what ran in public.edoshmis_schema_migrations.
//
//   npm run migrate            apply what has not been applied
//   npm run migrate -- --dry   list what would run
//
// Needs DATABASE_URL in .env.local — the Postgres connection string from
// Supabase (Project Settings → Database → Connection string, "Session
// pooler" or direct). It is only read here, server-side, and never committed.
//
// Files applied by hand before this runner existed are detected: if a file's
// tables already exist it is re-run (every migration is idempotent), so the
// state converges either way. 0099 (grants) always runs last, every time.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const envFile = path.join(root, ".env.local");
const env = fs.existsSync(envFile)
  ? Object.fromEntries(fs.readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }))
  : {};
const url = process.env.DATABASE_URL || env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to edoshmis/.env.local (Supabase → Project Settings → Database → Connection string).");
  process.exit(1);
}
const dry = process.argv.includes("--dry");
const dir = path.join(root, "supabase", "migrations");
const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const ALWAYS = new Set(files.filter((f) => f.startsWith("0099_")));

const client = new pg.Client({ connectionString: url, ssl: process.env.PGSSL === "off" ? false : { rejectUnauthorized: false }, application_name: "edoshmis-migrate" });
await client.connect();
const { rows: [who] } = await client.query("select current_database() db, current_user u, version() v");
console.log(`Connected: ${who.db} as ${who.u} (${who.v.split(" ").slice(0, 2).join(" ")})`);

await client.query(`create table if not exists public.edoshmis_schema_migrations (
  file text primary key, checksum text not null, applied_at timestamptz not null default now())`);
await client.query("alter table public.edoshmis_schema_migrations enable row level security");
const { rows: done } = await client.query("select file, checksum from public.edoshmis_schema_migrations");
const applied = new Map(done.map((r) => [r.file, r.checksum]));

let ran = 0;
for (const f of files) {
  const sql = fs.readFileSync(path.join(dir, f), "utf8");
  const sum = crypto.createHash("sha256").update(sql).digest("hex").slice(0, 16);
  const changed = applied.has(f) && applied.get(f) !== sum;
  if (applied.has(f) && !changed && !ALWAYS.has(f)) continue;
  console.log(`${dry ? "would apply" : "applying"} ${f}${changed ? " (changed since last run)" : ""}`);
  if (dry) continue;
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query(
      "insert into public.edoshmis_schema_migrations (file, checksum) values ($1, $2) on conflict (file) do update set checksum = excluded.checksum, applied_at = now()",
      [f, sum],
    );
    await client.query("commit");
    ran++;
  } catch (e) {
    await client.query("rollback");
    console.error(`\n${f} failed and was rolled back — nothing from it was applied.\n${e.message}${e.position ? ` (at character ${e.position})` : ""}`);
    await client.end();
    process.exit(1);
  }
}
console.log(dry ? "Dry run — nothing applied." : `Done. ${ran} file(s) applied.`);
await client.end();
