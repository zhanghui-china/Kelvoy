import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { splitSheet } from "./sheet";

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "kelvoy-sheet-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const SHEET = { width: 1380, height: 768 }; // cells are 460px wide
const COLORS = ["#ff0000", "#00ff00", "#0000ff"];

/** Draws one solid 600px-tall block per [left, width] pair on a white sheet. */
async function writeSheet(figures: [number, number][], name = "in.png"): Promise<string> {
  const layers = await Promise.all(figures.map(async ([left, width], i) => ({
    input: await sharp({ create: { width, height: 600, channels: 3, background: COLORS[i]! } }).png().toBuffer(),
    left, top: 100,
  })));
  const path = join(dir, name);
  await sharp({ create: { ...SHEET, channels: 3, background: "#ffffff" } }).composite(layers).png().toFile(path);
  return path;
}
const sample = async (path: string, x: number, y: number) => {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [data[offset], data[offset + 1], data[offset + 2]];
};

test("splits left/middle/right into front/side/back, centred on equal-size white cells; sheet is JPEG", async () => {
  // Off-centre figures: the trim step must re-centre them inside their own cell.
  const out = await splitSheet(await writeSheet([[20, 200], [560, 200], [1150, 200]]), dir);
  for (const [path, color] of [[out.front, [255, 0, 0]], [out.side, [0, 255, 0]], [out.back, [0, 0, 255]]] as const) {
    const meta = await sharp(path).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 460, 768]);
    const centre = await sample(path, 230, 400);
    expect(centre[0]).toBeGreaterThan(color[0]! - 10); expect(centre[0]).toBeLessThan(color[0]! + 10);
    expect(centre[1]).toBeGreaterThan(color[1]! - 10); expect(centre[1]).toBeLessThan(color[1]! + 10);
    expect(centre[2]).toBeGreaterThan(color[2]! - 10); expect(centre[2]).toBeLessThan(color[2]! + 10);
    expect(await sample(path, 10, 400)).toEqual([255, 255, 255]); // white margin kept
    expect(await sample(path, 230, 10)).toEqual([255, 255, 255]); // vertical placement untouched
  }
  const sheet = await sharp(out.sheet).metadata();
  expect([sheet.format, sheet.width, sheet.height]).toEqual(["jpeg", SHEET.width, SHEET.height]);
});

test("an empty cell is rejected", async () => {
  await expect(splitSheet(await writeSheet([[20, 200], [1150, 200]]), dir)).rejects.toThrow("sheet split failed (EmptyCell)");
});

test("a nearly empty cell (tiny figure) is rejected", async () => {
  await expect(splitSheet(await writeSheet([[20, 200], [560, 20], [1150, 200]]), dir))
    .rejects.toThrow("sheet split failed (EmptyCell)");
});

test("a figure straddling a cell border is rejected", async () => {
  await expect(splitSheet(await writeSheet([[20, 200], [400, 600], [1150, 200]]), dir))
    .rejects.toThrow("sheet split failed (CellOverflow)");
});

test("a failing split surfaces only the error name, never the path", async () => {
  const error = await splitSheet("/missing/secret/in.png", dir).catch((e: Error) => e);
  expect((error as Error).message).toMatch(/^sheet split failed \([A-Za-z]+\)$/);
  expect((error as Error).message).not.toContain("secret");
});
