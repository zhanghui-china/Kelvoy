import { join } from "node:path";
import sharp from "sharp";

/**
 * ADR-0017: the model draws one 16:9 sheet (front | side | back, left to right); this splits it into the three
 * single views. The sheet is published as the model's own image re-encoded to JPEG q92.
 *
 * Each third is trimmed of white margins horizontally only, then re-centred on a white canvas of the cell size,
 * so a figure that drifted inside its cell is centred while all three keep the same vertical placement (feet and
 * head stay level across views). sharp does the work (already a dependency of apps/web); ADR-0004 keeps ffmpeg
 * as compose-only, so the worker must not shell out to ffmpeg for this.
 */
const WHITE = "#ffffff";
const TRIM_THRESHOLD = 25; // tolerates JPEG-ish noise and soft shadows on the white background
const MIN_FILL_WIDTH = 0.1; // content narrower than 10% of the cell: empty or nearly empty cell
const MAX_FILL_WIDTH = 0.95; // content wider than 95% of the cell: a figure straddles the cell border
const MIN_FILL_HEIGHT = 0.3; // content shorter than 30% of the sheet height: not a full-body figure

export type SplitViews = { front: string; side: string; back: string; sheet: string };

/** Splits `source` and writes front/side/back PNG plus sheet.jpg into `outDir`. */
export type SheetSplitter = (source: string, outDir: string, signal?: AbortSignal) => Promise<SplitViews>;

/** Carries only a reason code as its name: the message surfaced to callers must never contain local paths. */
class SheetSplitError extends Error {
  constructor(reason: "EmptyCell" | "CellOverflow") {
    super(reason);
    this.name = reason;
  }
}

export const splitSheet: SheetSplitter = async (source, outDir, signal) => {
  signal?.throwIfAborted();
  try {
    const { data: flat, info } = await sharp(source).flatten({ background: WHITE }).png()
      .toBuffer({ resolveWithObject: true });
    const cellWidth = Math.floor(info.width / 3);
    const outputs = { front: join(outDir, "front.png"), side: join(outDir, "side.png"),
      back: join(outDir, "back.png"), sheet: join(outDir, "sheet.jpg") };

    const names = ["front", "side", "back"] as const;
    await Promise.all(names.map(async (_name, index) => {
      const cell = await sharp(flat)
        .extract({ left: index * cellWidth, top: 0, width: cellWidth, height: info.height }).png().toBuffer();
      // sharp's trim() returns an all-background image unchanged, which would read as an overflow below.
      const { channels } = await sharp(cell).stats();
      if (channels.every((channel) => channel.min >= 255 - TRIM_THRESHOLD)) throw new SheetSplitError("EmptyCell");
      const trimmed = await sharp(cell).trim({ background: WHITE, threshold: TRIM_THRESHOLD })
        .toBuffer({ resolveWithObject: true });
      const contentWidth = trimmed.info.width;
      if (contentWidth < cellWidth * MIN_FILL_WIDTH || trimmed.info.height < info.height * MIN_FILL_HEIGHT) {
        throw new SheetSplitError("EmptyCell");
      }
      if (contentWidth > cellWidth * MAX_FILL_WIDTH) throw new SheetSplitError("CellOverflow");
      // trimOffsetLeft is negative: how far the content box sits right of the cell's left edge.
      const content = await sharp(cell)
        .extract({ left: -(trimmed.info.trimOffsetLeft ?? 0), top: 0, width: contentWidth, height: info.height })
        .png().toBuffer();
      return sharp({ create: { width: cellWidth, height: info.height, channels: 3, background: WHITE } })
        .composite([{ input: content, left: Math.floor((cellWidth - contentWidth) / 2), top: 0 }])
        .png().toFile(outputs[names[index]!]);
    }));
    signal?.throwIfAborted();
    await sharp(flat).jpeg({ quality: 92 }).toFile(outputs.sheet);
    return outputs;
  } catch (error) {
    if (signal?.aborted) throw error;
    // sharp errors may echo local paths; surface only the error name.
    throw new Error(`sheet split failed (${error instanceof Error ? error.name : "unknown"})`);
  }
};
