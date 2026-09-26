import { expect, test } from "bun:test";
import type { Episode, EpisodeStatus } from "@kelvoy/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import StageSteps from "./StageSteps";
import ProgressView from "./ProgressView";
import type { EpisodeMutation } from "./useEpisodeMutation";

const mutation = { pending: false, error: null, clearError: () => {}, run: async () => null } as EpisodeMutation;

test.each([
  ["brief", "创建项目", 1], ["script", "分镜脚本", 2],
  ["assets", "关键帧", 3], ["keyframe", "关键帧", 3],
  ["video", "视频片段", 4], ["compose", "合成预览", 5],
] as const)("failed %s task marks stage %s", (stage, label, ordinal) => {
  const html = renderToStaticMarkup(<StageSteps status="failed" failedTask={{ stage, shot_no: null }} />);
  expect(html).toContain(`aria-current="step">${["①", "②", "③", "④", "⑤"][ordinal - 1]} ${label}`);
});

test.each([
  ["draft", 1], ["scripting", 2], ["script_review", 2],
  ["assets", 3], ["keyframing", 3], ["kf_review", 3],
  ["clipping", 4], ["clip_review", 4],
  ["compose_ready", 5], ["composing", 5], ["done", 6],
] as [EpisodeStatus, number][])("live %s status marks step %i", (status, ordinal) => {
  const html = renderToStaticMarkup(<StageSteps status={status} />);
  expect(html).toContain(`aria-current="step">${["①", "②", "③", "④", "⑤", "⑥"][ordinal - 1]}`);
});

test("failed script and assets tasks keep distinct failure labels", () => {
  const episode = { episode_id: "e_1", status: "failed", shots: [] } as unknown as Episode;
  for (const [stage, label] of [["script", "分镜脚本"], ["assets", "准备素材"]] as const) {
    const html = renderToStaticMarkup(<StaticRouter location="/episodes/e_1"><ProgressView
      episode={episode} mutation={mutation} failedTask={{ stage, shot_no: null }} /></StaticRouter>);
    expect(html).toContain(`失败阶段：${label}`);
  }
});

test("failure view names stage and shot while keeping retry action", () => {
  const episode = { episode_id: "e_1", status: "failed", shots: [] } as unknown as Episode;
  const html = renderToStaticMarkup(<StaticRouter location="/episodes/e_1"><ProgressView episode={episode} mutation={mutation} failedTask={{ stage: "video", shot_no: 7 }} /></StaticRouter>);
  expect(html).toContain("视频片段");
  expect(html).toContain("第 7 镜");
  expect(html).toContain('href="/help#clips"');
  expect(html).toContain("重新执行失败任务");
  const generic = renderToStaticMarkup(<StaticRouter location="/episodes/e_1"><ProgressView episode={episode} mutation={mutation} /></StaticRouter>);
  expect(generic).toContain("生成失败");
  expect(generic).toContain("未找到可重试的失败任务");
  expect(generic).not.toContain("<button");
});

test("a failed shot shows its task stage even while episode status is generating", () => {
  const episode = { episode_id: "e_1", status: "keyframing", shots: [{ status: "failed" }] } as unknown as Episode;
  const html = renderToStaticMarkup(<StaticRouter location="/episodes/e_1"><ProgressView episode={episode} mutation={mutation} failedTask={{ stage: "keyframe", shot_no: 3 }} /></StaticRouter>);
  expect(html).toContain("失败阶段：关键帧 · 第 3 镜");
  expect(html).toContain("重新执行失败任务");
});

test("queued retry keeps progress visible without offering another retry", () => {
  const episode = { episode_id: "e_1", status: "keyframing", shots: [{ status: "failed" }] } as unknown as Episode;
  const html = renderToStaticMarkup(<StaticRouter location="/episodes/e_1"><ProgressView episode={episode} mutation={mutation} failedTask={null} /></StaticRouter>);
  expect(html).toContain("等待后台处理");
  expect(html).not.toContain("<button");
});
