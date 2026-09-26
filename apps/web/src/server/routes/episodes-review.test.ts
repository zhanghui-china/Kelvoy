import { dequeueTask, insertEpisode, upsertDestination } from "@kelvoy/store";
import { expect, test } from "bun:test";
import type { Episode } from "@kelvoy/engine";
import { setupEpisodeRouteTests, buildApp, compliantShots, destinationFixture, fixture, login, shotFixture } from "./episode-test-fixtures";

setupEpisodeRouteTests();

test("POST /:id/shots/:no/remove deletes the shot and re-validates FR-02 on what's left", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.shots = compliantShots(25, 6); // extra shot + extra landmark headroom
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/25/remove", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const body = (await got.json()) as { episode: Episode };
  expect(body.episode.shots).toHaveLength(24);
  expect(body.episode.shots.some((s) => s.no === 25)).toBe(false);
  expect(body.episode.removed_shots.map((s) => s.no)).toEqual([25]);
});

test("POST /:id/shots/:no/remove 400s when it would drop below the MIN_SHOTS floor", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.shots = compliantShots(24, 6); // exactly at the floor
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/24/remove", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(400);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  expect(((await got.json()) as { episode: Episode }).episode.shots).toHaveLength(24); // untouched
});

test("POST /:id/shots/:no/remove 400s when the remainder fails FR-02 (landmark coverage)", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.shots = compliantShots(25, 5); // exactly at the MIN_LANDMARK_SHOTS floor
  await insertEpisode(episode);

  const app = buildApp();
  // shot 1 is one of the 5 landmark shots — removing it drops coverage to 4
  const res = await app.request("/api/episodes/e_1/shots/1/remove", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(400);
  const errBody = (await res.json()) as { error: string };
  expect(errBody.error).toBe("script_rule_violation");

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  expect(((await got.json()) as { episode: Episode }).episode.shots).toHaveLength(25); // untouched
});

test("POST /:id/recompose moves done -> composing and enqueues a compose task", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.status = "done";
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/recompose", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  expect(((await got.json()) as { episode: Episode }).episode.status).toBe("composing");

  const task = await dequeueTask();
  expect(task?.stage).toBe("compose");
});

test("POST /:id/recompose 400s from any status other than done", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.status = "clip_review"; // also a legal advance -> composing, but not via this endpoint
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/recompose", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(400);
});

test("fixed-cut episodes pause for compose settings and enqueue only after start", async () => {
  const { cookie, ownerId } = await login("fixed-compose");
  const episode = fixture("e_fixed", ownerId);
  episode.cut_policy = "fixed_1s";
  episode.status = "clip_review";
  episode.shots = [shotFixture(1, { status: "approved", clip: "clip/01.mp4" })];
  await insertEpisode(episode);
  const app = buildApp();

  const ready = await app.request("/api/episodes/e_fixed/continue", {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(ready.status).toBe(200);
  expect((await dequeueTask())).toBeNull();
  expect(((await (await app.request("/api/episodes/e_fixed", { headers: { cookie } })).json()) as { episode: Episode }).episode.status).toBe("compose_ready");

  const start = await app.request("/api/episodes/e_fixed/continue", {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 2 }),
  });
  expect(start.status).toBe(200);
  expect((await dequeueTask())?.stage).toBe("compose");
});

// ---- M2-9 (#31): 审片台交互页要的写路由 ----

test("PATCH /:id/shots/:no applies the review-1/2 editable fields", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.shots = [shotFixture(1)];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      row_version: 1,
      patch: {
        beat: "抬头看大佛",
        size: "close",
        camera: "push",
        landmark: "l1",
        kf_prompt: "仰角特写",
        motion_prompt: "缓慢上摇",
      },
    }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const shot = ((await got.json()) as { episode: Episode }).episode.shots[0];
  expect(shot?.beat).toBe("抬头看大佛");
  expect(shot?.size).toBe("close");
  expect(shot?.camera).toBe("push");
  expect(shot?.landmark).toBe("l1");
  expect(shot?.kf_prompt).toBe("仰角特写");
  expect(shot?.motion_prompt).toBe("缓慢上摇");
});

test("PATCH /:id/shots/:no 400s with content_blocked when an edited prompt hits the blocklist", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.shots = [shotFixture(1)];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { kf_prompt: "裸体 站在山顶" } }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string; violations: { field: string; term: string }[] };
  expect(body.error).toBe("content_blocked");
  expect(body.violations[0]?.field).toBe("kf_prompt");

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  expect(((await got.json()) as { episode: Episode }).episode.shots[0]?.kf_prompt).toBe(""); // untouched
});

test("PATCH /:id/shots/:no 400s on a landmark id the destination doesn't have", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.shots = [shotFixture(1)];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { landmark: "l_nope" } }),
  });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toBe("landmark_reference");
});

test("PATCH /:id/shots/:no accepts clearing the landmark to null", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.shots = [shotFixture(1, { landmark: "l1" })];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { landmark: null } }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  expect(((await got.json()) as { episode: Episode }).episode.shots[0]?.landmark).toBeNull();
});

test("POST /:id/shots/reorder reorders and renumbers the shots", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.status = "script_review";
  episode.shots = compliantShots(24, 6);
  await insertEpisode(episode);

  const app = buildApp();
  const order = episode.shots.map((s) => s.no).reverse();
  const res = await app.request("/api/episodes/e_1/shots/reorder", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, order }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const shots = ((await got.json()) as { episode: Episode }).episode.shots;
  expect(shots.map((s) => s.no)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  expect(shots[0]?.size).toBe(episode.shots[23].size); // last shot moved to the front
});

test("POST /:id/shots/reorder 400s when the new order breaks FR-02 (size run)", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.status = "script_review";
  episode.shots = compliantShots(24, 6); // sizes cycle wide/medium/close
  await insertEpisode(episode);

  // 1/4/7 are all "wide" — putting them next to each other is a run of 3
  const rest = episode.shots.map((s) => s.no).filter((no) => ![1, 4, 7].includes(no));
  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/reorder", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, order: [1, 4, 7, ...rest] }),
  });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toBe("script_rule_violation");

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const shots = ((await got.json()) as { episode: Episode }).episode.shots;
  expect(shots.map((s) => s.no)).toEqual(episode.shots.map((s) => s.no)); // untouched
});

test("POST /:id/shots/reorder 400s on an order that isn't a permutation of the shots", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.status = "script_review";
  episode.shots = compliantShots(24, 6);
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/reorder", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, order: [1, 2, 3] }),
  });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toBe("invalid_order");
});

test("POST /:id/shots/reorder 400s outside review 1", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.status = "kf_review";
  episode.shots = compliantShots(24, 6);
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/reorder", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, order: episode.shots.map((s) => s.no).reverse() }),
  });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toBe("invalid_order");
});

test("POST /:id/shots/reorder 409s on a stale row_version", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.status = "script_review";
  episode.shots = compliantShots(24, 6);
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/reorder", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 99, order: episode.shots.map((s) => s.no).reverse() }),
  });
  expect(res.status).toBe(409);
});

test("POST /:id/shots/reorder 404s on someone else's episode", async () => {
  const { cookie } = await login("dannei");
  const episode = fixture("e_1", "u_someone_else");
  episode.status = "script_review";
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/reorder", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, order: [] }),
  });
  expect(res.status).toBe(404);
});

// ---- FR-12 分享开关 ----

test("POST /:id/share enables sharing and returns a slug", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.status = "done";
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/share", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, enabled: true }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { slug: string };
  expect(body.slug.length).toBeGreaterThan(0);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const gotEpisode = ((await got.json()) as { episode: Episode }).episode;
  expect(gotEpisode.share).toEqual({ enabled: true, slug: body.slug });
});

test("POST /:id/share 404s on someone else's episode", async () => {
  const { cookie } = await login("dannei");
  await insertEpisode(fixture("e_1", "u_someone_else"));

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/share", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, enabled: true }),
  });
  expect(res.status).toBe(404);
});

test("POST /:id/share 400s on a missing enabled flag", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_1", ownerId));

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/share", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(400);
});
