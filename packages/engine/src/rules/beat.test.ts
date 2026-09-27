import { expect, test } from "bun:test";
import type { Shot } from "../schema/episode";
import { MAX_SHOT_S, MIN_SHOT_S, alignToBeat, planCuts, planFixedCuts, totalCutDurationS } from "./beat";

function shotFixture(no: number, overrides: Partial<Shot> = {}): Shot {
  return {
    no,
    scene: "sc_1",
    size: "wide",
    beat: "抵达",
    camera: "static",
    landmark: null,
    kf_prompt: "",
    motion_prompt: "",
    duration_s: 1.2,
    candidates: [],
    kf_selected: null,
    clip: `clip/${String(no).padStart(2, "0")}.mp4`,
    trim_start_s: 0,
    status: "approved",
    regen_stage: null,
    bad_shot_reported: false,
    model: {},
    ...overrides,
  };
}

test("alignToBeat snaps to the nearest whole beat", () => {
  // 120 bpm -> 0.5 s/beat; 1.2 s 的目标最近的整拍是 1.0 s（2 拍）。
  expect(alignToBeat(1.2, 120)).toBe(1);
  // 1.3 s 更靠近 1.5 s（3 拍）。
  expect(alignToBeat(1.3, 120)).toBe(1.5);
});

test("alignToBeat never leaves the FR-07 0.8–2.0 s window", () => {
  // 90 bpm -> 0.667 s/beat，1 拍太短、2 拍 1.333 s、3 拍 2.0 s。
  expect(alignToBeat(0.1, 90)).toBeGreaterThanOrEqual(MIN_SHOT_S);
  expect(alignToBeat(10, 90)).toBeLessThanOrEqual(MAX_SHOT_S);
});

test("alignToBeat falls back to clamping when bpm is unusable", () => {
  expect(alignToBeat(1.2, 0)).toBe(1.2);
  expect(alignToBeat(5, -1)).toBe(MAX_SHOT_S);
  // bpm 20 -> 3 s/beat，窗口里一个整拍都放不下。
  expect(alignToBeat(1.5, 20)).toBe(1.5);
});

test("planCuts maps approved shots to beat-aligned cuts", () => {
  const cuts = planCuts([shotFixture(1), shotFixture(2, { trim_start_s: 0.4, duration_s: 1.6 })], 120);
  expect(cuts).toEqual([
    { no: 1, clip_key: "clip/01.mp4", trim_start_s: 0, duration_s: 1 },
    { no: 2, clip_key: "clip/02.mp4", trim_start_s: 0.4, duration_s: 1.5 },
  ]);
  expect(totalCutDurationS(cuts)).toBe(2.5);
});

test("planCuts treats a null trim_start_s as 0", () => {
  expect(planCuts([shotFixture(1, { trim_start_s: null })], 120)[0]?.trim_start_s).toBe(0);
});

test("planCuts refuses to compose when a shot isn't approved or has no clip", () => {
  expect(() => planCuts([shotFixture(1), shotFixture(2, { status: "clip_ready" })], 120)).toThrow(
    "第 2 镜未 approved",
  );
  expect(() => planCuts([shotFixture(3, { clip: null })], 120)).toThrow("第 3 镜没有片段");
  expect(() => planCuts([], 120)).toThrow("没有镜头可以合成");
});

test("new-project cuts snap to frame starts and stay at exactly 30 frames regardless of music", () => {
  const shots = [shotFixture(1, { trim_start_s: 0.06 }), shotFixture(2, { trim_start_s: 0.1 })];
  const cuts = planFixedCuts(shots, 30);
  expect(cuts.map((cut) => cut.trim_start_frame)).toEqual([2, 3]);
  expect(cuts.map((cut) => cut.frame_count)).toEqual([30, 30]);
  expect(totalCutDurationS(cuts)).toBe(2);
  expect(cuts[0]?.trim_start_s).toBeCloseTo(2 / 30, 9);
});
