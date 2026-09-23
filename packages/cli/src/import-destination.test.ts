import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "./db";
import { importDestination } from "./import-destination";

function validDestination() {
  return {
    destination_id: "d_test_import",
    version: 1,
    name: "测试景区",
    city: "无锡",
    type: "scenic_area",
    season_best: ["春"],
    landmarks: [
      {
        id: "l1",
        name: "测试地标",
        refs: ["a.jpg", "b.jpg", "c.jpg"],
        best_time: "上午",
        must_keep: ["特征"],
      },
    ],
    route: ["入口"],
    food: [],
    transport: "地铁",
    stay: "民宿",
  };
}

test("does not write on validation failure (no DATABASE_URL needed)", async () => {
  const result = await importDestination({ destination_id: "d_bad" });
  expect(result.ok).toBe(false);
  expect(result.errors?.length).toBeGreaterThan(0);
});

// Integration test against a real Postgres (infra/docker-compose.local.yml).
// Skipped unless DATABASE_URL is set — see ADR-0003.
describe.skipIf(!process.env.DATABASE_URL)("importDestination (DB)", () => {
  afterAll(async () => {
    const sql = getDb();
    await sql`delete from destinations where destination_id = ${validDestination().destination_id}`;
    await sql.end();
  });

  test("validates then upserts, round-trips via the doc column", async () => {
    const dest = validDestination();
    const result = await importDestination(dest);
    expect(result.ok).toBe(true);
    expect(result.destination_id).toBe(dest.destination_id);

    const sql = getDb();
    const [row] = await sql`select doc, version from destinations where destination_id = ${dest.destination_id}`;
    expect(row.version).toBe(1);
    expect(row.doc.name).toBe("测试景区");
  });

  test("upserting again with a bumped version overwrites in place", async () => {
    const dest = { ...validDestination(), version: 2, name: "改名了" };
    await importDestination(dest);

    const sql = getDb();
    const rows = await sql`select doc, version from destinations where destination_id = ${dest.destination_id}`;
    expect(rows.length).toBe(1);
    expect(rows[0].version).toBe(2);
    expect(rows[0].doc.name).toBe("改名了");
  });
});
