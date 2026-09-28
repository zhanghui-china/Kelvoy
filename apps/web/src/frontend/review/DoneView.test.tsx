import { expect, test } from "bun:test";
import type { Episode } from "@kelvoy/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import DoneView from "./DoneView";
import type { EpisodeMutation } from "./useEpisodeMutation";

const episode: Episode = {
  name: "旧作品", episode_id: "e_test", owner_id: "u_test",
  persona_id: "p_test", persona_version: 1,
  destination_id: "d_test", destination_version: 1,
  series_id: "s_test", template_id: "t_test", status: "done", mode: "grid",
  candidate_count: 2, created_at: "2026-09-28T00:00:00Z",
  brief: { season: "秋", aspect: "9:16", requirements: "", duration_s: 30,
    tone: "松弛", outfit_override: null, banned: [] },
  render: { res: "1080x1920", fps: 30, title: "测试成片",
    intro: null, outro: null, ai_label: true },
  shots: [], removed_shots: [], scenes: [], grid_refs: [],
  music: { file: "", bpm: 0, license: "" },
  share: { enabled: false, slug: "" }, credits_used: 0, estimated_credits: 0,
};

const mutation: EpisodeMutation = { pending: false, error: null,
  clearError: () => {}, run: async () => null };
const render = (value: Episode) => renderToStaticMarkup(
  <StaticRouter location="/episodes/e_test"><DoneView episode={value} mutation={mutation} /></StaticRouter>,
);

test("delivery uses recorded film ratio and preserves legacy download without metadata", () => {
  const final = { version: 2, key: "final/e_test-v2.mp4", width: 1920, height: 1080,
    fps: 30, duration_s: 25, size_bytes: 1024 * 1024, completed_at: "2026-09-28T00:00:00Z" };
  const delivered = render({ ...episode, final });
  expect(delivered).toContain("aspect-ratio:1920/1080");
  expect(delivered).toContain("final/e_test-v2.mp4");
  expect(delivered).toContain("下载 MP4 成片");
  const legacy = render(episode);
  expect(legacy).toContain("旧版作品未记录成片规格");
  expect(legacy).toContain("下载 MP4 成片");
});
