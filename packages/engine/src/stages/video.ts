import type { Episode } from "../schema";

/**
 * Stage E — 图生视频 (PRD §4, FR-06). Selected keyframe -> 3-5s clip;
 * prompt = action beat + camera motion. Calls providers.video (VideoProvider).
 * Not implemented at skeleton stage.
 */
export async function runVideo(_episode: Episode): Promise<Episode> {
  throw new Error("not implemented");
}
