import type { EpisodeAspect, QwenPromptProvenance, Scene, ShotCamera, ShotSize } from "../schema";

/** Vision rewrite context. Caption deliberately stays outside image instructions. */
export interface ImagePromptContext {
  mode: "edit";
  aspect: EpisodeAspect;
  kf_prompt: string;
  size: ShotSize;
  camera: ShotCamera;
  beat: string;
  scene: Scene | null;
  destination: string | null;
  landmark: string | null;
  references: { key: string; role: "person" | "scene"; image: number }[];
}
export interface ImagePromptResult { prompt: string; provenance: QwenPromptProvenance }
export interface ImagePromptWriter {
  write(input: { episode_id: string; context: ImagePromptContext; signal?: AbortSignal }): Promise<ImagePromptResult>;
}
