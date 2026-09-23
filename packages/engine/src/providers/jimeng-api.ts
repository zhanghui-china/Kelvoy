import type { KeyframeProvider, VideoProvider } from "./types";

/**
 * 关键帧 + 图生视频溢出 (PRD §7): 即梦 domestic API, covers both concerns.
 * Used when the DGX queue overflows (see overflow.ts) or the matching
 * local provider fails repeatedly.
 */
export const jimengKeyframeProvider: KeyframeProvider = {
  async generateCandidates(_input) {
    throw new Error("not implemented");
  },
};

export const jimengVideoProvider: VideoProvider = {
  async generateClip(_input) {
    throw new Error("not implemented");
  },
};
