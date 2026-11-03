import { describe, expect, it } from "vitest";
import { freshDb } from "./harness";

describe("migrations", () => {
  it("apply cleanly, twice (idempotent)", async () => {
    const db = await freshDb({ twice: true });
    const r = await db.query<{ n: number }>(
      "select count(*)::int as n from pg_tables where schemaname = 'public' and tablename like 'edoshmis\_%'",
    );
    expect(r.rows[0].n).toBeGreaterThan(20);
    const bad = await db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and (tablename not like 'edoshmis\_%' or not rowsecurity)",
    );
    expect(bad.rows).toEqual([]); // every table is ours, and every one has RLS on
  });
});
