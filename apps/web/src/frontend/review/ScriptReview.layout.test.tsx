import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Episode } from "@kelvoy/engine";
import ScriptReview from "./ScriptReview";
import { StaticRouter } from "react-router-dom/server";
import type { EpisodeMutation } from "./useEpisodeMutation";

test("script review exposes two columns, CSV export, and existing review actions", () => {
  const episode = { episode_id: "e1", name: "测试", shots: [{ no: 1, scene: "s", size: "wide", camera: "static", landmark: null, beat: "动作", kf_prompt: "" }], scenes: [], video_source: "references" } as unknown as Episode;
  const mutation = { pending: false, error: null, run: async () => null } as unknown as EpisodeMutation;
  const html = renderToStaticMarkup(<StaticRouter location="/episodes/e1"><ScriptReview episode={episode} destination={null} mutation={mutation} /></StaticRouter>);
  expect(html).toContain('class="k-desk-script-layout"');
  expect(html).toContain("导出脚本 CSV");
  expect(html).toContain("脚本助手");
  expect(html).toContain("继续 → 用人物与场景生成视频");
  expect(html).toContain("下限 24 镜");
});

test("pending script revision keeps actions disabled and preserves error notice", () => {
  const episode = { episode_id: "e1", name: "测试", shots: [], scenes: [], video_source: "references", script_pending_task_id: "task1", script_action_error: "优化失败，已保留原脚本" } as unknown as Episode;
  const mutation = { pending: false, error: null, run: async () => null } as unknown as EpisodeMutation;
  const html = renderToStaticMarkup(<StaticRouter location="/episodes/e1"><ScriptReview episode={episode} destination={null} mutation={mutation} /></StaticRouter>);
  expect(html).toContain("脚本正在处理中");
  expect(html).toContain("优化失败，已保留原脚本");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>重新生成<\/button>/);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>继续 → 用人物与场景生成视频<\/button>/);
});
