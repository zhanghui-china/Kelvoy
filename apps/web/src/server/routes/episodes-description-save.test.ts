import { enqueueTask, getEpisode, insertEpisode } from "@kelvoy/store";
import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildApp, fixture, login, setupEpisodeRouteTests, shotFixture, tmpRoot } from "./episode-test-fixtures";

setupEpisodeRouteTests();
async function snapshot() {
  const result = await getEpisode("e_save");
  if (!result.ok) throw new Error("missing test episode");
  return result;
}
async function setup(status: "failed" | "kf_selected" | "kf_ready" | "approved", scripting = false) {
  const owner = await login(`save-${status}`);
  const episode = { ...fixture("e_save", owner.ownerId), status: "kf_review" as const,
    script_pending_task_id: scripting ? "script-task" : null,
    shots: [shotFixture(1, { status, candidates: ["kf/1.png"], kf_selected: "kf/1.png", clip: "clip/1.mp4" }),
      shotFixture(2, { status: "approved", candidates: ["kf/2.png"], kf_selected: "kf/2.png", clip: "clip/2.mp4" })],
    final: { version: 1, key: "final/old.mp4", duration_s: 2, width: 1080, height: 1920, fps: 30, size_bytes: 3, completed_at: "2026-10-08T00:00:00Z" } };
  await insertEpisode(episode);
  const app = buildApp();
  const save = (prompt: string, version = 1, cookie = owner.cookie) => app.request("/api/episodes/e_save/shots/1", {
    method: "PATCH", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: version, patch: { kf_prompt: prompt } }),
  });
  return { save, owner, before: await snapshot() };
}

test.each(["failed", "kf_selected", "kf_ready", "approved"] as const)("%s no-op save succeeds repeatedly without changing any episode field or version", async status => {
  const { save, before } = await setup(status);
  for (let i = 0; i < 2; i++) {
    const response = await save(before.episode.shots[0].kf_prompt);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, row_version: 1 });
    expect(await snapshot()).toEqual(before);
  }
});

test.each(["failed", "kf_selected", "kf_ready", "approved"] as const)("%s changed save reopens script review, invalidates only target references and preserves files/final", async status => {
  const { save, before } = await setup(status);
  const dir = join(tmpRoot, "projects/e_save");
  await mkdir(dir, { recursive: true });
  const history = join(dir, "history.png");
  await writeFile(history, "old asset");
  const response = await save("山顶晨光新画面");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, row_version: 2 });
  const after = await snapshot();
  expect(after.episode.status).toBe("script_review");
  expect(after.episode.shots[0]).toMatchObject({ status: "draft", kf_prompt: "山顶晨光新画面", candidates: [], kf_selected: null, clip: null });
  expect(after.episode.shots[1]).toEqual(before.episode.shots[1]);
  expect(after.episode.final).toEqual(before.episode.final);
  expect(after.episode.shared_storyboard?.shots).toEqual(before.episode.shots);
  expect(await readFile(history, "utf8")).toBe("old asset");
});

test("save rejects invalid fields/content, stale versions and a different owner without mutation", async () => {
  const { save, before } = await setup("failed");
  const other = await login("save-other");
  for (const prompt of ["", " ", "x".repeat(2001), "裸体画面"]) expect((await save(prompt)).status).toBe(400);
  const stale = await save("新画面", 999);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: "version_conflict" });
  expect((await save("新画面", 1, other.cookie)).status).toBe(404);
  expect(await snapshot()).toEqual(before);
});

test.each(["generation", "script"] as const)("both changed and no-op descriptions are locked during %s tasks", async kind => {
  const { save } = await setup("kf_ready", kind === "script");
  if (kind === "generation") await enqueueTask({ episode_id: "e_save", stage: "keyframe", shot_no: 2 });
  const before = await snapshot();
  for (const prompt of ["景区画面", "新画面"]) {
    const response = await save(prompt);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "action_pending" });
  }
  expect(await snapshot()).toEqual(before);
});
