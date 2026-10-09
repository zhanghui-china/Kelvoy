/**
 * Wire shapes for services/inference's four HTTP endpoints (M1-8). Mirrors
 * services/inference/src/inference/schemas.py — kept in sync by hand, the
 * surface is small. Model-specific parameters go into `params` so this
 * shape doesn't change every time a model is swapped in. local-image.ts and
 * local-video.ts build requests; the worker validates responses and archives
 * media. Script generation currently uses StepFun directly.
 */
export interface InferenceRequest {
  prompt: string;
  comfyui_base_url?: string | null;
  refs?: string[];
  seed?: number;
  size?: string;
  count?: number;
  params?: Record<string, unknown>;
}

export interface InferenceResponse {
  paths: string[];
  model: string;
  version: string;
  seed: number;
  seconds: number;
}
