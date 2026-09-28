import { expect, test } from "bun:test";
import type { Episode } from "@kelvoy/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import DoneView from "./DoneView";
import type { EpisodeMutation } from "./useEpisodeMutation";

const episode = {
  name: "旧作品", episode_id: "e_test", status: "done", mode: "grid",
  brief: { aspect: "9:16" }, render: { title: "测试成片" },
  shots: [], share: { enabled: false, slug: "" }, credits_used: 0,
  estimated_credits: 0,
} as Episode;

const mutation = { pending: false, error: null, run: async () => null } as EpisodeMutation;
const render = (value: Episode) => renderToStaticMarkup(
  <StaticRouter location="/episodes/e_test"><DoneView episode={value} mutation={mutation} /></StaticRouter>,
);

test("delivery uses recorded film ratio and preserves legacy download without metadata", () => {
  const final = { key: "final/e_test-v2.mp4", width: 1920, height: 1080,
    fps: 30, duration_s: 25, size_bytes: 1024 * 1024, completed_at: "2026-09-28T00:00:00Z" };
  const delivered = render({ ...episode, final } as Episode);
  expect(delivered).toContain("aspect-ratio:1920/1080");
  expect(delivered).toContain("final/e_test-v2.mp4");
  expect(delivered).toContain("下载 MP4 成片");
  const legacy = render(episode);
  expect(legacy).toContain("旧版作品未记录成片规格");
  expect(legacy).toContain("下载 MP4 成片");
});
