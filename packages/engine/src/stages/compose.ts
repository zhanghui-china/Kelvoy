import type { Episode } from "../schema";

/**
 * Stage F — 合成 (PRD §4, FR-07). Cuts each shot to duration_s, cut-on-beat,
 * account-level LUT, title text, AI watermark + metadata, music, renders
 * 1080x1920 30fps. The only stage that touches ffmpeg (via
 * providers.compose / ComposeProvider), and runs on apps/worker. Not
 * implemented at skeleton stage.
 */
export async function runCompose(_episode: Episode, _shotNo?: number): Promise<Episode> {
  throw new Error("not implemented");
}
