import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import type { Episode } from "@kelvoy/engine";
import ClipReview from "./ClipReview";
import ScriptReview from "./ScriptReview";
import StagePlayback from "./StagePlayback";
import type { EpisodeMutation } from "./useEpisodeMutation";

const mutation = { pending: false, error: null, run: async () => null } as unknown as EpisodeMutation;
const shotBase = {
  no: 1, scene: "s", size: "wide", camera: "static", landmark: null, beat: "动作", kf_prompt: "",
  motion_prompt: "", caption: "", duration_s: 4, status: "clip_ready", clip: "clips/1.mp4",
  trim_start_s: null, candidates: [], kf_selected: null, bad_shot_reported: false,
};
const episodeWith = (shots: unknown[], extra: Record<string, unknown> = {}) => ({
  episode_id: "e1", name: "测试", shots, scenes: [], video_source: "references", cut_policy: "long_3_6",
  brief: { duration_s: 30 }, render: { fps: 30 }, ...extra,
}) as unknown as Episode;
const clipHtml = (episode: Episode) => renderToStaticMarkup(
  <StaticRouter location="/episodes/e1"><ClipReview episode={episode} mutation={mutation} /></StaticRouter>);

test("ClipReview shows the prompt disclosure per shot only when the shot has a stable id", () => {
  expect(clipHtml(episodeWith([{ ...shotBase, shot_id: "s1" }]))).toContain("查看第 1 镜发给模型的提示词");
  expect(clipHtml(episodeWith([shotBase]))).not.toContain("发给模型的提示词");
});

test("ScriptReview offers the script prompt disclosure inside the assistant card", () => {
  const html = renderToStaticMarkup(<StaticRouter location="/episodes/e1">
    <ScriptReview episode={episodeWith([shotBase])} destination={null} mutation={mutation} /></StaticRouter>);
  expect(html).toContain("查看发给模型的脚本提示词");
});

test("StagePlayback reuses the disclosure for saved script and clips, collapsed", () => {
  const episode = episodeWith([{ ...shotBase, shot_id: "s1" }]);
  const script = renderToStaticMarkup(<StagePlayback stage="script" episode={episode} destination={null} persona={null} />);
  expect(script).toContain("查看发给模型的脚本提示词");
  const clips = renderToStaticMarkup(<StagePlayback stage="clips" episode={episode} destination={null} persona={null} />);
  expect(clips).toContain("查看第 1 镜发给模型的提示词");
  expect(clips).not.toMatch(/<details[^>]*\sopen/);
  const legacy = renderToStaticMarkup(<StagePlayback stage="clips" episode={episodeWith([shotBase])} destination={null} persona={null} />);
  expect(legacy).not.toContain("发给模型的提示词");
});
