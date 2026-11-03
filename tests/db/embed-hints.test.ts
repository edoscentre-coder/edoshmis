import { expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { freshDb } from "./harness";

/**
 * The screens join tables through PostgREST hints such as
 * `edoshmis_staff!edoshmis_surgeries_surgeon_id_fkey(full_name)`. A typo in a
 * constraint name only fails when that page is opened against the live
 * database — so check every hint in the source against the real schema.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|mts)$/.test(f) ? [p] : [];
  });
}

it("every foreign-key hint used by the screens exists in the schema", async () => {
  const db = await freshDb();
  const { rows } = await db.query<{ conname: string }>("select conname from pg_constraint where contype = 'f'");
  const known = new Set(rows.map((r) => r.conname));
  const used = new Map<string, string>();
  for (const f of files(join(__dirname, "..", "..", "src"))) {
    for (const m of readFileSync(f, "utf8").matchAll(/!(edoshmis_[a-z0-9_]+)\(/g)) used.set(m[1], f);
  }
  const missing = [...used.entries()].filter(([c]) => !known.has(c)).map(([c, f]) => `${c} (in ${f.split("src")[1]})`);
  expect(missing).toEqual([]);
  expect(used.size).toBeGreaterThan(40);
});
