import type { Shot } from "../schema/episode";

/**
 * FR-07 卡拍对齐 (PRD v0.2 §5, M1-13). `Shot.duration_s` 是**目标**时长，
 * 实际切点必须落在配乐的节拍网格上，并夹在 [MIN_SHOT_S, MAX_SHOT_S] 内。
 *
 * 纯计算，没有 IO：apps/worker 的 ffmpeg 只消费这里算出来的秒数
 * （CLAUDE.md 目录职责表：engine 只吃 JSON 吐 JSON）。
 */

// FR-07 的硬区间：单镜实际时长 0.8–2.0 s。这两个数是产品规则，不是 M0 实测
// 出来的占位常量，可以直接落死。
export const MIN_SHOT_S = 0.8;
export const MAX_SHOT_S = 2.0;

// 浮点容差：60/bpm 常带无穷小数，比较端点时不能用严格不等号。
const EPSILON = 1e-9;

/** 时长精度取到毫秒，避免浮点尾数灌进 ffmpeg 命令行。 */
function roundMs(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

function clampToShotWindow(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_SHOT_S;
  return roundMs(Math.min(MAX_SHOT_S, Math.max(MIN_SHOT_S, seconds)));
}

/**
 * 把目标时长吸附到最近的整数倍节拍，再夹进 [0.8, 2.0]。
 *
 * bpm 不可用（选不到曲子、曲库没标 bpm）时退化成"只夹区间"——不假装对齐到
 * 一个不存在的节拍网格。节拍间隔本身超过 2 s（bpm < 30）时窗口里一个整拍都
 * 放不下，同样退回夹区间：宁可切点不在拍上，也不出超长镜头。
 */
export function alignToBeat(targetS: number, bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return clampToShotWindow(targetS);

  const beatS = 60 / bpm;
  let best: number | null = null;
  for (let n = 1; n * beatS <= MAX_SHOT_S + EPSILON; n += 1) {
    const candidate = n * beatS;
    if (candidate + EPSILON < MIN_SHOT_S) continue;
    if (best === null || Math.abs(candidate - targetS) < Math.abs(best - targetS)) {
      best = candidate;
    }
  }
  return best === null ? clampToShotWindow(targetS) : roundMs(best);
}

/** 一镜的切割参数：片段相对 key + 入点 + 卡拍后的实际时长。 */
export interface ShotCut {
  no: number;
  clip_key: string;
  trim_start_s: number;
  duration_s: number;
}

/**
 * 按节拍排出整期的切割表。
 *
 * PRD §4：合成是期级操作，不挑镜、不跳镜——所以这里不过滤，任何一镜没
 * approved 或没片段都直接报错，让调用方（worker / CLI）把期标成 failed，
 * 而不是悄悄少合几镜。
 */
export function planCuts(shots: Shot[], bpm: number): ShotCut[] {
  if (shots.length === 0) {
    throw new Error("没有镜头可以合成");
  }
  return shots.map((shot) => {
    if (shot.status !== "approved") {
      throw new Error(`第 ${shot.no} 镜未 approved（当前 ${shot.status}），不能合成`);
    }
    if (!shot.clip) {
      throw new Error(`第 ${shot.no} 镜没有片段（clip 为空），不能合成`);
    }
    return {
      no: shot.no,
      clip_key: shot.clip,
      trim_start_s: roundMs(Math.max(0, shot.trim_start_s ?? 0)),
      duration_s: alignToBeat(shot.duration_s, bpm),
    };
  });
}

/** 切割表总时长（不含片头片尾）——验收用：成片时长 = 这个值 + 片头片尾 ± 0.5 s。 */
export function totalCutDurationS(cuts: ShotCut[]): number {
  return roundMs(cuts.reduce((sum, cut) => sum + cut.duration_s, 0));
}
