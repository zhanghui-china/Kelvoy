import { runStage, type Episode } from "@kelvoy/engine";

/**
 * The worker's only ffmpeg touchpoint (PRD §9). The actual ffmpeg
 * invocation lives in packages/engine's compose stage/provider; this file
 * just wires the worker's task handler to it.
 */
export async function runCompose(episode: Episode): Promise<Episode> {
  return runStage("compose", episode);
}
