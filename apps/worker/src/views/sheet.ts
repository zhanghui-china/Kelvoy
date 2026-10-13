import { runCommand } from "../compose/ffmpeg";

/**
 * Spec: spike/three-views/README.md "拼图规格" — front | side | back, equal height, JPEG q92.
 * Each view is ~768x1376, so the sheet is ~2304x1376.
 *
 * ffmpeg does the stitching because the worker has no image library dependency (sharp lives only in apps/web;
 * Bun.Image cannot composite). Open question for review: ADR-0004 names compose as the only ffmpeg caller;
 * if that boundary should hold, add sharp to apps/worker instead and replace this one function.
 */
export const SHEET_HEIGHT = 1376;

export type SheetComposer = (views: [string, string, string], output: string, signal?: AbortSignal) => Promise<void>;

export const composeSheet: SheetComposer = async (views, output, signal) => {
  const scaled = views.map((_, i) => `[${i}:v]scale=-2:${SHEET_HEIGHT}[v${i}]`).join(";");
  const { code } = await runCommand([
    "ffmpeg", "-y", "-v", "error", ...views.flatMap((path) => ["-i", path]),
    "-filter_complex", `${scaled};[v0][v1][v2]hstack=inputs=3[sheet]`,
    "-map", "[sheet]", "-frames:v", "1", "-pix_fmt", "yuvj420p", "-q:v", "2", output,
  ], signal);
  // stderr may echo local paths; surface only the exit code.
  if (code !== 0) throw new Error(`sheet composition failed (ffmpeg exit ${code})`);
};
