import type { Episode } from "../schema";
import { runAssets } from "./assets";
import { runBrief } from "./brief";
import { runCompose } from "./compose";
import { runKeyframe } from "./keyframe";
import { runScript } from "./script";
import { runVideo } from "./video";

export type StageName = "brief" | "script" | "assets" | "keyframe" | "video" | "compose";

// shotNo is only meaningful for the per-shot stages (keyframe/video), but
// every stage takes the same signature — the dispatch table below needs one
// shared function type, and a stage that ignores its second argument still
// has to declare it.
type StageRunner = (episode: Episode, shotNo?: number) => Promise<Episode>;

const stageRunners: Record<StageName, StageRunner> = {
  brief: runBrief,
  script: runScript,
  assets: runAssets,
  keyframe: runKeyframe,
  video: runVideo,
  compose: runCompose,
};

export async function runStage(name: StageName, episode: Episode, shotNo?: number): Promise<Episode> {
  return stageRunners[name](episode, shotNo);
}
