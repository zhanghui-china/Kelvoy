import type { VideoProvider } from "./types";

/**
 * 图生视频溢出 (PRD §7): 可灵 domestic API, used when the DGX queue overflows
 * (see overflow.ts) or the local video provider fails repeatedly.
 */
export const klingVideoProvider: VideoProvider = {
  async generateClip(_input) {
    throw new Error("not implemented");
  },
};
