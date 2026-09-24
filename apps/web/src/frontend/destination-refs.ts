import type { Destination } from "@kelvoy/engine";

// FR-14 的验收口径是"每个地标 ≥ 3 张实景参考图"。目的地库页（DestinationsPage）
// 按地标逐个标注，首页"灵感目的地"（HomePage）按整条目的地标注一句"参考图
// 不足"——同一条业务规则两处用，所以常量和判断放这里。

export const MIN_LANDMARK_REFS = 3;

/** 整条目的地的参考图总张数，首页卡片直接显示这个数。 */
export function countRefs(d: Destination): number {
  return d.landmarks.reduce((sum, l) => sum + l.refs.length, 0);
}

/** 一个地标不到 3 张（或者一个地标都没有），整条目的地就算参考图不足。 */
export function hasEnoughRefs(d: Destination): boolean {
  return d.landmarks.length > 0 && d.landmarks.every((l) => l.refs.length >= MIN_LANDMARK_REFS);
}
