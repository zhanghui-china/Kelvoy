import type { EpisodeAspect, Scene, ShotCamera, ShotSize, H3PromptProvenance } from "../schema";

/** JSON-only rewrite contract; the worker owns guide loading, LLM and caching. */
export interface H3PromptContext {
  mode: "I2VA" | "Ref2VA";
  aspect: EpisodeAspect;
  duration_s: number;
  size: ShotSize;
  camera: ShotCamera;
  beat: string;
  kf_prompt: string;
  motion_prompt: string;
  scene: Scene | null;
  destination: string | null;
  landmark: string | null;
  references: { key: string; role: "person" | "scene" | "first_frame"; picture: number }[];
}
export interface H3PromptResult {
  prompt: string;
  provenance: H3PromptProvenance;
}
export interface H3PromptWriter {
  write(input: { episode_id: string; context: H3PromptContext; signal?: AbortSignal }): Promise<H3PromptResult>;
}
