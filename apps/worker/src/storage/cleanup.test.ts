import { afterEach, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, getDb, open } from "@kelvoy/store";
import { cleanupIncompleteEpisodeMedia, cleanupStaleEpisodeTemps, cleanupStaleInferenceMedia } from "./cleanup";

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

test("incomplete episode media cleanup preserves referenced, cached and active files", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-incomplete-media-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  open(":memory:");
  try {
    const protectedKey = "kf/01_tk_protected_0.png";
    const partialKey = "kf/02_tk_orphan_0.png";
    const completeKey = "clip/03_tk_complete.mp4";
    const activeKey = "kf/04_tk_active_0.png";
    const doc = (refs: string[]) => JSON.stringify({ status: "done", brief: { aspect: "9:16" },
      render: { title: "test" }, shots: [{ no: 1, candidates: refs, kf_selected: null, clip: null }],
      removed_shots: [], grid_refs: [], final: null });
    getDb().query("insert into episodes (episode_id, owner_id, row_version, doc) values (?, 'u', 1, ?)")
      .run("e_known", doc([protectedKey]));
    getDb().query("insert into episodes (episode_id, owner_id, row_version, doc) values (?, 'u', 1, ?)")
      .run("e_active", doc([]));
    getDb().query(`insert into tasks (task_id, episode_id, stage, attempt, status)
      values ('tk_live', 'e_active', 'keyframe', 1, 'pending')`).run();
    for (const episodeId of ["e_known", "e_active"]) {
      for (const kind of ["kf", "clip"]) await mkdir(join(root, episodeId, kind), { recursive: true });
    }
    const paths = [join(root, "e_known", protectedKey), join(root, "e_known", partialKey),
      join(root, "e_known", completeKey), join(root, "e_active", activeKey)];
    for (const path of paths) await writeFile(path, "media");
    await writeFile(`${paths[2]}.meta.json`, "cached");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await Promise.all(paths.map((path) => utimes(path, old, old)));
    expect(await cleanupIncompleteEpisodeMedia()).toBe(1);
    expect(await Bun.file(paths[1]!).exists()).toBe(false);
    for (const path of [paths[0], paths[2], paths[3]]) expect(await Bun.file(path!).exists()).toBe(true);
  } finally {
    close();
  }
});

test("cleanup handles stale retry-key frames but protects referenced, complete and active media", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-retry-media-cleanup-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  open(":memory:");
  try {
    const suffix = "_retry_12345678-1234-1234-1234-123456789abc.png";
    const orphanKey = `kf/01_generation_lease_0${suffix}`;
    const referencedKey = `kf/02_generation_lease_0${suffix}`;
    const cachedKey = `kf/03_generation_lease_0${suffix}`;
    const activeKey = `kf/04_generation_lease_0${suffix}`;
    const doc = (refs: string[]) => JSON.stringify({ status: "done", brief: { aspect: "9:16" },
      render: { title: "test" }, shots: [{ no: 1, candidates: refs, kf_selected: null, clip: null }],
      removed_shots: [], grid_refs: [], final: null });
    const db = getDb();
    db.query("insert into episodes (episode_id, owner_id, row_version, doc) values (?, 'u', 1, ?)")
      .run("e_idle", doc([referencedKey]));
    db.query("insert into episodes (episode_id, owner_id, row_version, doc) values (?, 'u', 1, ?)")
      .run("e_active", doc([]));
    db.query(`insert into tasks (task_id, episode_id, stage, attempt, status)
      values ('tk_live', 'e_active', 'keyframe', 1, 'processing')`).run();
    await mkdir(join(root, "e_idle", "kf"), { recursive: true });
    await mkdir(join(root, "e_active", "kf"), { recursive: true });
    const paths = [join(root, "e_idle", orphanKey), join(root, "e_idle", referencedKey),
      join(root, "e_idle", cachedKey), join(root, "e_active", activeKey)];
    for (const path of paths) await writeFile(path, "media");
    await writeFile(`${paths[2]}.meta.json`, "cached");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await Promise.all(paths.map((path) => utimes(path, old, old)));
    expect(await cleanupIncompleteEpisodeMedia()).toBe(1);
    expect(await Bun.file(paths[0]!).exists()).toBe(false);
    for (const path of paths.slice(1)) expect(await Bun.file(path!).exists()).toBe(true);
  } finally {
    close();
  }
});
