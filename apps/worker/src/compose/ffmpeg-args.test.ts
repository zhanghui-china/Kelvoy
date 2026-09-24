import { expect, test } from "bun:test";
import type { ComposePlan } from "@kelvoy/engine";
import { buildFfmpegArgs, type ComposeInputPaths } from "./ffmpeg-args";

function planFixture(overrides: Partial<ComposePlan> = {}): ComposePlan {
  return {
    episode_id: "e_1",
    output_key: "final/e_1.mp4",
    cuts: [
      { no: 1, clip_key: "clip/01.mp4", trim_start_s: 0, duration_s: 1.429 },
      { no: 2, clip_key: "clip/02.mp4", trim_start_s: 0.5, duration_s: 1.429 },
    ],
    music: { file_key: "music/calm_morning.mp3", bpm: 84, license: "CC0-1.0" },
    lut_key: "lut/warm_film.cube",
    intro_key: "intro/default.mp4",
    outro_key: "outro/default.mp4",
    title: "黄山",
    title_style: "serif-center",
    ai_label: true,
    ai_label_text: "AI 生成 · 虚构角色 · 真实目的地",
    metadata: { comment: "AI 生成 · 虚构角色 · 真实目的地", ai_generated: "true" },
    res: { w: 1080, h: 1920 },
    fps: 30,
    ...overrides,
  };
}

function pathsFixture(overrides: Partial<ComposeInputPaths> = {}): ComposeInputPaths {
  return {
    clips: ["/p/e_1/clip/01.mp4", "/p/e_1/clip/02.mp4"],
    intro: "/p/intro/default.mp4",
    outro: "/p/outro/default.mp4",
    music: "/p/music/calm_morning.mp3",
    lut: "/p/lut/warm_film.cube",
    output: "/p/e_1/final/e_1.mp4",
    font: "/fonts/NotoSansCJK.ttc",
    intro_duration_s: 1.5,
    outro_duration_s: 2,
    ...overrides,
  };
}

function filterGraph(args: string[]): string {
  return args[args.indexOf("-filter_complex") + 1]!;
}

test("buildFfmpegArgs cuts each shot with -ss/-t before its input", () => {
  const args = buildFfmpegArgs(planFixture(), pathsFixture());
  const joined = args.join(" ");
  expect(joined).toContain("-ss 0 -t 1.429 -i /p/e_1/clip/01.mp4");
  expect(joined).toContain("-ss 0.5 -t 1.429 -i /p/e_1/clip/02.mp4");
  expect(args[args.length - 1]).toBe("/p/e_1/final/e_1.mp4");
});

test("buildFfmpegArgs normalizes every input to the plan's 9:16 target and concats intro+cuts+outro", () => {
  const graph = filterGraph(buildFfmpegArgs(planFixture(), pathsFixture()));
  expect(graph).toContain("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1");
  expect(graph).toContain("[vintro][vcut0][vcut1][voutro]concat=n=4:v=1:a=0[vcat]");
});

test("buildFfmpegArgs applies the LUT to the body only, never to intro/outro", () => {
  const graph = filterGraph(buildFfmpegArgs(planFixture(), pathsFixture()));
  expect(graph).toContain("lut3d=file=/p/lut/warm_film.cube[vcut0]");
  expect(graph).toContain("setsar=1[vintro]");
  expect(graph).toContain("setsar=1[voutro]");
});

test("buildFfmpegArgs omits the LUT chain entirely when the persona has none", () => {
  const graph = filterGraph(buildFfmpegArgs(planFixture({ lut_key: null }), pathsFixture({ lut: null })));
  expect(graph).not.toContain("lut3d");
});

test("buildFfmpegArgs concats only the cuts when there's no intro/outro", () => {
  const graph = filterGraph(
    buildFfmpegArgs(
      planFixture({ intro_key: null, outro_key: null }),
      pathsFixture({ intro: null, outro: null, intro_duration_s: 0, outro_duration_s: 0 }),
    ),
  );
  expect(graph).toContain("[vcut0][vcut1]concat=n=2:v=1:a=0[vcat]");
});

test("buildFfmpegArgs draws the title for the first 2s and the AI label for the whole film", () => {
  const args = buildFfmpegArgs(planFixture(), pathsFixture());
  const graph = filterGraph(args);
  expect(graph).toContain("[vcat]drawtext=fontfile=/fonts/NotoSansCJK.ttc:text=黄山");
  expect(graph).toContain("enable=between(t\\,0\\,2)[vtitle]");
  expect(graph).toContain("[vtitle]drawtext=");
  expect(graph).toContain("text=AI 生成 · 虚构角色 · 真实目的地");
  expect(graph).toContain("[vlabel]");
  expect(args).toContain("[vlabel]");
});

test("buildFfmpegArgs maps the bare concat output when there's no title and no AI label", () => {
  const args = buildFfmpegArgs(planFixture({ title: "", ai_label: false }), pathsFixture({ font: null }));
  expect(filterGraph(args)).not.toContain("drawtext");
  expect(args[args.indexOf("-map") + 1]).toBe("[vcat]");
});

test("buildFfmpegArgs refuses to render CJK text without a font file", () => {
  expect(() => buildFfmpegArgs(planFixture(), pathsFixture({ font: null }))).toThrow("KELVOY_FONT_FILE");
});

test("buildFfmpegArgs loops the music and trims it to intro + cuts + outro with a fade-out", () => {
  const args = buildFfmpegArgs(planFixture(), pathsFixture());
  expect(args.join(" ")).toContain("-stream_loop -1 -i /p/music/calm_morning.mp3");
  // 1.5 + 1.429 + 1.429 + 2 = 6.358
  expect(filterGraph(args)).toContain("atrim=0:6.358,asetpts=N/SR/TB,afade=t=out:st=5.358:d=1[aout]");
  expect(args).toContain("[aout]");
});

test("buildFfmpegArgs renders silent when the plan has no track", () => {
  const args = buildFfmpegArgs(planFixture({ music: null }), pathsFixture({ music: null }));
  expect(args).toContain("-an");
  expect(filterGraph(args)).not.toContain("atrim");
});

test("buildFfmpegArgs writes every metadata key with use_metadata_tags (implicit AI label)", () => {
  const args = buildFfmpegArgs(planFixture(), pathsFixture());
  expect(args.join(" ")).toContain("-movflags +faststart+use_metadata_tags");
  expect(args).toContain("comment=AI 生成 · 虚构角色 · 真实目的地");
  expect(args).toContain("ai_generated=true");
});

test("buildFfmpegArgs escapes filtergraph specials in the title", () => {
  const graph = filterGraph(buildFfmpegArgs(planFixture({ title: "西湖: 断桥, 雷峰塔" }), pathsFixture()));
  // 两级转义（ffmpeg-filters "Notes on filtergraph escaping"）：`:` -> `\\\:`，
  // `,` -> `\,`，否则会被当成滤镜参数/滤镜之间的分隔符。
  expect(graph).toContain("text=西湖\\\\\\: 断桥\\, 雷峰塔");
  expect(graph).toContain("expansion=none");
});

test("buildFfmpegArgs rejects a paths/cuts length mismatch", () => {
  expect(() => buildFfmpegArgs(planFixture(), pathsFixture({ clips: ["/p/e_1/clip/01.mp4"] }))).toThrow(
    "对不上",
  );
});
