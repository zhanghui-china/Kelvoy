import type { InferenceRequest } from "./inference-types";

/**
 * Pure wire mapping. The worker performs HTTP and file IO, keeping engine
 * within the CLAUDE.md boundary.
 */
export function localImageRequest(input: { prompt: string; refs: string[]; seed: number }): InferenceRequest {
  return { prompt: input.prompt, refs: input.refs, seed: input.seed, size: "9:16", count: 1 };
}
