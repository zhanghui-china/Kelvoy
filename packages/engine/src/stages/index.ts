import type { Episode } from "../schema";
import { runAssets } from "./assets";
import { runBrief } from "./brief";
import { runCompose } from "./compose";
import { runKeyframe } from "./keyframe";
import { runScript } from "./script";
export { AI_LABEL_TEXT, buildComposePlan, finalOutputKey } from "./compose";
export type { StageContext } from "./types";
import type { StageContext } from "./types";
import { runVideo } from "./video";

export type StageName = "brief" | "script" | "assets" | "keyframe" | "video" | "compose";

// shotNo is only meaningful for the per-shot stages (keyframe/video); context
// is only meaningful for stages that need data beyond the Episode itself
// (currently just "script", see ./types.ts). Every stage shares one runner
// type for the dispatch table below — a stage that ignores an argument
// still has to declare a compatible signature (or, in TS, none at all).
type StageRunner = (episode: Episode, shotNo?: number, context?: StageContext) => Promise<Episode>;

const stageRunners: Record<StageName, StageRunner> = {
  brief: runBrief,
  script: runScript,
  assets: runAssets,
  keyframe: runKeyframe,
  video: runVideo,
  compose: runCompose,
};

export async function runStage(
  name: StageName,
  episode: Episode,
  shotNo?: number,
  context?: StageContext,
): Promise<Episode> {
  return stageRunners[name](episode, shotNo, context);
}
