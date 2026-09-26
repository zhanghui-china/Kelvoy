import { dequeueTask, insertEpisode, insertPersona, upsertDestination } from "@kelvoy/store";
import { expect, test } from "bun:test";
import type { Episode, Template } from "@kelvoy/engine";
import { setupEpisodeRouteTests, buildApp, destinationFixture, fixture, login, personaFixture, shotFixture } from "./episode-test-fixtures";

setupEpisodeRouteTests();

test("legacy grid review actions cannot enqueue new generation", async () => {
  const { cookie, ownerId } = await login("legacy-grid-actions");
  const app = buildApp();
  for (const [suffix, status, path] of [
    ["continue", "script_review", "continue"],
    ["recompose", "done", "recompose"],
    ["regen", "kf_review", "shots/1/regen"],
    ["report", "kf_review", "shots/1/report-bad"],
  ] as const) {
    const episode = fixture(`e_grid_${suffix}`, ownerId);
    episode.mode = "grid";
    episode.status = status;
    episode.shots = [shotFixture(1, { status: "kf_ready", candidates: ["kf/1.png"] })];
    await insertEpisode(episode);
    const response = await app.request(`/api/episodes/${episode.episode_id}/${path}`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ row_version: 1 }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("grid_unavailable");
    expect(await dequeueTask()).toBeNull();
  }
});

test("PATCH /:id applies a field patch and bumps row_version", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_1", ownerId));

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { credits_used: 3 } }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, row_version: 2 });

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const body = (await got.json()) as { episode: Episode };
  expect(body.episode.credits_used).toBe(3);
});

test("PATCH /:id 409s on a stale row_version", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_1", ownerId));

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 999, patch: { credits_used: 3 } }),
  });
  expect(res.status).toBe(409);
});

test("PATCH /:id 400s on an illegal status transition", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_1", ownerId)); // status: draft

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { status: "done" } }), // draft -> done: no such edge
  });
  expect(res.status).toBe(400);
});

test("PATCH /:id 404s on someone else's episode", async () => {
  const { cookie } = await login("dannei");
  await insertEpisode(fixture("e_1", "u_someone_else"));

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { credits_used: 3 } }),
  });
  expect(res.status).toBe(404);
});

test("PATCH /:id/shots/:no applies a shot patch and bumps the episode's row_version", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.shots = [shotFixture(1)];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { candidates: ["kf/01_a.png"] } }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const body = (await got.json()) as { episode: Episode };
  expect(body.episode.shots[0]?.candidates).toEqual(["kf/01_a.png"]);
});

test("PATCH /:id/shots/:no 404s on a shot number that doesn't exist", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.shots = [shotFixture(1)];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/99", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { candidates: ["x.png"] } }),
  });
  expect(res.status).toBe(404);
});

test("POST /:id/save-as-template requires login", async () => {
  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/save-as-template", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "我的模板" }),
  });
  expect(res.status).toBe(401);
});

test("POST /:id/save-as-template derives a private template from the episode's skeleton/style/render", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  await insertPersona(personaFixture("c_1", ownerId));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.persona_id = "c_1";
  episode.render.intro = "intro/custom.mp4";
  episode.render.outro = "outro/custom.mp4";
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/save-as-template", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "我的模板" }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { ok: boolean; template: Template };
  expect(body.template.owner_id).toBe(ownerId);
  expect(body.template.name).toBe("我的模板");
  expect(body.template.skeleton).toBe("scenic_area");
  expect(body.template.lut).toBe("lut/warm_film.cube");
  expect(body.template.title_style).toBe("serif-center");
  expect(body.template.intro).toBe("intro/custom.mp4");
  expect(body.template.outro).toBe("outro/custom.mp4");
});

test("POST /:id/save-as-template 400s on a missing name", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  await insertPersona(personaFixture("c_1", ownerId));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.persona_id = "c_1";
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/save-as-template", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(400);
});

test("POST /:id/save-as-template 404s on someone else's episode", async () => {
  const { cookie } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  await insertPersona(personaFixture("c_1", "u_someone_else"));
  const episode = fixture("e_1", "u_someone_else");
  episode.destination_id = "d_1";
  episode.persona_id = "c_1";
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/save-as-template", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "我的模板" }),
  });
  expect(res.status).toBe(404);
});

test("POST /:id/continue advances script_review -> assets and enqueues one whole-episode task", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.status = "script_review";
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/continue", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const body = (await got.json()) as { episode: Episode };
  expect(body.episode.status).toBe("assets");

  const task = await dequeueTask();
  expect(task?.stage).toBe("assets");
  expect(task?.shot_no).toBeUndefined();
});

test("POST /:id/continue advances kf_review only when every keyframe is selected", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.status = "kf_review";
  episode.shots = [
    shotFixture(1, { status: "kf_selected", candidates: ["kf/1.png"], kf_selected: "kf/1.png" }),
    shotFixture(2, { status: "kf_selected", candidates: ["kf/2.png"], kf_selected: "kf/2.png" }),
    shotFixture(3, { status: "kf_ready" }),
  ];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/continue", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(400);
  expect((await res.json() as { error: string }).error).toBe("keyframes_not_selected");
  expect(await dequeueTask()).toBeNull();

  const second = await app.request("/api/episodes/e_1/shots/3", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { status: "kf_selected", candidates: ["kf/3.png"], kf_selected: "kf/3.png" } }),
  });
  expect(second.status).toBe(200);
  const proceed = await app.request("/api/episodes/e_1/continue", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 2 }),
  });
  expect(proceed.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  expect(((await got.json()) as { episode: Episode }).episode.status).toBe("clipping");

  const shotNos = new Set<number | undefined>();
  for (let i = 0; i < 3; i++) {
    const task = await dequeueTask();
    expect(task?.stage).toBe("video");
    shotNos.add(task?.shot_no);
  }
  expect(shotNos).toEqual(new Set([1, 2, 3]));
  expect(await dequeueTask()).toBeNull();
});

test("POST /:id/continue requires every clip to be approved", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.status = "clip_review";
  episode.shots = [
    shotFixture(1, { status: "approved", clip: "clip/1.mp4" }),
    shotFixture(2, { status: "clip_ready", clip: "clip/2.mp4" }),
  ];
  await insertEpisode(episode);
  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/continue", {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(400);
  expect((await res.json() as { error: string }).error).toBe("clips_not_approved");
  expect(await dequeueTask()).toBeNull();
});

test("POST /:id/continue 400s outside a review gate", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_1", ownerId)); // status: draft, not a review gate

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/continue", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(400);
});

test("POST /:id/shots/:no/regen rejects the shot, infers regen_stage from status, and enqueues", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.status = "kf_review";
  episode.shots = [shotFixture(1, { status: "kf_ready" })];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1/regen", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const shot = ((await got.json()) as { episode: Episode }).episode.shots[0];
  expect(shot?.status).toBe("rejected");
  expect(shot?.regen_stage).toBe("keyframe"); // kf_ready -> still picking a keyframe

  const task = await dequeueTask();
  expect(task?.stage).toBe("keyframe");
  expect(task?.shot_no).toBe(1);
});

test("POST /:id/shots/:no/regen honors an explicit regen_stage override", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.status = "done";
  episode.shots = [shotFixture(1, { status: "approved" })];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1/regen", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, regen_stage: "keyframe" }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const reopened = ((await got.json()) as { episode: Episode }).episode;
  const shot = reopened.shots[0];
  expect(shot?.regen_stage).toBe("keyframe");
  expect(reopened.status).toBe("kf_review");
});

test("keyframe regen from clip review carries approved shots through to video", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.status = "clip_review";
  episode.shots = [
    shotFixture(1, { status: "clip_ready", candidates: ["kf/old.png"],
      kf_selected: "kf/old.png", clip: "clip/old.mp4" }),
    shotFixture(2, { status: "approved", candidates: ["kf/keep.png"],
      kf_selected: "kf/keep.png", clip: "clip/keep.mp4" }),
  ];
  await insertEpisode(episode);
  const app = buildApp();
  const regen = await app.request("/api/episodes/e_1/shots/1/regen", {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, regen_stage: "keyframe" }),
  });
  expect(regen.status).toBe(200);
  const first = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const reopened = ((await first.json()) as { episode: Episode }).episode;
  expect(reopened.status).toBe("kf_review");
  expect(reopened.shots[1]?.status).toBe("approved");
  expect(reopened.shots[1]?.clip).toBe("clip/keep.mp4");
  const generationTask = await dequeueTask();
  expect(generationTask?.stage).toBe("keyframe");

  // Simulate the worker's state hops, then make the review decision.
  const generating = await app.request("/api/episodes/e_1/shots/1", {
    method: "PATCH", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 2, patch: { status: "generating_kf" } }),
  });
  expect(generating.status).toBe(200);
  const ready = await app.request("/api/episodes/e_1/shots/1", {
    method: "PATCH", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 3, patch: { status: "kf_ready", candidates: ["kf/new.png"] } }),
  });
  expect(ready.status).toBe(200);
  const selected = await app.request("/api/episodes/e_1/shots/1", {
    method: "PATCH", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 4, patch: { status: "kf_selected", kf_selected: "kf/new.png" } }),
  });
  expect(selected.status).toBe(200);
  const proceed = await app.request("/api/episodes/e_1/continue", {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 5 }),
  });
  expect(proceed.status).toBe(200);
  const videoTask = await dequeueTask();
  expect(videoTask?.stage).toBe("video");
  expect(videoTask?.shot_no).toBe(1);
  expect(await dequeueTask()).toBeNull();
});

test("POST /:id/shots/:no/regen 400s from a status that isn't a regen source", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.shots = [shotFixture(1, { status: "draft" })]; // draft can't go straight to rejected
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1/regen", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(400);
});

test("POST /:id/shots/:no/report-bad marks bad_shot_reported, rejects, and enqueues a free regen", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.status = "done";
  episode.shots = [shotFixture(1, {
    status: "approved", candidates: ["kf/1.png"], kf_selected: "kf/1.png", clip: "clip/1.mp4",
  })];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1/report-bad", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const reopened = ((await got.json()) as { episode: Episode }).episode;
  const shot = reopened.shots[0];
  expect(shot?.bad_shot_reported).toBe(true);
  expect(shot?.status).toBe("rejected");
  expect(shot?.regen_stage).toBe("video"); // approved -> clip already made, redo the clip
  expect(reopened.status).toBe("clip_review");

  const task = await dequeueTask();
  expect(task?.stage).toBe("video");
  expect(task?.shot_no).toBe(1);
});
