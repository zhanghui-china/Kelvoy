import type { Destination, Landmark } from "@kelvoy/engine";
import { expect, test } from "bun:test";
import { countRefs, hasEnoughRefs } from "./destination-refs";

function landmark(id: string, refCount: number): Landmark {
  return {
    id,
    name: id,
    refs: Array.from({ length: refCount }, (_, i) => `dest/${id}/${i}.jpg`),
    best_time: "清晨",
  };
}

function fixture(landmarks: Landmark[]): Destination {
  return {
    destination_id: "d_test",
    version: 1,
    name: "灵山大佛",
    city: "无锡",
    type: "scenic_area",
    season_best: ["秋"],
    landmarks,
    route: [],
    food: [],
    transport: "",
    stay: "",
  };
}

test("countRefs sums refs across landmarks", () => {
  expect(countRefs(fixture([landmark("a", 3), landmark("b", 1)]))).toBe(4);
  expect(countRefs(fixture([]))).toBe(0);
});

test("hasEnoughRefs needs every landmark at >= 3 refs, and at least one landmark", () => {
  expect(hasEnoughRefs(fixture([landmark("a", 3), landmark("b", 10)]))).toBe(true);
  expect(hasEnoughRefs(fixture([landmark("a", 3), landmark("b", 2)]))).toBe(false);
  expect(hasEnoughRefs(fixture([]))).toBe(false);
});
