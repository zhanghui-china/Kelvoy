import { expect, test } from "bun:test";
import {
  DEFAULT_CANDIDATES,
  DEFAULT_SHOT_COUNT,
  estimateCost,
  estimateCredits,
  GRID_MODE_KEYFRAME_DISCOUNT,
  KEYFRAME_GPU_MINUTES_PER_CANDIDATE,
  REWORK_FACTOR,
  VIDEO_GPU_MINUTES_PER_CANDIDATE,
} from "./credits";

test("estimateCost per_shot mode uses full keyframe cost and matches 镜数 × 候选数 × 单位成本 × 1.5", () => {
  const result = estimateCost({ mode: "per_shot" });
  const expectedKeyframe = DEFAULT_SHOT_COUNT * DEFAULT_CANDIDATES * KEYFRAME_GPU_MINUTES_PER_CANDIDATE;
  const expectedVideo = DEFAULT_SHOT_COUNT * DEFAULT_CANDIDATES * VIDEO_GPU_MINUTES_PER_CANDIDATE;
  expect(result.breakdown.keyframe_gpu_minutes).toBe(expectedKeyframe);
  expect(result.breakdown.video_gpu_minutes).toBe(expectedVideo);
  expect(result.gpu_minutes).toBe((expectedKeyframe + expectedVideo) * REWORK_FACTOR);
  expect(result.estimated_credits).toBe(result.gpu_minutes);
});

test("estimateCost grid mode halves the keyframe portion, leaves video untouched", () => {
  const perShot = estimateCost({ mode: "per_shot" });
  const grid = estimateCost({ mode: "grid" });
  expect(grid.breakdown.keyframe_gpu_minutes).toBe(
    perShot.breakdown.keyframe_gpu_minutes * GRID_MODE_KEYFRAME_DISCOUNT,
  );
  expect(grid.breakdown.video_gpu_minutes).toBe(perShot.breakdown.video_gpu_minutes);
  expect(grid.gpu_minutes).toBeLessThan(perShot.gpu_minutes);
});

test("estimateCost honors explicit shot_count/candidates overrides", () => {
  const result = estimateCost({ mode: "per_shot", shot_count: 10, candidates: 3 });
  expect(result.breakdown.shot_count).toBe(10);
  expect(result.breakdown.candidates).toBe(3);
  expect(result.breakdown.keyframe_gpu_minutes).toBe(10 * 3 * KEYFRAME_GPU_MINUTES_PER_CANDIDATE);
});

test("estimateCredits falls back to the default shot count when the episode has no shots yet", () => {
  const credits = estimateCredits({ shots: [], mode: "per_shot" });
  expect(credits).toBe(estimateCost({ mode: "per_shot" }).estimated_credits);
});

test("estimateCredits uses the episode's real shot count once it has shots", () => {
  const shots = new Array(5).fill(0).map(() => ({}) as never);
  const credits = estimateCredits({ shots, mode: "grid" });
  expect(credits).toBe(estimateCost({ mode: "grid", shot_count: 5 }).estimated_credits);
});
