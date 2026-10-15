import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { fixture, shotFixture } from "../../server/routes/episode-test-fixtures";
import type { EpisodeMutation } from "../review/useEpisodeMutation";
import { EpisodeDetailContent } from "./EpisodeDetailPage";

const mutation = { pending: false, error: null, clearError: () => {}, run: async () => null } as EpisodeMutation;

test.each([
  ["kf_review", "keyframe", "关键帧", "审核 2 · 关键帧"],
  ["clip_review", "video", "视频片段", "审核 3 · 片段"],
  ["keyframing", "keyframe", "关键帧", "审核 2 · 关键帧"],
  ["clipping", "video", "视频片段", "审核 3 · 片段"],
] as const)("%s retains review and shows exactly one failed-shot retry", (status, stage, label, review) => {
  const episode = { ...fixture("e_review_retry", "u_1"), status,
    shots: Array.from({ length: 8 }, (_, i) => shotFixture(i + 1, {
      status: i === 0 ? "failed" : "approved", candidates: [`kf/${i + 1}.png`],
      kf_selected: `kf/${i + 1}.png`, clip: `clip/${i + 1}.mp4`,
    })) };
  const html = renderToStaticMarkup(<StaticRouter location="/episodes/e_review_retry">
    <EpisodeDetailContent episode={episode} destination={null} persona={null}
      failedTask={{ stage, shot_no: 1 }} mutation={mutation} />
  </StaticRouter>);
  expect(html).toContain(review);
  expect(html).toContain("删除作品</button>");
  expect(html).toContain(`失败阶段：${label} · 第 1 镜`);
  expect(html.match(/>重新执行失败任务<\/button>/g)).toHaveLength(1);
  expect(html).toContain("已通过 7 镜");
  expect(html).not.toContain("等 worker 自动重试");
  expect(html).toContain(`disabled="">${stage === "keyframe" ? "直接重生成" : "标记重生成"}</button>`);
});

test.each(["kf_review", "clip_review"] as const)("%s keeps retry reachable without a task record", (status) => {
  const episode = { ...fixture("e_queued", "u_1"), status,
    shots: [shotFixture(1, { status: "failed" })] };
  const render = (shots = episode.shots) => renderToStaticMarkup(<StaticRouter location="/episodes/e_queued">
    <EpisodeDetailContent episode={{ ...episode, shots }} destination={null} persona={null}
      failedTask={null} mutation={mutation} />
  </StaticRouter>);
  expect(render()).toContain(">重新执行失败任务</button>");
  expect(render()).toContain(">重试这一镜</button>");
  expect(render()).not.toContain("当前没有可重试的失败任务");
  expect(render([shotFixture(1, { status: "approved" })])).not.toContain("重试这一镜");
  expect(render([shotFixture(1, { status: "approved" })])).not.toContain("生成失败，可在");
});

test("episode detail passes failed shot summary into the progress view", () => {
  const episode = { ...fixture("e_failed_shot", "u_1"), status: "clipping" as const,
    shots: [shotFixture(5, { status: "failed" })] };
  const mutation = { pending: false, error: null, clearError: () => {}, run: async () => null } as EpisodeMutation;
  const html = renderToStaticMarkup(<StaticRouter location="/episodes/e_failed_shot">
    <EpisodeDetailContent episode={episode} destination={null} persona={null}
      failedTask={{ stage: "video", shot_no: 5 }} mutation={mutation} />
  </StaticRouter>);
  expect(html).toContain("失败阶段：视频片段 · 第 5 镜");
  expect(html).toContain("重新执行失败任务");
});

test.each([
  ["references", true],
  ["keyframe", false],
  [undefined, false],
] as const)("direct-mode hint for video_source=%s: shown=%s", (videoSource, shown) => {
  const base = { ...fixture("e_direct_hint", "u_1"), status: "script_review" as const, shots: [shotFixture(1, {})] };
  const { video_source: _omit, ...rest } = base;
  const episode = (videoSource === undefined ? rest : { ...rest, video_source: videoSource }) as typeof base;
  const html = renderToStaticMarkup(<StaticRouter location="/episodes/e_direct_hint">
    <EpisodeDetailContent episode={episode} destination={null} persona={null} mutation={mutation} />
  </StaticRouter>);
  const hint = "本期为直出模式，无关键帧审核；如需选图，请新建时选择关键帧方式。";
  expect(html.split(hint).length - 1).toBe(shown ? 1 : 0);
});

test("failure summary above review links to the progress area and counts failed shots", () => {
  const episode = { ...fixture("e_summary", "u_1"), status: "clip_review" as const,
    shots: [shotFixture(1, { status: "failed" }), shotFixture(2, { status: "approved" }), shotFixture(3, { status: "failed" })] };
  const html = renderToStaticMarkup(<StaticRouter location="/episodes/e_summary">
    <EpisodeDetailContent episode={episode} destination={null} persona={null}
      failedTask={{ stage: "video", shot_no: 1 }} failedTasks={[{ stage: "video", shot_no: 1 }, { stage: "video", shot_no: 3 }]}
      mutation={mutation} />
  </StaticRouter>);
  expect(html).toContain("有 2 镜生成失败");
  expect(html).toContain('href="#failure-retry"');
  expect(html).toContain('id="failure-retry"');
  expect(html).toContain(">重试全部失败镜头（2）</button>");
  expect(html.indexOf("有 2 镜生成失败")).toBeLessThan(html.indexOf("审核 3 · 片段"));
});

test("healthy episode shows no failure summary or per-shot retry", () => {
  const episode = { ...fixture("e_ok", "u_1"), status: "clip_review" as const,
    shots: [shotFixture(1, { status: "clip_ready" })] };
  const html = renderToStaticMarkup(<StaticRouter location="/episodes/e_ok">
    <EpisodeDetailContent episode={episode} destination={null} persona={null} mutation={mutation} />
  </StaticRouter>);
  expect(html).not.toContain("生成失败，可在");
  expect(html).not.toContain("重试这一镜");
});

test.each([
  ["script_review", "script"],
  ["kf_review", "keyframes"],
  ["clip_review", "clips"],
  ["compose_ready", "compose"],
  ["done", "compose"],
] as const)("%s shows the storyboard editor inside the stage card, not at the page bottom", (status) => {
  const episode = { ...fixture("e_editor", "u_1"), status, mode: "per_shot" as const,
    shots: [shotFixture(1, { status: "approved", candidates: ["kf/1.png"], kf_selected: "kf/1.png", clip: "clip/1.mp4" })] };
  const html = renderToStaticMarkup(<StaticRouter location="/episodes/e_editor">
    <EpisodeDetailContent episode={episode} destination={null} persona={null} mutation={mutation} />
  </StaticRouter>);
  expect(html.match(/aria-label="自由分镜编辑"/g)).toHaveLength(1);
  expect(html).not.toContain("编辑分镜 ·");
});

test("storyboard editor is absent for grid mode and for statuses before the storyboard exists", () => {
  for (const [status, mode] of [["script_review", "grid"], ["scripting", "per_shot"]] as const) {
    const episode = { ...fixture("e_no_editor", "u_1"), status, mode, shots: [] };
    const html = renderToStaticMarkup(<StaticRouter location="/episodes/e_no_editor">
      <EpisodeDetailContent episode={episode} destination={null} persona={null} mutation={mutation} />
    </StaticRouter>);
    expect(html).not.toContain("自由分镜编辑");
  }
});
