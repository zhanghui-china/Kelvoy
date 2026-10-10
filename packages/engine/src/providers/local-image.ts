import type { InferenceRequest } from "./inference-types";
import type { EpisodeAspect } from "../schema/episode";

/**
 * Pure wire mapping. The worker performs HTTP and file IO, keeping engine
 * within the CLAUDE.md boundary.
 */
export function localImageRequest(input: { prompt: string; refs: string[]; seed: number; aspect?: EpisodeAspect }): InferenceRequest {
  return { prompt: input.prompt, refs: input.refs, seed: input.seed, size: input.aspect ?? "9:16", count: 1 };
}
