import type { Episode } from "../schema";
import { runAssets } from "./assets";
import { runBrief } from "./brief";
import { runCompose } from "./compose";
import { runKeyframe } from "./keyframe";
import { runScript } from "./script";
import { runVideo } from "./video";

export type StageName = "brief" | "script" | "assets" | "keyframe" | "video" | "compose";

const stageRunners: Record<StageName, (episode: Episode) => Promise<Episode>> = {
  brief: runBrief,
  script: runScript,
  assets: runAssets,
  keyframe: runKeyframe,
  video: runVideo,
  compose: runCompose,
};

export async function runStage(name: StageName, episode: Episode): Promise<Episode> {
  return stageRunners[name](episode);
}
