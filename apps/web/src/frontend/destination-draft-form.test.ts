import { expect, test } from "bun:test";
import { missingDestinationItems, photoSelectionError } from "./destination-draft-form";
const empty = { name: "", city: "", type: "scenic_area" as const, season_best: [], landmarks: [], route: [], food: [], transport: "", stay: "" };
test("publish checklist requires destination and complete landmarks", () => {
  expect(missingDestinationItems(empty)).toEqual(["景区名称", "城市", "至少一个地标"]);
  expect(missingDestinationItems({ ...empty, name: "山", city: "城", landmarks: [{ id: "a", name: "峰", best_time: "清晨", must_keep: ["石阶"], refs: ["a", "b", "c"] }] })).toEqual([]);
});
test("batch photos enforce combined count, size and format", () => {
  const photo = { size: 12, type: "image/jpeg" };
  expect(photoSelectionError([photo], 9)).toBeNull();
  expect(photoSelectionError([photo, photo], 9)).toContain("10 张");
  expect(photoSelectionError([{ ...photo, size: 10 * 1024 * 1024 + 1 }], 0)).toContain("10MB");
  expect(photoSelectionError([{ ...photo, type: "image/gif" }], 0)).toContain("JPEG");
});
