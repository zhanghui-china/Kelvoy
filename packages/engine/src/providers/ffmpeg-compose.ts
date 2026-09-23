import type { ComposeProvider } from "./types";

/**
 * 合成 (PRD §7): the only provider that calls ffmpeg — cut-on-beat, LUT,
 * watermark, subtitles, muxing. Runs on apps/worker.
 */
export const ffmpegComposeProvider: ComposeProvider = {
  async compose(_input) {
    throw new Error("not implemented");
  },
};
