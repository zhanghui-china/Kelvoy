import { expect, test } from "bun:test";
import type { ComposePlan } from "@kelvoy/engine";
import { buildAssOverlay } from "./ass-overlay";
import { buildFfmpegArgs, type ComposeInputPaths } from "./ffmpeg-args";

const plan = {
  episode_id: "e_1", output_key: "final/e_1_v1.mp4", res: { w: 1080, h: 1920 }, fps: 30,
  cuts: [
    { no: 1, clip_key: "clip/1.mp4", trim_start_s: 0, duration_s: 1, caption: "第一镜" },
    { no: 2, clip_key: "clip/2.mp4", trim_start_s: 0, duration_s: 1, caption: "第二镜" },
  ],
  music: null, lut_key: null, intro_key: "intro/a.mp4", outro_key: null,
  title: "无锡{测试}", title_style: "serif-center", ai_label: true,
  ai_label_text: "AI 生成", metadata: {}, subtitles_enabled: true,
} satisfies ComposePlan;

test("ASS overlay times subtitles after the intro and keeps title/label on the full timeline", () => {
  const ass = buildAssOverlay(plan, 2, 0);
  expect(ass).toContain("0:00:02.00,0:00:03.00,Caption");
  expect(ass).toContain("0:00:03.00,0:00:04.00,Caption");
  expect(ass).toContain("0:00:00.00,0:00:02.00,Title");
  expect(ass).toContain("0:00:00.00,0:00:04.00,Label");
  expect(ass).toContain("无锡测试");
});

test("ffmpeg uses the ASS overlay once after concat when provided", () => {
  const paths: ComposeInputPaths = {
    clips: ["/p/e/clip/1.mp4", "/p/e/clip/2.mp4"], intro: "/p/intro/a.mp4",
    outro: null, music: null, lut: null, output: "/p/e/final/e_v1.mp4",
    font: null, overlay_ass: "/p/e/final/overlay.ass", intro_duration_s: 2, outro_duration_s: 0,
  };
  const args = buildFfmpegArgs(plan, paths);
  const graph = args[args.indexOf("-filter_complex") + 1]!;
  expect(graph).toContain("[vcat]ass=filename=/p/e/final/overlay.ass[vtext]");
  expect(graph).not.toContain("drawtext");
});
