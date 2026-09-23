/**
 * Wire shapes for services/inference's four HTTP endpoints (M1-8). Mirrors
 * services/inference/src/inference/schemas.py — kept in sync by hand, the
 * surface is small. Model-specific parameters go into `params` so this
 * shape doesn't change every time a model is swapped in; local-*.ts
 * providers (not implemented yet) will build one of these per call and
 * translate the response into their own return shape (image path, video
 * path, etc.).
 */
export interface InferenceRequest {
  prompt: string;
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
