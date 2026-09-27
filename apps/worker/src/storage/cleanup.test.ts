import { afterEach, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, getDb, open } from "@kelvoy/store";
import { cleanupStaleEpisodeTemps, cleanupStaleInferenceMedia } from "./cleanup";

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

test("episode cleanup removes only old publish temps from known episodes", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-episode-temps-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  open(":memory:");
  try {
    getDb().query(`insert into episodes (episode_id, owner_id, row_version, doc)
      values ('e_known', 'u', 1, '{}')`).run();
    const known = join(root, "e_known");
    const unknown = join(root, "e_unknown", "kf");
    for (const dir of [join(known, "kf"), join(known, "clip"),
      join(known, "final"), unknown]) await mkdir(dir, { recursive: true });
    const uuid = "12345678-1234-1234-1234-123456789abc";
    const old = join(known, "kf", `01.png.tmp-${uuid}`);
    const oldMeta = join(known, "kf", `01.png.meta.json.tmp-${uuid}`);
    const recent = join(known, "clip", `01.mp4.tmp-${uuid}`);
    const final = join(known, "final", "e_known_v1.mp4");
    const unowned = join(unknown, `01.png.tmp-${uuid}`);
    const unexpected = join(known, "kf", "manual.png.tmp-note");
    const linked = join(known, "final", `linked.mp4.tmp-${uuid}`);
    for (const file of [old, oldMeta, recent, final, unowned, unexpected]) await writeFile(file, "preserve");
    await symlink(unowned, linked);
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await Promise.all([utimes(old, oldTime, oldTime), utimes(oldMeta, oldTime, oldTime),
      utimes(final, oldTime, oldTime), utimes(unowned, oldTime, oldTime)]);

    expect(await cleanupStaleEpisodeTemps()).toBe(2);
    expect(await Bun.file(old).exists()).toBe(false);
    expect(await Bun.file(oldMeta).exists()).toBe(false);
    expect(await Bun.file(recent).exists()).toBe(true);
    expect(await Bun.file(final).exists()).toBe(true);
    expect(await Bun.file(unowned).exists()).toBe(true);
    expect(await Bun.file(unexpected).exists()).toBe(true);
    expect((await lstat(linked)).isSymbolicLink()).toBe(true);
  } finally {
    close();
  }
});
