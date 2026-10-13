import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../compose/ffmpeg";
import { composeSheet } from "./sheet";

const hasFfmpeg = Boolean(Bun.which("ffmpeg") && Bun.which("ffprobe"));

test.skipIf(!hasFfmpeg)("stitches front|side|back into one equal-height JPEG", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kelvoy-sheet-"));
  try {
    const views = await Promise.all(["red", "green", "blue"].map(async (color, i) => {
      const path = join(dir, `${i}.png`);
      await runCommand(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=768x1376`, "-frames:v", "1", path]);
      return path;
    }));
    const output = join(dir, "sheet.jpg");
    await composeSheet(views as [string, string, string], output);
    const probe = await runCommand(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,width,height",
      "-of", "csv=p=0", output]);
    expect(probe.stdout.trim()).toBe("mjpeg,2304,1376");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failing ffmpeg run surfaces only the exit code", async () => {
  if (!hasFfmpeg) return;
  await expect(composeSheet(["/missing/a.png", "/missing/b.png", "/missing/c.png"], "/tmp/never.jpg"))
    .rejects.toThrow(/^sheet composition failed \(ffmpeg exit \d+\)$/);
});
