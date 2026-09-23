import type { KeyframeProvider } from "./types";

/**
 * 关键帧 (PRD §7): text + persona ref + landmark ref -> image 9:16.
 * Self-hosted via Qwen-Image/FLUX.1/HunyuanImage, called through
 * services/inference's /image endpoint.
 */
export const localImageProvider: KeyframeProvider = {
  async generateCandidates(_input) {
    throw new Error("not implemented");
  },
};
