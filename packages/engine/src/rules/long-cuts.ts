import type { Shot } from "../schema/episode";
import type { ComposeMediaDurations } from "../providers/types";
import type { ShotCut } from "./beat";

/** Deterministic input failure: user must change material or the film budget. */
export class CompositionConstraintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompositionConstraintError";
  }
}

const EPSILON = 1e-7;

/** Full output frames only; never invent the tail of a source video. */
export function mediaFrameCount(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new CompositionConstraintError("素材探测时长无效");
  }
  return Math.floor(seconds * fps + EPSILON);
}

type Choice = { penalty: number; frames: number; previous: Choice | null };

/**
 * Restore c7a783a's joint allocation, using output frames and actual remaining
 * media instead of millisecond cuts or shot quotas. Boundaries follow the music
 * grid on the film timeline (including the intro), rounded to an output frame.
 * Among feasible paths, total-duration error wins, then squared suggestion error.
 */
export function planLongCuts(
  shots: Shot[], bpm: number, targetS: number, media: ComposeMediaDurations, fps: number,
): ShotCut[] {
  if (!Number.isInteger(fps) || fps <= 0 || !Number.isFinite(targetS) || targetS <= 0) {
    throw new CompositionConstraintError("成片时长预算或帧率无效");
  }
  if (!shots.length || new Set(shots.map(s => s.no)).size !== shots.length) {
    throw new CompositionConstraintError("长镜合成需要非空且镜号唯一的故事板");
  }
  const leadFrames = mediaFrameCount(media.intro_duration_s, fps);
  const tailFrames = mediaFrameCount(media.outro_duration_s, fps);
  const bodyTarget = targetS * fps - leadFrames - tailFrames;
  const tolerance = 0.5 * fps;
  const minFrames = Math.ceil(3 * fps);
  const windows = shots.map(shot => {
    if (shot.status !== "approved" || !shot.clip) {
      throw new CompositionConstraintError(`第 ${shot.no} 镜尚未批准或缺少片段`);
    }
    const startS = shot.trim_start_s ?? 0;
    if (!Number.isFinite(startS) || startS < 0 ||
        !Number.isFinite(shot.duration_s) || shot.duration_s <= 0) {
      throw new CompositionConstraintError(`第 ${shot.no} 镜选段起点或建议时长无效`);
    }
    // Round forward so the selected start never exposes earlier source material.
    const start = Math.ceil(startS * fps - EPSILON);
    const sourceS = media.clip_duration_s[shot.no];
    if (!Number.isFinite(sourceS) || sourceS! <= 0) {
      throw new CompositionConstraintError(`第 ${shot.no} 镜素材探测时长无效`);
    }
    const max = Math.min(6 * fps, mediaFrameCount(sourceS!, fps) - start);
    if (max < minFrames) {
      throw new CompositionConstraintError(`第 ${shot.no} 镜选段后素材不足 3 秒，请更换素材或调整起点`);
    }
    return { start, max, suggested: Math.min(6, Math.max(3, shot.duration_s)) * fps };
  });
  const suffixMax = new Array<number>(shots.length + 1).fill(0);
  for (let i = shots.length - 1; i >= 0; i--) suffixMax[i] = suffixMax[i + 1]! + windows[i]!.max;
  if (bodyTarget + tolerance < shots.length * minFrames || bodyTarget - tolerance > suffixMax[0]!) {
    throw new CompositionConstraintError(`素材长度与片头片尾时长预算冲突，无法满足每镜 3–6 秒、成片 ${targetS}±0.5 秒`);
  }
  const framesPerBeat = Number.isFinite(bpm) && bpm > 0 ? 60 * fps / bpm : null;
  const onBeat = (frame: number) => framesPerBeat === null ||
    Math.abs(frame - Math.round(frame / framesPerBeat) * framesPerBeat) <= 0.5 + EPSILON;
  let states = new Map<number, Choice>([[0, { penalty: 0, frames: 0, previous: null }]]);
  for (let i = 0; i < windows.length; i++) {
    const window = windows[i]!;
    const remaining = windows.length - i - 1;
    const next = new Map<number, Choice>();
    for (const [sum, choice] of states) {
      const low = Math.max(minFrames, Math.ceil(bodyTarget - tolerance - sum - suffixMax[i + 1]!));
      const high = Math.min(window.max, Math.floor(bodyTarget + tolerance - sum - remaining * minFrames));
      for (let frames = low; frames <= high; frames++) {
        const total = sum + frames;
        if (!onBeat(leadFrames + total)) continue;
        const penalty = choice.penalty + (frames - window.suggested) ** 2;
        const previous = next.get(total);
        if (!previous || penalty < previous.penalty) next.set(total, { penalty, frames, previous: choice });
      }
    }
    states = next;
  }
  const feasible = [...states].sort((a, b) =>
    Math.abs(a[0] - bodyTarget) - Math.abs(b[0] - bodyTarget) || a[1].penalty - b[1].penalty);
  let choice: Choice | undefined = feasible[0]?.[1];
  if (!choice) {
    throw new CompositionConstraintError(`素材与配乐切点无法满足时长预算：每镜 3–6 秒、成片 ${targetS}±0.5 秒`);
  }
  const frames = new Array<number>(shots.length);
  for (let i = shots.length - 1; i >= 0; i--) {
    frames[i] = choice!.frames;
    choice = choice!.previous ?? undefined;
  }
  return shots.map((shot, i) => ({
    no: shot.no, clip_key: shot.clip!, caption: shot.caption ?? "",
    trim_start_frame: windows[i]!.start, trim_start_s: windows[i]!.start / fps,
    frame_count: frames[i]!, duration_s: frames[i]! / fps,
  }));
}
