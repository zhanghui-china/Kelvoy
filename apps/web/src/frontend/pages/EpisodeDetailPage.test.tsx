import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { fixture, shotFixture } from "../../server/routes/episode-test-fixtures";
import type { EpisodeMutation } from "../review/useEpisodeMutation";
import { EpisodeDetailContent } from "./EpisodeDetailPage";

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
