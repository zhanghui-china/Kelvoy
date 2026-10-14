/**
 * 合成的音频滤镜片段（保留片段原声）。纯函数，和 ./ffmpeg-args.ts 一样不碰磁盘。
 *
 * 每个片段、片头、片尾都产出一条与画面等长的立体声 48 kHz 音频，再和视频一起走 concat（a=1）：
 * 有音轨就按画面同样的窗口截取，不够长补静音、过长截断，没有音轨就整段静音。
 * 这样音画不会随镜头数累积错位。
 */

/** 各输入是否带音轨（ffprobe 结果）；存在即表示本次合成保留原声。 */
export interface OriginalAudioInputs {
  /** 与 plan.cuts 同序同长。 */
  clips: boolean[];
  intro: boolean;
  outro: boolean;
}

export const AUDIO_RATE = 48000;
const EDGE_FADE_S = 0.02;
/** 原声与配乐同时开启时配乐的音量；先用固定值，等听感反馈再决定是否需要动态闪避。 */
export const MUSIC_VOLUME_UNDER_ORIGINAL = 0.3;

function seconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * 一段音频。trim 只在帧窗口模式给出（输入没有 -ss/-t，要按和视频 trim 同源的时间窗取）；
 * 旧版节拍模式输入侧已经截好，只需对齐时长。
 */
export function segmentAudioFilter(input: number, label: string, hasAudio: boolean, durationS: number,
  trim?: { start_s: number; end_s: number }): string {
  const d = seconds(durationS);
  if (!hasAudio) return `anullsrc=r=${AUDIO_RATE}:cl=stereo:d=${d}[${label}]`;
  const window = trim ? `atrim=${seconds(trim.start_s)}:${seconds(trim.end_s)},asetpts=PTS-STARTPTS,` : "";
  const edge = Math.min(EDGE_FADE_S, d / 2);
  return `[${input}:a]${window}aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,` +
    `apad=whole_dur=${d},atrim=0:${d},afade=t=in:d=${edge},afade=t=out:st=${seconds(d - edge)}:d=${edge}[${label}]`;
}

/** 配乐循环后截到全片长度；与原声混音时压低音量，混完防削波并做 1 秒淡出。 */
export function musicFilter(musicIndex: number, totalS: number, fadeS: number, original: boolean): string {
  const fadeStart = seconds(Math.max(0, totalS - fadeS));
  const music = `[${musicIndex}:a]atrim=0:${totalS},asetpts=N/SR/TB`;
  if (!original) return `${music},afade=t=out:st=${fadeStart}:d=${fadeS}[aout]`;
  // normalize=0：保持两路原有电平，不让 amix 按路数把原声整体压低。
  return `${music},volume=${MUSIC_VOLUME_UNDER_ORIGINAL}[amusic];` +
    `[acat][amusic]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95,` +
    `afade=t=out:st=${fadeStart}:d=${fadeS}[aout]`;
}
