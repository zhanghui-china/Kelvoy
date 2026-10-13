import sharp from "sharp";

/**
 * Spec: spike/three-views/README.md "拼图规格" — front | side | back, equal height, JPEG q92.
 * Each view is ~768x1376, so the sheet is ~2304x1376.
 *
 * sharp does the stitching (already a dependency of apps/web). ADR-0004 keeps ffmpeg as compose-only,
 * so the worker must not shell out to ffmpeg for this; see ADR-0017 "拼图依赖".
 */
export const SHEET_HEIGHT = 1376;

export type SheetComposer = (views: [string, string, string], output: string, signal?: AbortSignal) => Promise<void>;

export const composeSheet: SheetComposer = async (views, output, signal) => {
  signal?.throwIfAborted();
  try {
    const panels = await Promise.all(views.map((path) =>
      sharp(path).resize({ height: SHEET_HEIGHT }).png().toBuffer({ resolveWithObject: true })));
    let left = 0;
    const layers = panels.map((panel) => {
      const layer = { input: panel.data, left, top: 0 };
      left += panel.info.width;
      return layer;
    });
    await sharp({ create: { width: left, height: SHEET_HEIGHT, channels: 3, background: "#ffffff" } })
      .composite(layers)
      .jpeg({ quality: 92 })
      .toFile(output);
  } catch (error) {
    // sharp errors may echo local paths; surface only the error name.
    throw new Error(`sheet composition failed (${error instanceof Error ? error.name : "unknown"})`);
  }
};
