import { describe, expect, test } from "bun:test";
import type { Destination } from "../schema/destination";
import type { Shot, ShotSize } from "../schema/episode";
import { removeShot } from "../state/episode";
import { checkScriptRules } from "./script";
import type { Episode } from "../schema/episode";

function makeShot(no: number, overrides: Partial<Shot> = {}): Shot {
  return {
    no,
    scene: "s1",
    size: "wide",
    beat: "test",
    camera: "static",
    landmark: null,
    kf_prompt: "",
    motion_prompt: "",
    duration_s: 1,
    candidates: [],
    kf_selected: null,
    clip: null,
    trim_start_s: null,
    status: "draft",
    regen_stage: null,
    bad_shot_reported: false,
    model: {},
    ...overrides,
  };
}

function makeDestination(landmarkIds: string[]): Destination {
  return {
    destination_id: "d_test",
    version: 1,
    name: "测试景区",
    city: "无锡",
    type: "scenic_area",
    season_best: [],
    landmarks: landmarkIds.map((id) => ({
      id,
      name: id,
      refs: ["a.jpg", "b.jpg", "c.jpg"],
      best_time: "上午",
      must_keep: ["x"],
    })),
    route: [],
    food: [],
    transport: "",
    stay: "",
  };
}

// 30 well-formed shots: alternating size (no runs > 2), 5 landmark shots,
// all landmark refs valid.
function wellFormedShots(): Shot[] {
  const sizes: ShotSize[] = ["wide", "medium", "close", "detail", "pov"];
  const shots: Shot[] = [];
  for (let i = 1; i <= 30; i++) {
    const landmark = i <= 5 ? "l1" : null;
    shots.push(makeShot(i, { size: sizes[i % sizes.length], landmark }));
  }
  return shots;
}

describe("checkScriptRules", () => {
  test("accepts a well-formed 30-shot script", () => {
    const violations = checkScriptRules(wellFormedShots(), makeDestination(["l1"]));
    expect(violations).toEqual([]);
  });

  test("flags too few shots", () => {
    const shots = wellFormedShots().slice(0, 20);
    const violations = checkScriptRules(shots, makeDestination(["l1"]));
    expect(violations.some((v) => v.rule === "shot_count")).toBe(true);
  });

  test("flags too many shots", () => {
    const shots = [...wellFormedShots(), makeShot(31, { size: "pov" })];
    const violations = checkScriptRules(shots, makeDestination(["l1"]));
    expect(violations.some((v) => v.rule === "shot_count")).toBe(true);
  });

  test("flags a same-size run longer than 2", () => {
    const shots = [
      makeShot(1, { size: "wide" }),
      makeShot(2, { size: "wide" }),
      makeShot(3, { size: "wide" }),
      ...wellFormedShots().slice(3),
    ];
    const violations = checkScriptRules(shots, makeDestination(["l1"]));
    expect(violations.some((v) => v.rule === "size_run")).toBe(true);
  });

  test("flags too few landmark shots", () => {
    const shots = wellFormedShots().map((s) => ({ ...s, landmark: null }));
    const violations = checkScriptRules(shots, makeDestination(["l1"]));
    expect(violations.some((v) => v.rule === "landmark_coverage")).toBe(true);
  });

  test("flags a landmark reference that doesn't exist in the destination", () => {
    const shots = wellFormedShots();
    shots[0] = { ...shots[0], landmark: "l_nonexistent" };
    const violations = checkScriptRules(shots, makeDestination(["l1"]));
    expect(violations.some((v) => v.rule === "landmark_reference")).toBe(true);
  });

  test("re-running after removeShot still validates (review-1 delete flow)", () => {
    const episode = {
      shots: wellFormedShots(),
      removed_shots: [],
    } as unknown as Episode;

    // Remove a non-landmark shot (no. 30) to stay above MIN_SHOTS and keep
    // landmark coverage intact.
    const after = removeShot(episode, 30);
    const violations = checkScriptRules(after.shots, makeDestination(["l1"]));
    expect(violations).toEqual([]);
  });
});
