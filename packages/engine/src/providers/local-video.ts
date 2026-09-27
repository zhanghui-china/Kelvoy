import type { InferenceRequest } from "./inference-types";
import type { EpisodeAspect } from "../schema/episode";

/**
 * Pure mapping for the measured 480-pixel MiniMax-H3 vertical preset.
 */
export function localVideoRequest(input: {
  prompt: string; first_frame?: string; refs?: string[]; duration_s: number; seed: number;
  aspect?: EpisodeAspect;
}): InferenceRequest {
  const refs = input.refs ?? (input.first_frame ? [input.first_frame] : []);
  if (refs.length !== 1 && refs.length !== 2) throw new Error("video needs one keyframe or two references");
  return { prompt: input.prompt, refs, seed: input.seed,
    size: input.aspect ?? "9:16", count: 1, params: { duration_s: input.duration_s } };
}
