import { expect, test } from "bun:test";
import type { Shot } from "../schema";
import { planLongCuts, CompositionConstraintError } from "./long-cuts";

const shots = (length: number): Shot[] => Array.from({ length }, (_, i) => ({
  no: i + 1, clip: `clip/${i + 1}.mp4`, status: "approved", trim_start_s: 0,
  duration_s: 4, caption: `镜${i + 1}`,
} as Shot));
const media = (length: number, seconds = 5, intro = 0, outro = 0) => ({
  clip_duration_s: Object.fromEntries(Array.from({ length }, (_, i) => [i + 1, seconds])),
  intro_duration_s: intro, outro_duration_s: outro,
});

test("long films distribute a 30 second budget instead of clamping to two seconds", () => {
  const cuts = planLongCuts(shots(7), 120, 30, media(7), 30);
  expect(cuts.reduce((s, c) => s + c.frame_count!, 0)).toBe(900);
  for (const c of cuts) {
    expect(c.duration_s).toBeGreaterThanOrEqual(3);
    expect(c.duration_s).toBeLessThanOrEqual(5);
    expect(c.frame_count! % 15).toBe(0);
  }
});

for (const fps of [24, 25, 30, 60]) for (const bpm of [0, NaN, 84, 120]) {
  test(`preserves reordered identity and nonzero starts at ${fps}fps / ${bpm}bpm`, () => {
    const source = shots(7).reverse();
    source[0]!.trim_start_s = 0.51;
    const durations = media(7, 5.2, 1.1, 0.9);
    const cuts = planLongCuts(source, bpm, 30, durations, fps);
    expect(cuts.map(c => c.no)).toEqual(source.map(s => s.no));
    expect(cuts.map(c => c.clip_key)).toEqual(source.map(s => s.clip!));
    expect(cuts.map(c => c.caption)).toEqual(source.map(s => s.caption!));
    expect(cuts[0]!.trim_start_s).toBeGreaterThanOrEqual(0.51);
    expect(Math.abs(cuts.reduce((s,c) => s + c.duration_s, 0) + 2 - 30)).toBeLessThanOrEqual(0.5);
    for (const c of cuts) {
      expect(c.duration_s).toBeGreaterThanOrEqual(3);
      expect(c.duration_s).toBeLessThanOrEqual(6);
      expect(c.trim_start_s + c.duration_s).toBeLessThanOrEqual(5.2 + 1e-9);
      expect(c.frame_count).toBeInteger();
    }
  });
}

test("there is no shot-count quota; suggested durations break total-budget ties", () => {
  const source = shots(2); source[0]!.duration_s = 3; source[1]!.duration_s = 5;
  expect(planLongCuts(source, 0, 8, media(2, 6), 30).map(c => c.duration_s)).toEqual([3, 5]);
  expect(planLongCuts(shots(11), 0, 33, media(11), 30)).toHaveLength(11);
});

test("total duration wins over each individual suggestion", () => {
  expect(planLongCuts(shots(2), 0, 9.1, media(2), 30).reduce((s,c) => s+c.duration_s,0)).toBeCloseTo(9.1, 6);
});

test("insufficient material and impossible budgets never fall back or loop", () => {
  expect(() => planLongCuts(shots(7), 120, 30, media(7, 2.99), 30)).toThrow("第 1 镜");
  const source = shots(7); source[0]!.trim_start_s = 2.01;
  expect(() => planLongCuts(source, 120, 30, media(7), 30)).toThrow(CompositionConstraintError);
  expect(() => planLongCuts(shots(3), 0, 30, media(3), 30)).toThrow("预算");
  expect(() => planLongCuts(shots(11), 120, 30, media(11), 30)).toThrow("预算");
  expect(() => planLongCuts(shots(7), 120, 30, media(7, 5, 9, 9), 30)).toThrow("预算");
});

test("invalid probes, trim starts and duplicate shot identities are rejected", () => {
  for (const seconds of [NaN, Infinity, -1]) {
    expect(() => planLongCuts(shots(7), 0, 30, media(7, seconds), 30)).toThrow(CompositionConstraintError);
  }
  const source = shots(7); source[0]!.trim_start_s = -1;
  expect(() => planLongCuts(source, 0, 30, media(7), 30)).toThrow(CompositionConstraintError);
  source[0]!.trim_start_s = 0; source[1]!.no = 1;
  expect(() => planLongCuts(source, 0, 30, media(7), 30)).toThrow(CompositionConstraintError);
});

test("six-second cuts require six seconds of real material; generated five-second clips stay bounded", () => {
  const source=shots(2); source.forEach(s => { s.duration_s=6; });
  expect(planLongCuts(source,120,12,media(2,6),30).map(c => c.duration_s)).toEqual([6,6]);
  expect(() => planLongCuts(source,120,12,media(2,5),30)).toThrow(CompositionConstraintError);
});
