import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { composeSheet } from "./sheet";

test("stitches front|side|back into one equal-height JPEG", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kelvoy-sheet-"));
  try {
    const colors = ["#ff0000", "#00ff00", "#0000ff"];
    const views = await Promise.all(colors.map(async (background, i) => {
      const path = join(dir, `${i}.png`);
      await sharp({ create: { width: 768, height: 1376, channels: 3, background } }).png().toFile(path);
      return path;
    }));
    const output = join(dir, "sheet.jpg");
    await composeSheet(views as [string, string, string], output);
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([2304, 1376]);
    // Each panel sits left-to-right in order: sample the centre of each third.
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number) => {
      const offset = (300 * info.width + x) * info.channels;
      return [data[offset], data[offset + 1], data[offset + 2]];
    };
    const [r, g, b] = [pixel(384), pixel(1152), pixel(1920)];
    expect(r[0]).toBeGreaterThan(200);
    expect(g[1]).toBeGreaterThan(200);
    expect(b[2]).toBeGreaterThan(200);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failing composition surfaces only the error name", async () => {
  await expect(composeSheet(["/missing/a.png", "/missing/b.png", "/missing/c.png"], "/tmp/never.jpg"))
    .rejects.toThrow(/^sheet composition failed \([A-Za-z]+\)$/);
});
