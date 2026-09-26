import type { ComposePlan } from "@kelvoy/engine";

/**
 * 把 engine 的 ComposePlan 翻译成一条 ffmpeg 命令行（M1-13, FR-07）。
 *
 * 纯函数、不碰磁盘、不 spawn——路径解析、存在性检查、探测片头片尾时长都在
 * ./ffmpeg.ts 做完再传进来。这样没装 ffmpeg 的环境（CI）也能把参数拼装逻辑
 * 完整测掉。
 */

/** 已解析成绝对路径、且已确认存在的输入。 */
export interface ComposeInputPaths {
  /** 与 plan.cuts 同序同长。 */
  clips: string[];
  intro: string | null;
  outro: string | null;
  music: string | null;
  lut: string | null;
  output: string;
  /** CJK 字体文件；plan 需要 drawtext（标题或 AI 标识）时必须有。 */
  font: string | null;
  /** ffprobe 量出来的片头/片尾时长，没有片头片尾时为 0。 */
  intro_duration_s: number;
  outro_duration_s: number;
}

const AUDIO_FADE_OUT_S = 1;
const TITLE_HOLD_S = 2;

function roundMs(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/**
 * ffmpeg 的两级转义（见 ffmpeg-filters(1) "Notes on filtergraph escaping"）：
 * 先转义滤镜参数级的 `:`，再转义 filtergraph 级的 `,` `;` `[` `]` `'` 和反斜杠。
 * 刻意不用单引号包裹——ffmpeg 的引号内不再处理反斜杠转义，混用容易出错。
 */
function escapeFilterValue(value: string): string {
  const optionLevel = value.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  return optionLevel.replace(/[\\',;:[\]]/g, (char) => `\\${char}`);
}

/** 所有视频输入统一成 9:16 目标分辨率和目标帧率，再进 concat。 */
function normalizeChain(plan: ComposePlan): string {
  const { w, h } = plan.res;
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${plan.fps},setsar=1`;
}

/**
 * 标题（PRD FR-07：目的地名，前 2 秒）。
 *
 * title_style 目前只有 "serif-center" 一种取值（Persona.style.title_style /
 * Template.title_style），其它取值先按同样的顶部居中处理——等真出现第二种
 * 样式时再在这里分支，不提前抽象。字体由 KELVOY_FONT_FILE 指定，serif 与否
 * 取决于那个文件本身。
 */
function titleDrawtext(plan: ComposePlan, font: string): string {
  const fontsize = Math.round(plan.res.w / 17);
  return [
    `drawtext=fontfile=${escapeFilterValue(font)}`,
    `text=${escapeFilterValue(plan.title)}`,
    "expansion=none",
    `fontsize=${fontsize}`,
    "fontcolor=white",
    "borderw=3",
    "bordercolor=black@0.6",
    "x=(w-text_w)/2",
    `y=${Math.round(plan.res.h * 0.12)}`,
    `enable=between(t\\,0\\,${TITLE_HOLD_S})`,
  ].join(":");
}

/** 显式 AI 标识（PRD §8）：右下角半透明文字，全程显示。 */
function aiLabelDrawtext(plan: ComposePlan, font: string): string {
  const fontsize = Math.round(plan.res.w / 30);
  return [
    `drawtext=fontfile=${escapeFilterValue(font)}`,
    `text=${escapeFilterValue(plan.ai_label_text)}`,
    "expansion=none",
    `fontsize=${fontsize}`,
    "fontcolor=white@0.75",
    "box=1",
    "boxcolor=black@0.35",
    "boxborderw=12",
    `x=w-text_w-${Math.round(plan.res.w * 0.045)}`,
    `y=h-text_h-${Math.round(plan.res.h * 0.04)}`,
  ].join(":");
}

export function buildFfmpegArgs(plan: ComposePlan, paths: ComposeInputPaths): string[] {
  if (plan.cuts.length === 0) {
    throw new Error("没有镜头可以合成");
  }
  if (plan.cuts.length !== paths.clips.length) {
    throw new Error(`片段路径数量（${paths.clips.length}）与切割表（${plan.cuts.length}）对不上`);
  }
  const needsText = plan.title !== "" || plan.ai_label;
  if (needsText && !paths.font) {
    throw new Error(
      "合成需要 drawtext 渲染中文（标题 / AI 标识），请把环境变量 KELVOY_FONT_FILE 指向一个 CJK 字体文件",
    );
  }

  const args: string[] = ["-y"];
  const filters: string[] = [];
  const concatLabels: string[] = [];
  let inputIndex = 0;

  if (paths.intro !== null) {
    args.push("-i", paths.intro);
    filters.push(`[${inputIndex}:v]${normalizeChain(plan)}[vintro]`);
    concatLabels.push("[vintro]");
    inputIndex += 1;
  }

  // LUT 只作用于正片：片头片尾是模板成品，已经调好色，再过一遍账号 LUT 会
  // 把品牌色带偏（PRD FR-07 说的是"账号级统一 LUT"，指的是生成内容）。
  const lutChain = paths.lut !== null ? `,lut3d=file=${escapeFilterValue(paths.lut)}` : "";
  plan.cuts.forEach((cut, i) => {
    if (cut.trim_start_frame !== undefined && cut.frame_count !== undefined) {
      // Normalize to the output frame rate first, then take exactly one
      // integer-frame window. Input-side -ss/-t can yield 29/31 frames.
      args.push("-i", paths.clips[i]!);
      filters.push(`[${inputIndex}:v]${normalizeChain(plan)},trim=start_frame=${cut.trim_start_frame}:end_frame=${cut.trim_start_frame + cut.frame_count},setpts=PTS-STARTPTS${lutChain}[vcut${i}]`);
    } else {
      // Legacy beat-aligned projects retain their original trim policy.
      args.push("-ss", String(cut.trim_start_s), "-t", String(cut.duration_s), "-i", paths.clips[i]!);
      filters.push(`[${inputIndex}:v]${normalizeChain(plan)}${lutChain}[vcut${i}]`);
    }
    concatLabels.push(`[vcut${i}]`);
    inputIndex += 1;
  });

  if (paths.outro !== null) {
    args.push("-i", paths.outro);
    filters.push(`[${inputIndex}:v]${normalizeChain(plan)}[voutro]`);
    concatLabels.push("[voutro]");
    inputIndex += 1;
  }

  let musicIndex: number | null = null;
  if (paths.music !== null) {
    // 曲子比成片短就循环，长就被下面的 atrim 截断。
    args.push("-stream_loop", "-1", "-i", paths.music);
    musicIndex = inputIndex;
    inputIndex += 1;
  }

  filters.push(`${concatLabels.join("")}concat=n=${concatLabels.length}:v=1:a=0[vcat]`);

  // 标题和 AI 标识加在拼接**之后**：标识要覆盖全片（片头片尾也算 AI 生成内容）。
  let videoLabel = "[vcat]";
  if (plan.title !== "") {
    filters.push(`${videoLabel}${titleDrawtext(plan, paths.font!)}[vtitle]`);
    videoLabel = "[vtitle]";
  }
  if (plan.ai_label) {
    filters.push(`${videoLabel}${aiLabelDrawtext(plan, paths.font!)}[vlabel]`);
    videoLabel = "[vlabel]";
  }

  const totalDurationS = roundMs(
    paths.intro_duration_s +
      paths.outro_duration_s +
      plan.cuts.reduce((sum, cut) => sum + cut.duration_s, 0),
  );
  if (musicIndex !== null) {
    const fadeStartS = roundMs(Math.max(0, totalDurationS - AUDIO_FADE_OUT_S));
    filters.push(
      `[${musicIndex}:a]atrim=0:${totalDurationS},asetpts=N/SR/TB,afade=t=out:st=${fadeStartS}:d=${AUDIO_FADE_OUT_S}[aout]`,
    );
  }

  args.push("-filter_complex", filters.join(";"), "-map", videoLabel);
  if (musicIndex !== null) {
    args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-an");
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(plan.fps),
    // use_metadata_tags：把下面那些非标准的 kelvoy_* 键原样写进 mp4 容器，
    // 否则 mov 封装器会把认不出来的键丢掉（隐式 AI 标识层，PRD §8）。
    "-movflags",
    "+faststart+use_metadata_tags",
  );
  for (const [key, value] of Object.entries(plan.metadata)) {
    args.push("-metadata", `${key}=${value}`);
  }
  args.push(paths.output);

  return args;
}
