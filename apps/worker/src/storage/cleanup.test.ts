import { afterEach, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupStaleInferenceMedia } from "./cleanup";

let root = "";
afterEach(async () => {
  delete process.env.KELVOY_PROJECTS_ROOT;
  if (root) await rm(root, { recursive: true, force: true });
});

test("stale inference media is removed without touching active, unknown or symlinked files", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-stale-media-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  const dir = join(root, "inference", "image");
  await mkdir(dir, { recursive: true });
  const old = join(dir, `${"a".repeat(32)}.png`);
  const oldTemp = join(dir, `${"b".repeat(32)}.png.tmp-${"c".repeat(32)}`);
  const recent = join(dir, `${"d".repeat(32)}.png`);
  const unknown = join(dir, "manual.png");
  const outside = join(root, "outside.png");
  const link = join(dir, `${"e".repeat(32)}.png`);
  for (const file of [old, oldTemp, recent, unknown, outside]) await writeFile(file, "data");
  await symlink(outside, link);
  const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await Promise.all([utimes(old, oldTime, oldTime), utimes(oldTemp, oldTime, oldTime),
    utimes(unknown, oldTime, oldTime)]);

  expect(await cleanupStaleInferenceMedia()).toBe(2);
  expect(await Bun.file(old).exists()).toBe(false);
  expect(await Bun.file(oldTemp).exists()).toBe(false);
  expect(await Bun.file(recent).exists()).toBe(true);
  expect(await Bun.file(unknown).exists()).toBe(true);
  expect((await lstat(link)).isSymbolicLink()).toBe(true);
  expect(await readFile(outside, "utf8")).toBe("data");
});

test("cleanup does not follow a symlinked inference directory", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-stale-symlink-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  const other = join(root, "other");
  await mkdir(join(other, "image"), { recursive: true });
  const old = join(other, "image", `${"a".repeat(32)}.png`);
  await writeFile(old, "preserve");
  const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(old, oldTime, oldTime);
  await symlink(other, join(root, "inference"));
  expect(await cleanupStaleInferenceMedia()).toBe(0);
  expect(await readFile(old, "utf8")).toBe("preserve");
});
