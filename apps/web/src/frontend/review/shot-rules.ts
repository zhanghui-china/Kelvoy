import type { Shot, ShotStatus } from "@kelvoy/engine";

/**
 * 镜级状态机（packages/engine/src/state/shot.ts）里 request_regen 的合法
 * 来源状态：kf_ready / clip_ready / approved。审片台照着这份集合禁用按钮，
 * 免得让用户点一个注定 400 的"重生成"。
 *
 * 注意 failed 不在里面：失败的镜没有"人工重生成"这条路（regen 路由会把镜
 * 置成 rejected，而 failed -> rejected 不是合法转移），要等 worker 自己
 * 重试。这是既有后端行为，#31 不改状态机。
 */
const REGEN_SOURCE_STATUSES = new Set<ShotStatus>(["kf_ready", "clip_ready", "approved"]);

export function canRegen(shot: Shot): boolean {
  return REGEN_SOURCE_STATUSES.has(shot.status);
}

export function regenHint(shot: Shot): string | null {
  if (canRegen(shot)) return null;
  if (shot.status === "failed") return "这一镜生成失败，等 worker 自动重试。";
  if (shot.status === "rejected") return "已经标记过重生成，等新结果。";
  return "当前状态不能重生成。";
}
