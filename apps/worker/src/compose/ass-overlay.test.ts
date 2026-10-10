import { expect, test } from "bun:test";
import type { ComposePlan } from "@kelvoy/engine";
import { buildAssOverlay, textOverlayEvents } from "./ass-overlay";
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

test("caption events follow reordered variable cuts, ignore blanks and stop before the outro", () => {
  const reordered = { ...plan, title: "", ai_label: false, cuts: [
    { ...plan.cuts[1]!, no: 7, trim_start_s: 2, duration_s: 1.5, caption: "中文\n第二行' : , {字符} \\ 路" },
    { ...plan.cuts[0]!, no: 2, duration_s: 0.8, caption: " \n " },
    { ...plan.cuts[1]!, no: 9, duration_s: 2, caption: "最后一镜" },
  ] };
  for (const intro of [0, 1.2]) {
    const events = textOverlayEvents(reordered, intro, 1);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ start_s: intro, end_s: intro + 1.5 });
    expect(events[1]!.start_s).toBeCloseTo(intro + 2.3);
    expect(events[1]!.end_s).toBeCloseTo(intro + 4.3);
    expect(buildAssOverlay(reordered, intro, 1)).toContain("中文\\N第二行");
  }
  expect(textOverlayEvents({ ...reordered, subtitles_enabled: false }, 1.2, 1)).toEqual([]);
});
