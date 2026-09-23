import type { UpscaleProvider } from "./types";

/**
 * 放大/修复 (PRD §7): Real-ESRGAN-style super-resolution + RIFE interpolation.
 * Required after grid-mode keyframe cropping. Called through
 * services/inference's /upscale endpoint.
 */
export const localUpscaleProvider: UpscaleProvider = {
  async upscale(_input) {
    throw new Error("not implemented");
  },
};
