import { expect, test } from "bun:test";
import { fillMissingSuggestion, reorderedIds, storyboardDuration, suggestionFields, emptyShot, pendingGenerationEstimate } from "./storyboard-model";

test("AI fills only fields still empty and never replaces edits after request", () => {
  expect(fillMissingSuggestion({ beat: "用户输入", caption: "", kf_prompt: "" }, { beat: "AI动作", caption: "AI字幕", kf_prompt: "AI画面" }, new Set(["kf_prompt"])))
    .toEqual({ beat: "用户输入", caption: "AI字幕", kf_prompt: "" });
});
test("move and drag reorder stable identities rather than display numbers", () => {
  expect(reorderedIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  expect(reorderedIds(["a", "b"], "missing", "a")).toEqual(["a", "b"]);
});
test("duration mirrors fixed one second policy and legacy beats", () => {
  expect(storyboardDuration([{ duration_s: 3 }, { duration_s: 2 }], "fixed_1s")).toBe(2);
  expect(storyboardDuration([{ duration_s: 3 }, { duration_s: 2 }])).toBe(5);
  expect(storyboardDuration([], "fixed_1s")).toBe(0);
});

test("suggestion input omits empty fields instead of declaring them supplied", () => {
  expect(suggestionFields(emptyShot(""))).toEqual({ size: "medium", camera: "static" });
});

test("pending generation cost excludes retained media and prices missing work", () => {
  const prices = { script: 1, image: 2, video: 10, compose: 5 };
  const episode = { video_source: "keyframe", candidate_count: 2, shots: [
    { status: "approved", clip: { file: "retained.mp4" }, candidates: [], kf_selected: null },
    { status: "draft", clip: null, candidates: [], kf_selected: null },
  ] } as unknown as import("@kelvoy/engine").Episode;
  expect(pendingGenerationEstimate(episode, prices)).toBe(14);
  expect(pendingGenerationEstimate({ ...episode, video_source: "references" }, prices)).toBe(10);
});
