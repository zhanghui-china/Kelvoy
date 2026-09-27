import { expect, test } from "bun:test";
import type { Episode } from "@kelvoy/engine";
import type { EpisodeOverview } from "../shared/episode-overview";
import { deriveOnboarding } from "./onboarding";

function episode(id: string, status: Episode["status"], shots: Partial<Episode["shots"][number]>[] = []): Episode {
  return {
    episode_id: id, status, created_at: `2026-09-${id.slice(-2)}T00:00:00Z`,
    shots: shots.map((shot) => ({ status: "draft", kf_selected: null, clip: null, ...shot })),
  } as Episode;
}

test("a new account starts at create and links to creation", () => {
  expect(deriveOnboarding([])).toEqual({ completed: [false, false, false, false, false], href: "/episodes/new", failed: false, targetDone: false });
});

test("milestones accumulate from persisted episodes without counting empty shots", () => {
  const first = episode("e_01", "kf_review", [{ kf_selected: "a.png" }, { kf_selected: null }]);
  const second = episode("e_02", "clip_review", [{ kf_selected: "a.png", status: "approved", clip: "a.mp4" }]);
  expect(deriveOnboarding([first, second]).completed).toEqual([true, true, true, true, false]);
  expect(deriveOnboarding([episode("e_03", "kf_review")]).completed).toEqual([true, true, false, false, false]);
  const overview = (source: Episode): EpisodeOverview => ({
    episode_id: source.episode_id, name: "测试", status: source.status,
    persona_id: "p", destination_id: "d", created_at: source.created_at,
    credits_used: 0, render: { title: "" }, season: "", shot_count: source.shots.length,
    approved_shot_count: source.shots.filter((shot) => shot.status === "approved").length,
    any_shot_started: source.shots.some((shot) => shot.status !== "draft"),
    all_keyframes_selected: source.shots.length > 0 && source.shots.every((shot) => !!shot.kf_selected),
    all_shots_approved: source.shots.length > 0 && source.shots.every((shot) => shot.status === "approved"),
  });
  expect(deriveOnboarding([overview(first), overview(second)]).completed)
    .toEqual(deriveOnboarding([first, second]).completed);
});

test("finished film completes all steps and a failed episode links to retry view", () => {
  expect(deriveOnboarding([episode("e_03", "done")]).completed).toEqual([true, true, true, true, true]);
  const state = deriveOnboarding([episode("e_01", "draft"), episode("e_02", "failed")]);
  expect(state.href).toBe("/episodes/e_02");
  expect(state.failed).toBe(true);
});

test("a newer active episode remains the CTA target after an older film is done", () => {
  const state = deriveOnboarding([episode("e_01", "done"), episode("e_02", "kf_review")]);
  expect(state.completed).toEqual([true, true, true, true, true]);
  expect(state.href).toBe("/episodes/e_02");
  expect(state.targetDone).toBe(false);
});
