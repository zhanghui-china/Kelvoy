import { expect, test } from "bun:test";
import type { Episode } from "@kelvoy/engine";
import { completeTaskWithEpisode, dequeueTask, enqueueTask, failTaskWithCredits, getCreditBalance, getDb, grantCredits,
  insertEpisode, insertPersona, upsertDestination } from "@kelvoy/store";
import { buildApp, destinationFixture, fixture, login, personaFixture, setupEpisodeRouteTests, shotFixture } from "./episode-test-fixtures";

setupEpisodeRouteTests();

test.each([
  ["kf_review", "keyframe", 2, "kf_ready"],
  ["clip_review", "video", 10, "clip_ready"],
] as const)("%s retry is isolated, charged once, and accepts the generated result for review", async (status, stage, price, readyStatus) => {
  const owner = await login(`retry-${stage}`, false);
  const visitor = await login(`visitor-${stage}`);
  const episode = { ...fixture("e_retry_review", owner.ownerId), status,
    final: { version: 1, key: "final/old.mp4", duration_s: 16, width: 1080, height: 1920, fps: 30, size_bytes: 100, completed_at: "2026-10-08T00:00:00Z" },
    shots: Array.from({ length: 8 }, (_, i) => shotFixture(i + 1, {
      status: i === 0 ? "failed" : "approved", candidates: [`kf/${i + 1}.png`],
      kf_selected: `kf/${i + 1}.png`, clip: `clip/${i + 1}.mp4`,
    })) };
  await insertEpisode(episode);
  await insertPersona(personaFixture(episode.persona_id, owner.ownerId));
  await upsertDestination(destinationFixture(episode.destination_id));
  const old = await enqueueTask({ episode_id: episode.episode_id, stage, shot_no: 1 });
  expect(failTaskWithCredits((await dequeueTask())!, false)).toBe(true);
  const app = buildApp();
  const retry = (cookie: string, rowVersion: number) => app.request(`/api/episodes/${episode.episode_id}/retry`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: rowVersion }),
  });
  const detail = async () => (await (await app.request(`/api/episodes/${episode.episode_id}`,
    { headers: { cookie: owner.cookie } })).json()) as {
      episode: Episode; row_version: number; failed_task: unknown;
    };
  expect((await detail()).failed_task).toEqual({ stage, shot_no: 1 });
  expect((await retry(visitor.cookie, 1)).status).toBe(404);
  expect((await retry(owner.cookie, 999)).status).toBe(409);
  expect((await retry(owner.cookie, 1)).status).toBe(402);
  expect(await dequeueTask()).toBeNull();
  expect(getCreditBalance(owner.ownerId)).toEqual({ available: 0, reserved: 0 });
  expect(getDb().query("select count(*) as n from credit_actions where user_id = ?").get(owner.ownerId)).toEqual({ n: 0 });
  grantCredits(owner.ownerId, price, `retry-${stage}-credits`);
  const response = await retry(owner.cookie, 1);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, row_version: 2, stage, shot_no: 1 });
  const queued = await detail();
  expect(queued.episode.status).toBe(status);
  expect(queued.episode.shots).toEqual(episode.shots.map((s) => ({ ...s, shot_id: expect.any(String) })));
  expect(queued.episode.final).toEqual(episode.final);
  expect(queued.failed_task).toBeNull();
  expect(getCreditBalance(owner.ownerId)).toEqual({ available: 0, reserved: price });
  expect((await retry(owner.cookie, 1)).status).toBe(409);
  const duplicate = await retry(owner.cookie, 2);
  expect(duplicate.status).toBe(400);
  expect((await duplicate.json()).error).toBe("no_failed_task");
  expect(getCreditBalance(owner.ownerId)).toEqual({ available: 0, reserved: price });
  const task = await dequeueTask();
  expect(task).toMatchObject({ stage, shot_no: 1, generation_id: old.task_id });
  expect(await dequeueTask()).toBeNull();
  expect(completeTaskWithEpisode(task!, queued.row_version, { ...queued.episode,
    shots: queued.episode.shots.map((shot) => shot.no === 1 ? { ...shot, status: readyStatus,
      ...(stage === "keyframe" ? { candidates: ["kf/retried.png"], kf_selected: null }
        : { clip: "clip/retried.mp4" }) } : shot),
  }).ok).toBe(true);
  const ready = await detail();
  expect(ready.episode.status).toBe(status);
  expect(ready.episode.shots[0]?.status).toBe(readyStatus);
  expect(ready.episode.shots.slice(1)).toEqual(queued.episode.shots.slice(1));
  expect(ready.episode.final).toEqual(episode.final);
  expect(getCreditBalance(owner.ownerId)).toEqual({ available: 0, reserved: 0 });
  expect(ready.episode.credits_used).toBe(price);
  const reviewed = await app.request(`/api/episodes/${episode.episode_id}/shots/1`, {
    method: "PATCH", headers: { cookie: owner.cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: ready.row_version, patch: stage === "keyframe"
      ? { status: "kf_selected", kf_selected: ready.episode.shots[0]!.candidates[0] }
      : { status: "approved" } }),
  });
  expect(reviewed.status).toBe(200);
});
