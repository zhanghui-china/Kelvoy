import type { VideoProvider } from "./types";

/**
 * 图生视频 (PRD §7): image (+prompt) -> video 3-5s. Self-hosted via Wan 2.x
 * (I2V, VACE for reference control) / HunyuanVideo I2V / CogVideoX, called
 * through services/inference's /video endpoint. Most likely long-term
 * overflow target — see kling-api.ts / jimeng-api.ts.
 */
export const localVideoProvider: VideoProvider = {
  async generateClip(_input) {
    throw new Error("not implemented");
  },
};
