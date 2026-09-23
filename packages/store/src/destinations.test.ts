import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Destination } from "@kelvoy/engine";
import { close, open } from "./db";
import { getDestination, upsertDestination } from "./destinations";

function fixture(id: string, name: string): Destination {
  return {
    destination_id: id,
    version: 1,
    name,
    city: "无锡",
    type: "scenic_area",
    season_best: ["春"],
    landmarks: [
      { id: "l1", name: "地标", refs: ["a.jpg", "b.jpg", "c.jpg"], best_time: "上午", must_keep: ["x"] },
    ],
    route: [],
    food: [],
    transport: "",
    stay: "",
  };
}

beforeEach(() => {
  open(":memory:");
});

afterEach(() => {
  close();
});

test("returns null for a missing destination", async () => {
  expect(await getDestination("d_missing")).toBeNull();
});

test("round-trips an upserted destination", async () => {
  await upsertDestination(fixture("d_1", "灵山大佛"));
  const result = await getDestination("d_1");
  expect(result?.name).toBe("灵山大佛");
  expect(result?.landmarks.length).toBe(1);
});

test("upserting the same id again overwrites in place", async () => {
  await upsertDestination(fixture("d_2", "旧名字"));
  await upsertDestination({ ...fixture("d_2", "新名字"), version: 2 });
  const result = await getDestination("d_2");
  expect(result?.name).toBe("新名字");
  expect(result?.version).toBe(2);
});
