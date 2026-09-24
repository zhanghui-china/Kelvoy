import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Destination, Episode } from "@kelvoy/engine";
import { close, dequeueTask, enqueueTask, getEpisode, insertEpisode, open, upsertDestination } from "@kelvoy/store";
import { consumeLoop, handleTask } from "./consumer";

function fixtureEpisode(id: string): Episode {
  return {
    episode_id: id,
    owner_id: "u_test",
    persona_id: "c_test",
    persona_version: 1,
    destination_id: "d_test",
    destination_version: 1,
    series_id: "s_test",
    template_id: "t_test",
    status: "draft",
    mode: "per_shot",
    created_at: "2026-09-23T00:00:00+08:00",
    estimated_credits: 0,
    credits_used: 0,
    share: { enabled: false, slug: "" },
    brief: {
      season: "秋",
      aspect: "9:16",
      duration_s: 30,
      tone: "松弛",
      outfit_override: null,
      banned: [],
    },
    grid_refs: [],
    scenes: [],
    shots: [],
    removed_shots: [],
    music: { file: "", bpm: 0, license: "" },
    render: { res: "1080x1920", fps: 30, title: "", intro: null, outro: null, ai_label: true },
  };
}

function destinationFixture(id: string): Destination {
  return {
    destination_id: id,
    version: 1,
    name: "测试景区",
    city: "测试市",
    type: "scenic_area",
    season_best: [],
    landmarks: [],
    route: [],
    food: [],
    transport: "",
    stay: "",
  };
}

beforeEach(() => {
  open(":memory:");
});

afterEach(() => {
  close();
});

test("handleTask fails permanently when the episode doesn't exist", async () => {
  const task = await enqueueTask({ episode_id: "e_missing", stage: "brief" });
  await dequeueTask();
  await handleTask(task);

  // requeue: false -> not pending again
  expect(await dequeueTask()).toBeNull();
});

test("handleTask auto-enqueues script once brief lands the episode in scripting (#39)", async () => {
  await insertEpisode(fixtureEpisode("e_brief"));
  const task = await enqueueTask({ episode_id: "e_brief", stage: "brief" });
  await dequeueTask();
  await handleTask(task);

  const next = await dequeueTask();
  expect(next?.episode_id).toBe("e_brief");
  expect(next?.stage).toBe("script");
});

test("handleTask requeues on stage failure while under the local retry budget", async () => {
  await insertEpisode(fixtureEpisode("e_1"));
  // "assets" is still a not-implemented stub (unlike "brief", real since
  // M1-10) — convenient stand-in for "a stage that currently fails".
  const task = await enqueueTask({ episode_id: "e_1", stage: "assets" });
  await dequeueTask(); // attempt 1, now "processing"

  await handleTask(task); // runStage("assets", ...) throws (not implemented yet)

  const retried = await dequeueTask();
  expect(retried?.task_id).toBe(task.task_id);
  expect(retried?.attempt).toBe(2);
});

test("handleTask stops requeuing once MAX_LOCAL_ATTEMPTS is exhausted", async () => {
  await insertEpisode(fixtureEpisode("e_2"));
  const task = await enqueueTask({ episode_id: "e_2", stage: "assets" });

  // First attempt: fails, requeues (attempt 1 -> 2).
  await dequeueTask();
  await handleTask(task);
  const secondAttempt = await dequeueTask();
  expect(secondAttempt?.attempt).toBe(2);

  // Second attempt: fails again, budget exhausted -> no more requeue.
  await handleTask(secondAttempt!);
  expect(await dequeueTask()).toBeNull();
});

test("handleTask fails permanently and marks the episode failed when content is blocked (#29)", async () => {
  const episode = fixtureEpisode("e_blocked");
  episode.status = "scripting";
  episode.brief.tone = "色情";
  await insertEpisode(episode);
  await upsertDestination(destinationFixture("d_test"));

  const task = await enqueueTask({ episode_id: "e_blocked", stage: "script" });
  await dequeueTask();
  await handleTask(task);

  // requeue: false -> not pending again
  expect(await dequeueTask()).toBeNull();

  const result = await getEpisode("e_blocked");
  expect(result.ok && result.episode.status).toBe("failed");
});

test("consumeLoop stops promptly once its AbortSignal fires", async () => {
  const controller = new AbortController();
  controller.abort();
  // Already aborted before the loop's first check — should return
  // immediately rather than polling forever.
  await consumeLoop(controller.signal);
  expect(true).toBe(true);
});
