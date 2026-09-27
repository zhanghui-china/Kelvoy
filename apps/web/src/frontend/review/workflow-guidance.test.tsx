import { expect, test } from "bun:test";
import type { Episode, Shot } from "@kelvoy/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import ScriptReview from "./ScriptReview";
import KeyframeReview from "./KeyframeReview";
import ClipReview from "./ClipReview";
import ComposeSetup from "./ComposeSetup";
import DoneView from "./DoneView";
import ProgressView from "./ProgressView";
import type { EpisodeMutation } from "./useEpisodeMutation";

const shot = {
  no: 1, scene: "s1", size: "wide", beat: "到达景区", camera: "static",
  landmark: null, kf_prompt: "", motion_prompt: "", duration_s: 1,
  candidates: [], kf_selected: null, clip: null, trim_start_s: null,
  status: "draft", regen_stage: null, bad_shot_reported: false, model: {},
} as Shot;

const episode = {
  name: "测试期", episode_id: "e_test", owner_id: "u_test", persona_id: "p_test",
  persona_version: 1, destination_id: "d_test", destination_version: 1,
  series_id: "s_test", template_id: "t_test", status: "done", mode: "per_shot",
  cut_policy: "fixed_1s", candidate_count: 2, created_at: "2026-09-23T00:00:00+08:00",
  estimated_credits: 10, credits_used: 12, share: { enabled: false, slug: "" },
  brief: { season: "秋", aspect: "9:16", requirements: "", duration_s: 30,
    tone: "松弛", outfit_override: null, banned: [] },
  grid_refs: [], scenes: [{ id: "s1", name: "到达", time: "morning", landmarks: [] }],
  shots: [shot], removed_shots: [], music: { file: "", bpm: 0, license: "" },
  render: { res: "1080x1920", fps: 30, title: "测试成片", intro: null,
    outro: null, ai_label: true },
} as Episode;

const mutation = { pending: false, error: null, clearError: () => {},
  run: async () => null } as EpisodeMutation;

function render(view: React.ReactNode): string {
  return renderToStaticMarkup(<StaticRouter location="/episodes/e_test">{view}</StaticRouter>);
}

test("review stages explain their next decision and link to matching help anchors", () => {
  const stages = [
    { html: render(<ScriptReview episode={episode} destination={null} mutation={mutation} />), anchor: "script", phrase: "按指令优化" },
    { html: render(<KeyframeReview episode={episode} destination={null} persona={null} mutation={mutation} />), anchor: "keyframes", phrase: "不做打分排序" },
    { html: render(<ClipReview episode={episode} mutation={mutation} />), anchor: "clips", phrase: "30 fps" },
    { html: render(<ComposeSetup episode={episode} mutation={mutation} />), anchor: "compose", phrase: "保存设置" },
    { html: render(<DoneView episode={episode} mutation={mutation} />), anchor: "deliver", phrase: "平台发布需要自行完成" },
    { html: render(<ProgressView episode={{ ...episode, status: "failed" }} mutation={mutation}
      failedTask={{ stage: "keyframe", shot_no: 1 }} />), anchor: "keyframes", phrase: "重新执行失败任务" },
  ];
  for (const { html, anchor, phrase } of stages) {
    expect(html).toContain(`href="/help#${anchor}"`);
    expect(html).toContain(phrase);
  }
});

test("stage banners leave candidate and platform mechanics beside their controls", () => {
  const keyframes = render(<KeyframeReview episode={episode} destination={null} persona={null} mutation={mutation} />);
  const done = render(<DoneView episode={episode} mutation={mutation} />);
  const keyframeBanner = keyframes.match(/<aside class="k-guide-tip">.*?<\/aside>/)?.[0] ?? "";
  const doneBanner = done.match(/<aside class="k-guide-tip">.*?<\/aside>/)?.[0] ?? "";
  expect(keyframeBanner).not.toContain("生成顺序");
  expect(doneBanner).not.toContain("平台按钮");
  expect(done).toContain("平台发布需要自行完成");
});

test("legacy clip and compose guidance does not promise fixed cuts or a duration estimate", () => {
  const legacy = { ...episode, cut_policy: "beat_aligned" } as Episode;
  const clips = render(<ClipReview episode={legacy} mutation={mutation} />);
  const compose = render(<ComposeSetup episode={legacy} mutation={mutation} />);
  expect(clips).toContain("旧版剪辑沿用原有选段长度");
  expect(clips).not.toContain("每镜严格截取 1 秒，起点按 30 fps 帧格调整");
  expect(compose).toContain("沿用旧项目的节拍切点");
  expect(compose).not.toContain("预计时长按当前镜头数和首尾设置计算");
});
