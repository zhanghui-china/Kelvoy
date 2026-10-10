import type { StageContext, Task } from "@kelvoy/engine";
import { expect, test } from "bun:test";
import { dequeueTask, getEpisode, insertEpisode, getLatestFailedTask } from "@kelvoy/store";
import { buildApp, fixture, login, setupEpisodeRouteTests, shotFixture, personaFixture } from "./episode-test-fixtures";

// Runtime integration uses the worker through its public task handler.
const workerModule = "../../../../worker/src/queue/consumer";
const { handleTask }: { handleTask(task: Task, overrides?: Partial<StageContext>): Promise<void> } = await import(workerModule);
setupEpisodeRouteTests();
test("saving subtitle settings retains legacy assets and marks the old final only on effective changes", async () => {
  const { cookie, ownerId } = await login("subtitle-settings");
  const episode = fixture("e_subtitles", ownerId);
  episode.status = "done";
  episode.shots = [shotFixture(1, { shot_id: "sh_subtitles", status: "approved", clip: "clip/1.mp4", caption: "已保存" })];
  episode.render.intro = "intro/custom.mp4";
  episode.render.outro = "outro/custom.mp4";
  episode.music = { file: "music/custom.mp3", bpm: 110, license: "old" };
  episode.final = { version: 1, key: "final/old.mp4", duration_s: 3, width: 1080, height: 1920, fps: 30, size_bytes: 10, completed_at: "2026-01-01" };
  await insertEpisode(episode);
  const app = buildApp();
  async function save(enabled: boolean, version: number, intro = episode.render.intro) {
    return app.request("/api/episodes/e_subtitles", { method: "PATCH", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ row_version: version, patch: { render: { ...episode.render, intro, subtitles_enabled: enabled } } }) });
  }
  expect((await save(true, 1)).status).toBe(200);
  let got = await getEpisode(episode.episode_id); if (!got.ok) throw Error("missing");
  expect(got.episode.final_needs_recompose).not.toBe(true);
  expect((await save(false, got.row_version)).status).toBe(200);
  got = await getEpisode(episode.episode_id); if (!got.ok) throw Error("missing");
  expect(got.episode.final_needs_recompose).toBe(true);
  expect(got.episode.final).toEqual(episode.final);
  expect(got.episode.render.intro).toBe(episode.render.intro);
  expect(got.episode.render.outro).toBe(episode.render.outro);
  expect(got.episode.music).toEqual(episode.music);
  expect(got.episode.shots).toEqual(episode.shots);
  expect(await dequeueTask()).toBeNull();
  expect((await save(false, got.row_version, "intro/another.mp4")).status).toBe(400);
  expect((await save(false, got.row_version, "intro/kelvoy_open.mp4")).status).toBe(200);
});

test("subtitle recompose failure retains the old delivery and retry replaces it without generating shots", async () => {
  const { cookie, ownerId } = await login("subtitle-retry");
  const episode = fixture("e_caption_retry", ownerId);
  episode.status = "done";
  episode.shots = [shotFixture(1, { shot_id: "sh_keep", status: "approved", clip: "clip/keep.mp4", caption: "旧字幕" })];
  episode.final = { version: 1, key: "final/old.mp4", duration_s: 2, width: 1080, height: 1920, fps: 30, size_bytes: 3, completed_at: "2026-01-01" };
  await insertEpisode(episode);
  const app = buildApp();
  const headers = { cookie, "content-type": "application/json" };
  async function current() { const got = await getEpisode(episode.episode_id); if (!got.ok) throw Error("missing"); return got; }
  const setting = await app.request(`/api/episodes/${episode.episode_id}`, { method: "PATCH", headers,
    body: JSON.stringify({ row_version: 1, patch: { render: { ...episode.render, subtitles_enabled: false } } }) });
  expect(setting.status).toBe(200);
  let saved = await current();
  expect((await app.request(`/api/episodes/${episode.episode_id}/recompose`, { method: "POST", headers,
    body: JSON.stringify({ row_version: saved.row_version }) })).status).toBe(200);
  const persona = personaFixture("c_test", ownerId);
  for (let attempt = 0; attempt < 2; attempt++) {
    const task = await dequeueTask(); expect(task?.stage).toBe("compose");
    await handleTask(task!, { persona, compose: { async compose() { throw Error("test compose failure"); } } });
  }
  saved = await current();
  expect(saved.episode.status).toBe("failed");
  expect(saved.episode.final).toEqual(episode.final);
  expect(saved.episode.final_needs_recompose).toBe(true);
  expect(saved.episode.shots).toEqual(episode.shots);
  expect((await getLatestFailedTask(saved.episode))?.stage).toBe("compose");
  expect((await app.request(`/api/episodes/${episode.episode_id}/retry`, { method: "POST", headers,
    body: JSON.stringify({ row_version: saved.row_version }) })).status).toBe(200);
  const retry = await dequeueTask(); expect(retry?.stage).toBe("compose");
  await handleTask(retry!, { persona, compose: { async compose({ plan }) {
    expect(plan.subtitles_enabled).toBe(false);
    return { output_key: plan.output_key, probe: { duration_s: 2, width: 1080, height: 1920, fps: 30, size_bytes: 4 } };
  } } });
  saved = await current();
  expect(saved.episode.status).toBe("done");
  expect(saved.episode.final?.version).toBe(2);
  expect(saved.episode.final_needs_recompose).toBe(false);
  expect(saved.episode.shots).toEqual(episode.shots);
  expect(await dequeueTask()).toBeNull();
});
