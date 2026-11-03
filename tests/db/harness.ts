import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * A throwaway Postgres 17 (PGlite) with just enough of Supabase to run the
 * EDOSHMIS migrations as they run on edos_db: the anon / authenticated /
 * service_role roles, auth.users, auth.uid() read from the JWT claim, and
 * Supabase's default grants on the public schema. RLS is then exercised for
 * real by switching to `authenticated` with a user's id as the claim.
 */
const SUPABASE_STUB = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");

export async function freshDb(opts: { twice?: boolean } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (let pass = 0; pass < (opts.twice ? 2 : 1); pass++) {
    for (const f of files) {
      try {
        await db.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
      } catch (e) {
        throw new Error(`${f} (pass ${pass + 1}): ${(e as Error).message}`);
      }
    }
  }
  return db;
}

export async function addUser(db: PGlite, email: string) {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  return id;
}

/** Run `fn` as a signed-in user, through RLS, then return to superuser. */
export async function asUser<T>(db: PGlite, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId ?? ""}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

export async function one<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}
