import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acknowledgeDeletedTaskExecution, close, deleteEpisode, dequeueTask, enqueueTask,
  getDb, insertEpisode, open } from "@kelvoy/store";
import { deletionEpisodeFixture as fixture } from "../queue/deletion-test-fixture";
import { cleanupDeletedEpisodes } from "./episode-deletion";
import { assertEpisodePublicationAllowed, saveArtifact } from "./artifacts";

let root: string;
let previousRoot: string | undefined;
beforeEach(async () => {
  open(":memory:");
  previousRoot = process.env.KELVOY_PROJECTS_ROOT;
  root = await realpath(await mkdtemp(join(tmpdir(), "kelvoy-deleted-work-")));
  process.env.KELVOY_PROJECTS_ROOT = root;
});
afterEach(async () => {
  close();
  if (previousRoot === undefined) delete process.env.KELVOY_PROJECTS_ROOT;
  else process.env.KELVOY_PROJECTS_ROOT = previousRoot;
  await rm(root, { recursive: true, force: true });
});
async function work(id = "e_deleted") {
  await insertEpisode(fixture(id, "u_owner"));
  await mkdir(join(root, id, "clip"), { recursive: true });
  await writeFile(join(root, id, "clip", "test.mp4"), "test-video");
}

test("cleans only deleted work files, preserving shared assets and other works", async () => {
  await work();
  await work("e_keep");
  await mkdir(join(root, "music"));
  await writeFile(join(root, "music", "shared.mp3"), "shared");
  await deleteEpisode("e_deleted", "u_owner");
  expect(await cleanupDeletedEpisodes()).toBe(1);
  expect(await Bun.file(join(root, "e_deleted", "clip", "test.mp4")).exists()).toBe(false);
  expect(await readFile(join(root, "e_keep", "clip", "test.mp4"), "utf8")).toBe("test-video");
  expect(await readFile(join(root, "music", "shared.mp3"), "utf8")).toBe("shared");
  expect(await deleteEpisode("e_deleted", "u_owner")).toMatchObject({ ok: true, cleanup_status: "done" });
  expect(await cleanupDeletedEpisodes()).toBe(0);
});

test("cleanup waits until a canceled writer confirms exit", async () => {
  await work();
  await enqueueTask({ episode_id: "e_deleted", stage: "script" });
  const task = (await dequeueTask())!;
  await deleteEpisode("e_deleted", "u_owner");
  expect(await cleanupDeletedEpisodes()).toBe(0);
  expect(await Bun.file(join(root, "e_deleted", "clip", "test.mp4")).exists()).toBe(true);
  await acknowledgeDeletedTaskExecution(task.task_id, task.lease_token!);
  expect(await cleanupDeletedEpisodes()).toBe(1);
});

test("late archival cannot recreate a deleted work directory", async () => {
  await work();
  await deleteEpisode("e_deleted", "u_owner");
  await cleanupDeletedEpisodes();
  await writeFile(join(root, "source.mp4"), "late");
  await expect(saveArtifact("e_deleted", "clip/late.mp4", join(root, "source.mp4"))).rejects.toThrow();
  expect(await Bun.file(join(root, "e_deleted", "clip", "late.mp4")).exists()).toBe(false);
});

test("a late directory write between filesystem removal and commit forces another sweep", async () => {
  await work();
  await deleteEpisode("e_deleted", "u_owner");
  const aborted = new AbortController(); aborted.abort();
  expect(await cleanupDeletedEpisodes(async id => {
    await rm(join(root, id), { recursive: true, force: true });
    // A suspended mkdir resumes after rm, before the cleaner's database commit.
    await mkdir(join(root, id, "h3-prompts"), { recursive: true });
    expect(() => assertEpisodePublicationAllowed(id, aborted.signal)).toThrow("episode deleted");
  })).toBe(0);
  expect(await deleteEpisode("e_deleted", "u_owner")).toMatchObject({ cleanup_status: "pending" });
  expect(await cleanupDeletedEpisodes()).toBe(1);
  await expect(readFile(join(root, "e_deleted", "h3-prompts"))).rejects.toThrow();
});

test("directory symlinks never delete their targets", async () => {
  await insertEpisode(fixture("e_link", "u_owner"));
  await mkdir(join(root, "shared"));
  await writeFile(join(root, "shared", "keep.png"), "shared");
  await symlink(join(root, "shared"), join(root, "e_link"));
  await deleteEpisode("e_link", "u_owner");
  expect(await cleanupDeletedEpisodes()).toBe(1);
  expect(await readFile(join(root, "shared", "keep.png"), "utf8")).toBe("shared");
});

test("cleanup failures remain pending and retry only when due", async () => {
  await work();
  await deleteEpisode("e_deleted", "u_owner");
  expect(await cleanupDeletedEpisodes(async () => { throw new Error("private filesystem detail"); })).toBe(0);
  expect(await deleteEpisode("e_deleted", "u_owner")).toMatchObject({ cleanup_status: "pending" });
  expect(await cleanupDeletedEpisodes()).toBe(0);
  getDb().query("update episode_deletions set cleanup_retry_at = 0").run();
  expect(await cleanupDeletedEpisodes()).toBe(1);
});
