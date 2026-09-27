import { afterEach, beforeEach, expect, test } from "bun:test";
import { close, getDestination, getDestinationVersion, listDestinations, open } from "@kelvoy/store";
import { importDestination } from "./import-destination";

function validDestination() {
  return {
    destination_id: "d_test_import",
    version: 1,
    name: "测试景区",
    city: "无锡",
    type: "scenic_area" as const,
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

beforeEach(() => {
  open(":memory:");
});

afterEach(() => {
  close();
});

test("does not write on validation failure", async () => {
  const result = await importDestination({ destination_id: "d_bad" });
  expect(result.ok).toBe(false);
  expect(result.errors?.length).toBeGreaterThan(0);
  expect(await getDestination("d_bad")).toBeNull();
});

test("validates then upserts, round-trips via the store", async () => {
  const dest = validDestination();
  const result = await importDestination(dest);
  expect(result.ok).toBe(true);
  expect(result.destination_id).toBe(dest.destination_id);

  const stored = await getDestination(dest.destination_id);
  expect(stored?.version).toBe(1);
  expect(stored?.name).toBe("测试景区");
});

test("upserting again with a bumped version overwrites in place", async () => {
  await importDestination(validDestination());
  const updated = { ...validDestination(), version: 2, name: "改名了" };
  await importDestination(updated);

  const stored = await getDestination(updated.destination_id);
  expect(stored?.version).toBe(2);
  expect(stored?.name).toBe("改名了");
});


test("metadata round-trips in catalog and immutable revisions without modifying input", async () => {
  const source = { ...validDestination(), country_code: "CN", province: " 江苏 ", description: " 景区简介 " };
  expect((await importDestination(source)).ok).toBe(true);
  const expected = { ...source, province: "江苏", description: "景区简介" };
  expect(await getDestination(source.destination_id)).toEqual(expected);
  expect(await listDestinations()).toEqual([expected]);
  expect(await getDestinationVersion(source.destination_id, 1)).toEqual(expected);
  expect(source.province).toBe(" 江苏 ");
  expect((await importDestination({ ...validDestination(), version: 2 })).ok).toBe(true);
  expect(await getDestination(source.destination_id)).toEqual({ ...validDestination(), version: 2 });
  expect(await getDestinationVersion(source.destination_id, 1)).toEqual(expected);
});

test("invalid metadata never replaces an existing destination", async () => {
  await importDestination(validDestination());
  const result = await importDestination({ ...validDestination(), version: 2, country_code: "cn" });
  expect(result.ok).toBe(false);
  expect(await getDestination(validDestination().destination_id)).toEqual(validDestination());
  expect(await getDestinationVersion(validDestination().destination_id, 2)).toBeNull();
});
