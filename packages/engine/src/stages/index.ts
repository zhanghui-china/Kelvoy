import type { Episode } from "../schema";
import { runAssets } from "./assets";
import { runBrief } from "./brief";
import { runCompose } from "./compose";
import { runKeyframe } from "./keyframe";
import { runScript } from "./script";
export { AI_LABEL_TEXT, buildComposePlan, finalOutputKey } from "./compose";
export { runScriptRevision } from "./script";
export { planStoryboardGeneration, hasUsableClip, hasSelectedFrame } from "./generation-plan";
export { mergeGeneratedShotResult } from "./generation-commit";
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

const allowedStatus: Record<StageName, readonly Episode["status"][]> = {
  brief: ["draft"], script: ["scripting"], assets: ["assets"],
  keyframe: ["keyframing", "kf_review"],
  video: ["clipping", "clip_review"], compose: ["composing"],
};

export function isStageName(value: string): value is StageName {
  return Object.hasOwn(stageRunners, value);
}

export function isStageEntryStatus(name: StageName, status: Episode["status"]): boolean {
  return allowedStatus[name].includes(status);
}

export async function runStage(
  name: StageName,
  episode: Episode,
  shotNo?: number,
  context?: StageContext,
): Promise<Episode> {
  if (episode.mode === "grid") throw new Error("网格模式尚未完成，不能开始生成");
  if (!isStageEntryStatus(name, episode.status)) throw new Error(`${name} 阶段状态不正确`);
  return stageRunners[name](episode, shotNo, context);
}
