import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Destination, Episode, Persona, Shot } from "@kelvoy/engine";
import {
  close,
  dequeueTask,
  enqueueTask,
  getEpisode,
  insertEpisode,
  insertPersona,
  open,
  patchEpisode,
  patchShot,
  upsertDestination,
  updatePersona,
  submitScriptAction,
  grantCredits,
  getDb,
} from "@kelvoy/store";
import { ffmpegComposeProvider } from "../compose/ffmpeg";
import { buildStageContext, consumeLoop, handleTask } from "./consumer";

function fixtureEpisode(id: string): Episode {
  return {
    name: "测试期", episode_id: id,
    owner_id: "u_test",
    persona_id: "c_test",
    persona_version: 1,
    destination_id: "d_test",
    destination_version: 1,
    series_id: "s_test",
    template_id: "t_test",
    status: "draft",
    mode: "per_shot", candidate_count: 2,
    created_at: "2026-09-23T00:00:00+08:00",
    estimated_credits: 0,
    credits_used: 0,
    share: { enabled: false, slug: "" },
    brief: {
      season: "秋",
      aspect: "9:16",
      requirements: "",
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

function personaFixture(id: string): Persona {
  return {
    persona_id: id,
    owner_id: "u_test",
    version: 1,
    name: "测试角色",
    desc: "",
    locked: [],
    default_outfit: "",
    refs: [],
    style: { lut: "lut/warm_film.cube", title_style: "serif-center" },
  };
}

function shotFixture(): Shot {
  return {
    no: 1, scene: "s1", size: "medium", beat: "经过地标", camera: "push",
    landmark: "l1", kf_prompt: "角色在地标前", motion_prompt: "角色转身",
    duration_s: 1.5, candidates: [], kf_selected: null, clip: null,
    trim_start_s: null, status: "draft", regen_stage: null,
    bad_shot_reported: false, model: {},
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

test("failed script optimization preserves the original and clears its pending marker", async () => {
  const episode = { ...fixtureEpisode("e_revision"), status: "script_review" as const,
    shots: [shotFixture()] };
  await insertEpisode(episode);
  getDb().query("insert into users (user_id, username, password_hash) values ('u_test', 'tester', 'hash')").run();
  grantCredits("u_test", 3, "grant-revision");
  await upsertDestination(destinationFixture("d_test"));
  const submitted = submitScriptAction({ episode_id: episode.episode_id, owner_id: episode.owner_id,
    row_version: 1, operation: "script_optimize", instruction: "突出夜景" });
  expect(submitted.ok).toBe(true);
  const first = await dequeueTask();
  expect(first).not.toBeNull();
  const priorKey = process.env.STEPFUN_API_KEY;
  delete process.env.STEPFUN_API_KEY;
  try {
    await handleTask(first!);
    const second = await dequeueTask();
    expect(second?.attempt).toBe(2);
    await handleTask(second!);
    const updated = await getEpisode(episode.episode_id);
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.episode.shots[0]?.beat).toBe("经过地标");
      expect(updated.episode.script_pending_task_id).toBeNull();
      expect(updated.episode.script_action_error).toContain("原稿已保留");
    }
    expect(await dequeueTask()).toBeNull();
  } finally {
    if (priorKey === undefined) delete process.env.STEPFUN_API_KEY;
    else process.env.STEPFUN_API_KEY = priorKey;
  }
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

test("buildStageContext reads destination + persona and injects ffmpeg only for compose (#28)", async () => {
  const episode = fixtureEpisode("e_ctx");
  await insertEpisode(episode);
  await upsertDestination(destinationFixture("d_test"));
  await insertPersona(personaFixture("c_test"));

  const scriptContext = await buildStageContext("script", episode);
  expect(scriptContext.destination?.destination_id).toBe("d_test");
  // compose 要拿角色的账号级 LUT / 标题样式，所以 persona 每个 stage 都读。
  expect(scriptContext.persona?.persona_id).toBe("c_test");
  // ffmpeg 只在 worker 上跑，engine 不 import 它——只有 compose 任务才注入。
  expect(scriptContext.compose).toBeUndefined();

  const composeContext = await buildStageContext("compose", episode);
  expect(composeContext.compose).toBe(ffmpegComposeProvider);
});

test("buildStageContext uses the episode's frozen official persona revision", async () => {
  const episode = fixtureEpisode("e_frozen");
  await insertPersona({ ...personaFixture("c_test"), owner_id: null });
  await insertEpisode(episode);
  await updatePersona("c_test", { name: "新版角色", style: { lut: "new", title_style: "new" } });
  const context = await buildStageContext("script", episode);
  expect(context.persona?.name).toBe(personaFixture("c_test").name);
  expect(context.persona?.style.lut).toBe(personaFixture("c_test").style.lut);
});

test("assets, one keyframe shot and video reach both review gates", async () => {
  const ep = fixtureEpisode("e_one_shot");
  ep.status = "assets";
  ep.shots = [shotFixture()];
  await insertEpisode(ep);
  await insertPersona({ ...personaFixture("c_test"), refs: ["p/front.png", "p/side.png", "p/full.png"] });
  await upsertDestination({ ...destinationFixture("d_test"), landmarks: [{
    id: "l1", name: "地标", refs: ["d/a.jpg", "d/b.jpg", "d/c.jpg"], best_time: "上午",
  }] });

  const assets = await enqueueTask({ episode_id: ep.episode_id, stage: "assets" });
  await dequeueTask();
  await handleTask(assets);
  const keyframeTask = await dequeueTask();
  expect(keyframeTask?.stage).toBe("keyframe");
  expect(keyframeTask?.shot_no).toBe(1);
  await handleTask(keyframeTask!, { keyframe: { async generate(input) {
    return { key: `kf/01_${input.candidate_no}.png`, model: "Qwen-Image-2.1",
      version: "v1", seed: input.seed, seconds: 40, ref_hashes: ["h1", "h2"] };
  } } });
  const ready = await getEpisode(ep.episode_id);
  if (!ready.ok) throw new Error("episode disappeared");
  expect(ready.episode.status).toBe("kf_review");
  expect(ready.episode.shots[0]?.status).toBe("kf_ready");
  expect(ready.episode.shots[0]?.candidates).toHaveLength(2);

  const selected = await patchShot(ep.episode_id, 1, ready.row_version, {
    status: "kf_selected", kf_selected: ready.episode.shots[0]!.candidates[0],
  });
  if (!selected.ok) throw new Error(selected.error);
  const clipping = await patchEpisode(ep.episode_id, selected.row_version, { status: "clipping" });
  if (!clipping.ok) throw new Error(clipping.error);
  const videoTask = await enqueueTask({ episode_id: ep.episode_id, stage: "video", shot_no: 1 });
  await dequeueTask();
  await handleTask(videoTask, { video: { async generate(input) {
    expect(input.keyframe).toBe("kf/01_0.png");
    return { key: "clip/01_new.mp4", model: "MiniMax-H3", version: "v2",
      seed: input.seed, seconds: 65, ref_hashes: ["frame-hash"] };
  } } });
  const finished = await getEpisode(ep.episode_id);
  expect(finished.ok && finished.episode.status).toBe("clip_review");
  expect(finished.ok && finished.episode.shots[0]?.clip).toBe("clip/01_new.mp4");
  expect(finished.ok && finished.episode.shots[0]?.model.video?.ref_hashes).toEqual(["frame-hash"]);
});

test("a queued video task never regenerates an approved shot", async () => {
  const ep = fixtureEpisode("e_approved");
  ep.status = "clip_review";
  ep.shots = [shotFixture()];
  ep.shots[0]!.status = "approved";
  ep.shots[0]!.clip = "clip/01_old.mp4";
  await insertEpisode(ep);
  const task = await enqueueTask({ episode_id: ep.episode_id, stage: "video", shot_no: 1 });
  await dequeueTask();
  await handleTask(task, { video: { async generate() { throw new Error("should not run"); } } });
  const actual = await getEpisode(ep.episode_id);
  expect(actual.ok && actual.episode.shots[0]?.clip).toBe("clip/01_old.mp4");
  expect(await dequeueTask()).toBeNull();
});
