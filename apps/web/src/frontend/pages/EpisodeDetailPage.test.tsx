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
  expect(html).toContain(`失败阶段：${label} · 第 1 镜`);
  expect(html.match(/>重新执行失败任务<\/button>/g)).toHaveLength(1);
  expect(html).toContain("已通过 7 镜");
  expect(html).not.toContain("等 worker 自动重试");
  expect(html).toContain(`disabled="">${stage === "keyframe" ? "直接重生成" : "标记重生成"}</button>`);
});

test.each(["kf_review", "clip_review"] as const)("%s hides duplicate retry when queued or unavailable", (status) => {
  const episode = { ...fixture("e_queued", "u_1"), status,
    shots: [shotFixture(1, { status: "failed" })] };
  const render = (shots = episode.shots) => renderToStaticMarkup(<StaticRouter location="/episodes/e_queued">
    <EpisodeDetailContent episode={{ ...episode, shots }} destination={null} persona={null}
      failedTask={null} mutation={mutation} />
  </StaticRouter>);
  expect(render()).toContain("等待后台处理");
  expect(render()).not.toContain("重新执行失败任务</button>");
  expect(render([shotFixture(1, { status: "approved" })])).not.toContain("等待后台处理");
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
