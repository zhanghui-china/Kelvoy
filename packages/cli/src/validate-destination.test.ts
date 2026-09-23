import { describe, expect, test } from "bun:test";
import { validateDestination } from "./validate-destination";

function validDestination() {
  return {
    destination_id: "d_wuxi_lingshan",
    version: 1,
    name: "灵山大佛",
    city: "无锡",
    type: "scenic_area",
    season_best: ["春", "秋"],
    landmarks: [
      {
        id: "l1",
        name: "灵山大佛",
        refs: ["dest/d_wuxi_lingshan/l1_01.jpg", "dest/d_wuxi_lingshan/l1_02.jpg", "dest/d_wuxi_lingshan/l1_03.jpg"],
        best_time: "上午顺光",
        must_keep: ["比例", "手印", "莲花座"],
      },
    ],
    route: ["山门", "登阶", "大佛"],
    food: ["素斋"],
    transport: "地铁 + 公交",
    stay: "景区周边民宿",
  };
}

describe("validateDestination", () => {
  test("accepts a well-formed destination pack", () => {
    const result = validateDestination(validDestination());
    expect(result.valid).toBe(true);
  });

  test("rejects a non-object input", () => {
    const result = validateDestination("not an object");
    expect(result.valid).toBe(false);
  });

  test("rejects an invalid type enum value", () => {
    const d = { ...validDestination(), type: "beach" };
    const result = validateDestination(d);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.startsWith("type:"))).toBe(true);
    }
  });

  test("rejects a landmark with fewer than 3 refs", () => {
    const d = validDestination();
    d.landmarks[0].refs = ["only-one.jpg"];
    const result = validateDestination(d);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("refs"))).toBe(true);
    }
  });

  test("rejects a landmark with empty must_keep", () => {
    const d = validDestination();
    d.landmarks[0].must_keep = [];
    const result = validateDestination(d);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("must_keep"))).toBe(true);
    }
  });

  test("rejects a destination with no landmarks", () => {
    const d = { ...validDestination(), landmarks: [] };
    const result = validateDestination(d);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.startsWith("landmarks:"))).toBe(true);
    }
  });

  test("reports every error at once, not just the first", () => {
    const d = { ...validDestination(), type: "beach", city: "" };
    d.landmarks[0].refs = ["only-one.jpg"];
    const result = validateDestination(d);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });
});
