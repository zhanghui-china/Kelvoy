import { expect, test } from "bun:test";
import { enqueueTask, dequeueTask, failTaskWithCredits, getCreditBalance, grantCredits, insertEpisode,
  insertPersona, upsertDestination } from "@kelvoy/store";
import { buildApp, destinationFixture, fixture, login, personaFixture, setupEpisodeRouteTests, shotFixture } from "./episode-test-fixtures";

setupEpisodeRouteTests();

// 两镜视频失败的 clip_review 作品。failed_tasks / shot_no / all 依赖 store 的 R1/R2 实现，合并后才能通过。
async function seedTwoFailures(name: string) {
  const owner = await login(name);
  const episode = { ...fixture(`e_${name}`, owner.ownerId), status: "clip_review" as const,
    shots: [1, 2, 3].map((no) => shotFixture(no, { status: no === 3 ? "approved" : "failed",
      candidates: [`kf/${no}.png`], kf_selected: `kf/${no}.png`, ...(no === 3 ? { clip: "clip/3.mp4" } : {}) })) };
  await insertEpisode(episode);
  await insertPersona(personaFixture(episode.persona_id, owner.ownerId));
  await upsertDestination(destinationFixture(episode.destination_id));
  for (const shot_no of [1, 2]) {
    await enqueueTask({ episode_id: episode.episode_id, stage: "video", shot_no });
    expect(failTaskWithCredits((await dequeueTask())!, false)).toBe(true);
  }
  const app = buildApp();
  const post = (body: unknown) => app.request(`/api/episodes/${episode.episode_id}/retry`, {
    method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" },
    body: JSON.stringify(body) });
  const detail = async () => (await (await app.request(`/api/episodes/${episode.episode_id}`,
    { headers: { cookie: owner.cookie } })).json()) as Record<string, any>;
  return { owner, episode, post, detail };
}

test.each([
  ["both", { shot_no: 1, all: true }],
  ["zero", { shot_no: 0 }],
  ["negative", { shot_no: -1 }],
  ["float", { shot_no: 1.5 }],
  ["string shot", { shot_no: "1" }],
  ["string all", { all: "true" }],
  ["null shot", { shot_no: null }],
] as const)("retry rejects invalid target: %s", async (name, extra) => {
  const { post, detail, owner } = await seedTwoFailures(`rt-bad-${name.replace(/\W/g, "")}`);
  const rv = (await detail()).row_version as number;
  grantCredits(owner.ownerId, 100, "retry-target");
  const res = await post({ row_version: rv, ...extra });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ ok: false, error: "invalid_target" });
  expect(getCreditBalance(owner.ownerId)).toEqual({ available: 100, reserved: 0 });
  expect(await dequeueTask()).toBeNull();
});

test("detail lists every retryable failure while failed_task stays the latest one", async () => {
  const { detail } = await seedTwoFailures("rt-list");
  const body = await detail();
  expect(body.failed_task).toEqual({ stage: "video", shot_no: 2 });
  expect(body.failed_tasks).toHaveLength(2);
  expect(body.failed_tasks).toEqual(expect.arrayContaining([
    { stage: "video", shot_no: 1 }, { stage: "video", shot_no: 2 }]));
});

test("retry with shot_no queues only that shot and returns queued/skipped", async () => {
  const { post, detail, owner } = await seedTwoFailures("rt-shot");
  grantCredits(owner.ownerId, 100, "retry-target");
  const res = await post({ row_version: (await detail()).row_version, shot_no: 1 });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, stage: "video", shot_no: 1,
    queued: [{ stage: "video", shot_no: 1 }], skipped: [] });
  expect(await dequeueTask()).toMatchObject({ stage: "video", shot_no: 1 });
  expect(await dequeueTask()).toBeNull();
  expect((await detail()).failed_tasks).toEqual([{ stage: "video", shot_no: 2 }]);
});

test("retry with all queues every failure in one call", async () => {
  const { post, detail, owner } = await seedTwoFailures("rt-all");
  grantCredits(owner.ownerId, 100, "retry-target");
  const res = await post({ row_version: (await detail()).row_version, all: true });
  expect(res.status).toBe(200);
  expect((await res.json()).queued).toHaveLength(2);
  expect((await detail()).failed_tasks).toEqual([]);
});

test("retry without new params keeps the legacy behaviour and retries the latest failure only", async () => {
  const { post, detail, owner } = await seedTwoFailures("rt-legacy");
  grantCredits(owner.ownerId, 100, "retry-target");
  const res = await post({ row_version: (await detail()).row_version });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, stage: "video", shot_no: 2 });
  expect((await detail()).failed_tasks).toEqual([{ stage: "video", shot_no: 1 }]);
});

test("retry with shot_no maps store errors: unknown shot 400, stale version 409, no credits 402", async () => {
  const { post, detail } = await seedTwoFailures("rt-err");
  const rv = (await detail()).row_version as number;
  expect(await (await post({ row_version: rv, shot_no: 3 })).json()).toMatchObject({ ok: false, error: "no_failed_task" });
  expect((await post({ row_version: rv + 99, shot_no: 1 })).status).toBe(409);
  expect((await post({ row_version: rv, shot_no: 1 })).status).toBe(402);
});
