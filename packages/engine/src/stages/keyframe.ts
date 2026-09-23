import type { Episode } from "../schema";

/**
 * Stage D — 关键帧 (PRD §4, FR-04/FR-05). N candidates per shot, 9:16;
 * landmark shots are conditioned on real destination reference images —
 * no "imagined landmarks" allowed. Supports per-shot and grid modes.
 * Calls providers.keyframe (KeyframeProvider). Not implemented at skeleton stage.
 */
export async function runKeyframe(_episode: Episode): Promise<Episode> {
  throw new Error("not implemented");
}
