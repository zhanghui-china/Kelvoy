import { expect, test } from "bun:test";
import { missingDestinationItems, missingDestinationTargets, photoSelectionError } from "./destination-draft-form";
const empty = { name: "", city: "", type: "scenic_area" as const, season_best: [], landmarks: [], route: [], food: [], transport: "", stay: "" };
test("publish checklist requires destination and complete landmarks", () => {
  expect(missingDestinationItems(empty)).toEqual(["景区名称", "城市", "至少一个地标"]);
  expect(missingDestinationItems({ ...empty, name: "山", city: "城", landmarks: [{ id: "a", name: "峰", best_time: "清晨", must_keep: ["石阶"], refs: ["a", "b", "c"] }] })).toEqual([]);
});
test("missing items point at the control that fixes them", () => {
  expect(missingDestinationTargets(empty).map(item => item.targetId)).toEqual(["draft-name", "draft-city", "draft-add-landmark"]);
  const blank = { id: "lm1", name: "", best_time: "", must_keep: [""], refs: ["a"] };
  expect(missingDestinationTargets({ ...empty, name: "山", city: "城", landmarks: [blank] })).toEqual([
    { label: "地标 1：名称", targetId: "landmark-lm1-name" },
    { label: "地标 1：最佳机位／时段", targetId: "landmark-lm1-best_time" },
    { label: "地标 1：必须保真的特征", targetId: "landmark-lm1-must_keep" },
    { label: "地标 1：3–10 张实景照片", targetId: "landmark-lm1-photos" },
  ]);
});
test("batch photos enforce combined count, size and format", () => {
  const photo = { size: 12, type: "image/jpeg" };
  expect(photoSelectionError([photo], 9)).toBeNull();
  expect(photoSelectionError([photo, photo], 9)).toContain("10 张");
  expect(photoSelectionError([{ ...photo, size: 10 * 1024 * 1024 + 1 }], 0)).toContain("10MB");
  expect(photoSelectionError([{ ...photo, type: "image/gif" }], 0)).toContain("JPEG");
});
