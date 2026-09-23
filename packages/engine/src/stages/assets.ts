import type { Episode } from "../schema";

/**
 * Stage C — 角色卡 + 目的地卡 (PRD §4, FR-03/FR-14). Assembles the persona's
 * reference-image set and the destination's landmark symbol pack for the
 * shots that need them. Not implemented at skeleton stage.
 */
export async function runAssets(_episode: Episode, _shotNo?: number): Promise<Episode> {
  throw new Error("not implemented");
}
