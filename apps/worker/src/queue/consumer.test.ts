import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Destination, Episode, Persona, Shot } from "@kelvoy/engine";
import {
  close,
  saveSystemConfig,
  dequeueTask,
  enqueueTask,
  getEpisode,
  getLatestFailedTask,
  insertEpisode,
  insertPersona,
  open,
  patchEpisode,
  patchShot,
  prepareTaskShot,
  upsertDestination,
  updatePersona,
  submitScriptAction,
  grantCredits,
  getDb,
  submitFailedTaskRetry,
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
  await enqueueTask({ episode_id: "e_missing", stage: "brief" });
  await handleTask((await dequeueTask())!);

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
  await enqueueTask({ episode_id: "e_brief", stage: "brief" });
  await handleTask((await dequeueTask())!);

  const next = await dequeueTask();
  expect(next?.episode_id).toBe("e_brief");
  expect(next?.stage).toBe("script");
});

test("handleTask requeues on stage failure while under the local retry budget", async () => {
  await insertEpisode(fixtureEpisode("e_1"));
  // "assets" is still a not-implemented stub (unlike "brief", real since
  // M1-10) — convenient stand-in for "a stage that currently fails".
  const task = await enqueueTask({ episode_id: "e_1", stage: "assets" });
  await handleTask((await dequeueTask())!); // runStage("assets", ...) throws

  const retried = await dequeueTask();
  expect(retried?.task_id).toBe(task.task_id);
  expect(retried?.attempt).toBe(2);
});

test("handleTask stops requeuing once MAX_LOCAL_ATTEMPTS is exhausted", async () => {
  await insertEpisode(fixtureEpisode("e_2"));
  await enqueueTask({ episode_id: "e_2", stage: "assets" });

  // First attempt: fails, requeues (attempt 1 -> 2).
  await handleTask((await dequeueTask())!);
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

  await enqueueTask({ episode_id: "e_blocked", stage: "script" });
  await handleTask((await dequeueTask())!);

  // requeue: false -> not pending again
  expect(await dequeueTask()).toBeNull();

  const result = await getEpisode("e_blocked");
  expect(result.ok && result.episode.status).toBe("failed");
});

test("terminal StepFun quota failure tells the reviewer why retry cannot work yet", async () => {
  const episode = { ...fixtureEpisode("e_quota"), status: "scripting" as const };
  await insertEpisode(episode);
  await upsertDestination(destinationFixture("d_test"));
  await enqueueTask({ episode_id: episode.episode_id, stage: "script" });
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.STEPFUN_API_KEY;
  process.env.STEPFUN_API_KEY = "test-key";
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: {
    message: "You exceeded your current quota", type: "quota_exceeded",
  } }), { status: 402 })) as unknown as typeof fetch;
  try {
    await handleTask((await dequeueTask())!);
    const retry = await dequeueTask();
    await handleTask(retry!);
    const result = await getEpisode(episode.episode_id);
    expect(result.ok && result.episode.status).toBe("failed");
    expect(result.ok && result.episode.failure_reason).toContain("额度不足");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.STEPFUN_API_KEY;
    else process.env.STEPFUN_API_KEY = originalKey;
  }
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

  await enqueueTask({ episode_id: ep.episode_id, stage: "assets" });
  await handleTask((await dequeueTask())!);
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
  await enqueueTask({ episode_id: ep.episode_id, stage: "video", shot_no: 1 });
  await handleTask((await dequeueTask())!, { video: { async generate(input) {
    expect(input.keyframe).toBe("kf/01_0.png");
    return { key: "clip/01_new.mp4", model: "MiniMax-H3", version: "v2",
      seed: input.seed, seconds: 65, ref_hashes: ["frame-hash"] };
  } } });
  const finished = await getEpisode(ep.episode_id);
  expect(finished.ok && finished.episode.status).toBe("clip_review");
  expect(finished.ok && finished.episode.shots[0]?.clip).toBe("clip/01_new.mp4");
  expect(finished.ok && finished.episode.shots[0]?.model.video?.ref_hashes).toEqual(["frame-hash"]);
});

test("worker preserves a different shot selection made while inference is running", async () => {
  const ep = fixtureEpisode("e_cross_shot");
  ep.status = "keyframing";
  ep.candidate_count = 1;
  ep.shots = [shotFixture(), { ...shotFixture(), no: 2, status: "kf_ready",
    candidates: ["kf/02_old.png"] }];
  await insertEpisode(ep);
  await insertPersona({ ...personaFixture("c_test"), refs: ["p/front.png"] });
  await upsertDestination({ ...destinationFixture("d_test"), landmarks: [{
    id: "l1", name: "地标", refs: ["d/a.jpg"], best_time: "上午",
  }] });
  await enqueueTask({ episode_id: ep.episode_id, stage: "keyframe", shot_no: 1 });
  const task = await dequeueTask();
  let resume!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => { resume = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const running = handleTask(task!, { keyframe: { async generate(input) {
    entered();
    await blocked;
    return { key: "kf/01_new.png", model: "Qwen-Image-2.1", version: "v1",
      seed: input.seed, seconds: 1, ref_hashes: ["a", "b"] };
  } } });
  await started;
  const during = await getEpisode(ep.episode_id);
  if (!during.ok) throw new Error("missing episode");
  expect((await patchShot(ep.episode_id, 2, during.row_version,
    { status: "kf_selected", kf_selected: "kf/02_old.png" })).ok).toBe(true);
  resume();
  await running;
  const done = await getEpisode(ep.episode_id);
  expect(done.ok && done.episode.status).toBe("kf_review");
  expect(done.ok && done.episode.shots[0]?.status).toBe("kf_ready");
  expect(done.ok && done.episode.shots[1]?.kf_selected).toBe("kf/02_old.png");
  expect(getDb().query<{ status: string }, [string]>("select status from tasks where task_id = ?")
    .get(task!.task_id)?.status).toBe("done");
  expect(await dequeueTask()).toBeNull();
});

test("cancelling a running generation leaves its task and result uncommitted", async () => {
  const ep = fixtureEpisode("e_cancel_running");
  ep.status = "keyframing";
  ep.candidate_count = 1;
  ep.shots = [shotFixture()];
  await insertEpisode(ep);
  await insertPersona({ ...personaFixture("c_test"), refs: ["p/front.png"] });
  await upsertDestination({ ...destinationFixture("d_test"), landmarks: [{
    id: "l1", name: "地标", refs: ["d/a.jpg"], best_time: "上午",
  }] });
  await enqueueTask({ episode_id: ep.episode_id, stage: "keyframe", shot_no: 1 });
  const task = await dequeueTask();
  const controller = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const running = handleTask(task!, { signal: controller.signal, keyframe: { async generate(input) {
    entered();
    await new Promise<void>((resolve) => input.signal!.addEventListener("abort", () => resolve(), { once: true }));
    return { key: "kf/obsolete.png", model: "Qwen-Image-2.1", version: "v1",
      seed: input.seed, seconds: 1, ref_hashes: ["a", "b"] };
  } } });
  await started;
  controller.abort();
  await running;
  const saved = await getEpisode(ep.episode_id);
  expect(saved.ok && saved.episode.shots[0]?.status).toBe("generating_kf");
  expect(saved.ok && saved.episode.shots[0]?.candidates).toEqual([]);
  expect(getDb().query<{ status: string }, [string]>("select status from tasks where task_id = ?")
    .get(task!.task_id)?.status).toBe("processing");
});

test("a reclaimed lease cannot mark a shot generating", async () => {
  const ep = fixtureEpisode("e_stale_prepare");
  ep.status = "keyframing";
  ep.shots = [shotFixture()];
  await insertEpisode(ep);
  await enqueueTask({ episode_id: ep.episode_id, stage: "keyframe", shot_no: 1 });
  const stale = (await dequeueTask())!;
  getDb().query("update tasks set lease_token = 'new-owner' where task_id = ?").run(stale.task_id);
  expect(prepareTaskShot(stale, 1, "generating_kf"))
    .toEqual({ ok: false, error: "lease_lost" });
  const saved = await getEpisode(ep.episode_id);
  expect(saved.ok && saved.episode.shots[0]?.status).toBe("draft");
});

test("editing the generating shot rejects stale output and leaves a retry entry", async () => {
  const ep = fixtureEpisode("e_stale_shot");
  ep.status = "kf_review";
  ep.candidate_count = 1;
  ep.shots = [shotFixture()];
  ep.shots[0]!.status = "rejected";
  ep.shots[0]!.regen_stage = "keyframe";
  await insertEpisode(ep);
  await insertPersona({ ...personaFixture("c_test"), refs: ["p/front.png"] });
  await upsertDestination({ ...destinationFixture("d_test"), landmarks: [{
    id: "l1", name: "地标", refs: ["d/a.jpg"], best_time: "上午",
  }] });
  await enqueueTask({ episode_id: ep.episode_id, stage: "keyframe", shot_no: 1 });
  const task = await dequeueTask();
  let resume!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => { resume = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const running = handleTask(task!, { keyframe: { async generate(input) {
    entered();
    await blocked;
    return { key: "kf/obsolete.png", model: "Qwen-Image-2.1", version: "v1",
      seed: input.seed, seconds: 1, ref_hashes: ["a", "b"] };
  } } });
  await started;
  const during = await getEpisode(ep.episode_id);
  if (!during.ok) throw new Error("missing episode");
  expect((await patchShot(ep.episode_id, 1, during.row_version,
    { kf_prompt: "更新后的镜头" })).ok).toBe(true);
  resume();
  await running;
  const saved = await getEpisode(ep.episode_id);
  expect(saved.ok && saved.episode.shots[0]?.status).toBe("failed");
  expect(saved.ok && saved.episode.shots[0]?.kf_prompt).toBe("更新后的镜头");
  expect(saved.ok && await getLatestFailedTask(saved.episode))
    .toEqual({ stage: "keyframe", shot_no: 1 });
  if (!saved.ok) throw new Error("missing episode");
  getDb().query("insert into users (user_id, username, password_hash) values ('u_test', 'retry-user', 'hash')").run();
  grantCredits("u_test", 1, "stale-retry-grant");
  expect(submitFailedTaskRetry({ episode_id: ep.episode_id, owner_id: ep.owner_id,
    row_version: saved.row_version }).ok).toBe(true);
  const retried = await getEpisode(ep.episode_id);
  expect(retried.ok && retried.episode.status).toBe("kf_review");
  expect((await dequeueTask())?.stage).toBe("keyframe");
});

test("direct reference episode reaches clip review without image task", async () => {
  const ep = { ...fixtureEpisode("e_direct"), video_source: "references" as const,
    status: "assets" as const, shots: [shotFixture()] };
  await insertEpisode(ep);
  await insertPersona({ ...personaFixture("c_test"), refs: ["p/front.png", "p/side.png", "p/full.png"] });
  await upsertDestination({ ...destinationFixture("d_test"), landmarks: [{
    id: "l1", name: "地标", refs: ["d/a.jpg", "d/b.jpg", "d/c.jpg"], best_time: "上午",
  }] });
  await enqueueTask({ episode_id: ep.episode_id, stage: "assets" });
  await handleTask((await dequeueTask())!);
  const ready = await getEpisode(ep.episode_id);
  expect(ready.ok && ready.episode.status).toBe("clipping");
  expect(await dequeueTask()).toBeNull();
  await enqueueTask({ episode_id: ep.episode_id, stage: "video", shot_no: 1 });
  await handleTask((await dequeueTask())!, { video: { async generate(input) {
    expect(input.refs).toEqual(["p/front.png", "d/a.jpg"]);
    return { key: "clip/direct.mp4", model: "MiniMax-H3", version: "dual",
      seed: input.seed, seconds: 45, ref_hashes: ["person", "scene"] };
  } } });
  const finished = await getEpisode(ep.episode_id);
  expect(finished.ok && finished.episode.status).toBe("clip_review");
  expect(finished.ok && finished.episode.shots[0]?.kf_selected).toBeNull();
});

test("a queued video task never regenerates an approved shot", async () => {
  const ep = fixtureEpisode("e_approved");
  ep.status = "clip_review";
  ep.shots = [shotFixture()];
  ep.shots[0]!.status = "approved";
  ep.shots[0]!.clip = "clip/01_old.mp4";
  await insertEpisode(ep);
  await enqueueTask({ episode_id: ep.episode_id, stage: "video", shot_no: 1 });
  await handleTask((await dequeueTask())!, { video: { async generate() { throw new Error("should not run"); } } });
  const actual = await getEpisode(ep.episode_id);
  expect(actual.ok && actual.episode.shots[0]?.clip).toBe("clip/01_old.mp4");
  expect(await dequeueTask()).toBeNull();
});


test("persisted backend saves reach task HTTP requests and clearing restores inherited selection", async () => {
  const root = await mkdtemp(join(tmpdir(), "kelvoy-task-backend-"));
  const originalFetch = globalThis.fetch;
  const originalProjects = process.env.KELVOY_PROJECTS_ROOT;
  const originalInference = process.env.INFERENCE_BASE_URL;
  const requests: { address: string; body: { comfyui_base_url?: string | null; seed: number } }[] = [];
  try {
    process.env.KELVOY_PROJECTS_ROOT = root;
    process.env.INFERENCE_BASE_URL = "http://task-inference:8100";
    await mkdir(join(root, "p"), { recursive: true });
    await mkdir(join(root, "inference", "image"), { recursive: true });
    await writeFile(join(root, "p", "front.png"), "persona reference");
    await insertPersona({ ...personaFixture("c_test"), refs: ["p/front.png"] });
    await upsertDestination(destinationFixture("d_test"));
    globalThis.fetch = (async (address, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push({ address: String(address), body });
      const key = `inference/image/result-${requests.length}.png`;
      await writeFile(join(root, key), `candidate ${requests.length}`);
      return Response.json({ paths: [key], model: "mock-Qwen", version: "1",
        seed: body.seed, seconds: 0 });
    }) as typeof fetch;
    expect((await saveSystemConfig(1, { comfyui_base_url: "http://saved-gpu:8188",
      bridge_base_url: null }, "operator")).ok).toBe(true);
    for (const [id, expected] of [["e_saved_backend", "http://saved-gpu:8188"],
      ["e_inherited_backend", null]] as const) {
      const episode = fixtureEpisode(id);
      episode.status = "keyframing";
      episode.shots = [{ ...shotFixture(), landmark: "" }];
      await insertEpisode(episode);
      await enqueueTask({ episode_id: id, stage: "keyframe", shot_no: 1 });
      const task = await dequeueTask();
      expect(task).not.toBeNull();
      await handleTask(task!);
      const completed = await getEpisode(id);
      expect(completed.ok && completed.episode.status).toBe("kf_review");
      expect(completed.ok && completed.episode.shots[0]?.candidates).toHaveLength(2);
      const emitted = requests.slice(-2);
      expect(emitted).toHaveLength(2);
      expect(emitted.map(item => item.body.comfyui_base_url)).toEqual([expected, expected]);
      expect(emitted.map(item => item.address)).toEqual([
        "http://task-inference:8100/image/", "http://task-inference:8100/image/",
      ]);
      if (expected !== null) {
        expect((await saveSystemConfig(2, { comfyui_base_url: null,
          bridge_base_url: null }, "operator")).ok).toBe(true);
      }
    }
    expect(requests).toHaveLength(4);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalProjects === undefined) delete process.env.KELVOY_PROJECTS_ROOT;
    else process.env.KELVOY_PROJECTS_ROOT = originalProjects;
    if (originalInference === undefined) delete process.env.INFERENCE_BASE_URL;
    else process.env.INFERENCE_BASE_URL = originalInference;
    await rm(root, { recursive: true, force: true });
  }
});
