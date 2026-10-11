import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Destination, Episode, Persona, Shot } from "@kelvoy/engine";
import {
  close, deleteEpisode, dequeueTask, enqueueTask, getDb, getEpisode, insertEpisode, insertPersona,
  listPromptTraces, open, submitScriptAction, grantCredits, upsertDestination,
} from "@kelvoy/store";
import { deletionEpisodeFixture } from "./deletion-test-fixture";
import { handleTask } from "./consumer";

/**
 * ADR-0012 worker integration: real :memory: store, stubbed fetch. SENTINEL is planted in user input,
 * so it appears in every prompt; it must reach prompt_traces and nothing else (tasks, episode, logs).
 */
const OWNER = "u_owner";
const SENTINEL = "SENTINEL-prompt-9f3a";

let root: string;
let oldRoot: string | undefined;
let oldKey: string | undefined;
const realFetch = globalThis.fetch;
const logs: string[] = [];
const realConsole = { info: console.info, log: console.log, warn: console.warn, error: console.error };

beforeEach(async () => {
  open(":memory:");
  oldRoot = process.env.KELVOY_PROJECTS_ROOT;
  oldKey = process.env.STEPFUN_API_KEY;
  root = await mkdtemp(join(tmpdir(), "prompt-traces-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  process.env.STEPFUN_API_KEY = "test-key";
  await upsertDestination(destination);
  await insertPersona(persona);
  await mkdir(join(root, "p"), { recursive: true });
  await mkdir(join(root, "d"), { recursive: true });
  await writeFile(join(root, "p/front.png"), "person");
  await writeFile(join(root, "d/a.jpg"), "scene");
  logs.length = 0;
  for (const name of ["info", "log", "warn", "error"] as const) {
    console[name] = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  }
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
  if (oldRoot === undefined) delete process.env.KELVOY_PROJECTS_ROOT; else process.env.KELVOY_PROJECTS_ROOT = oldRoot;
  if (oldKey === undefined) delete process.env.STEPFUN_API_KEY; else process.env.STEPFUN_API_KEY = oldKey;
  close();
  await rm(root, { recursive: true, force: true });
});

const destination: Destination = { destination_id: "d_test", version: 1, name: "测试景区", city: "测试市",
  type: "scenic_area", season_best: [], landmarks: [{ id: "lm_1", name: "地标一", refs: ["d/a.jpg"], best_time: "上午" }],
  route: [], food: [], transport: "", stay: "" };
const persona: Persona = { persona_id: "c_test", owner_id: OWNER, version: 1, name: "角色", desc: "", locked: [],
  default_outfit: "", refs: ["p/front.png"], style: { lut: "lut/warm_film.cube", title_style: "serif-center" } };

function scriptEpisode(id: string): Episode {
  const episode = deletionEpisodeFixture(id, OWNER);
  return { ...episode, status: "scripting", brief: { ...episode.brief, requirements: SENTINEL } };
}
function validRawShots() {
  const sizes = ["wide", "medium", "close", "detail", "pov"];
  return Array.from({ length: 8 }, (_, i) => ({ scene: "段落", time: "morning", size: sizes[i % 5], beat: `动作 ${i + 1}`,
    camera: "static", landmark: i === 0 ? "lm_1" : null, kf_prompt: `画面 ${i + 1}`, motion_prompt: `运动 ${i + 1}` }));
}
function stubScriptFetch(onCall?: (call: number) => Promise<Response | void> | Response | void) {
  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    return (await onCall?.(call)) ?? Response.json({ choices: [{ message: { content: JSON.stringify(validRawShots()) } }] });
  }) as unknown as typeof fetch;
}
async function traces(episodeId: string, kind: "script" | "video" = "script") {
  return (await listPromptTraces({ episodeId, ownerId: OWNER, kind, limit: 50 })).items.reverse();
}
function taskRow(taskId: string) {
  return JSON.stringify(getDb().query("select * from tasks where task_id = ?").get(taskId));
}
// The episode document legitimately holds the user input itself, so only tasks and logs are checked.
function assertNoSentinelOutsideTraces(taskIds: string[]) {
  for (const id of taskIds) expect(taskRow(id)).not.toContain(SENTINEL);
  expect(logs.join("\n")).not.toContain(SENTINEL);
}

async function setupScript(id: string) {
  await insertEpisode(scriptEpisode(id));
  await enqueueTask({ episode_id: id, stage: "script" });
  return (await dequeueTask())!;
}

test("a script task records every correction round and commits them with the result", async () => {
  const task = await setupScript("e_script_ok");
  const prompts: string[] = [];
  stubScriptFetch(async (call) => {
    if (call === 1) return Response.json({ choices: [{ message: { content: JSON.stringify(validRawShots().map((s) => ({ ...s, landmark: "unknown" }))) } }] });
  });
  const realStub = globalThis.fetch;
  globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    prompts.push(JSON.parse(init!.body as string).messages[0].content);
    return realStub(url, init);
  }) as unknown as typeof fetch;

  await handleTask(task);

  const rows = await traces("e_script_ok");
  expect(rows.map((r) => [r.kind, r.round, r.outcome, r.source, r.task_id, r.attempt]))
    .toEqual([["script_generate", 1, "rule_violation", "llm", task.task_id, 1], ["script_generate", 2, "accepted", "llm", task.task_id, 1]]);
  expect(rows.map((r) => r.user_message)).toEqual(prompts);
  expect(rows[0]!.user_message).toContain(SENTINEL);
  expect(rows[1]!.user_message).toContain("上一轮生成有以下问题");
  assertNoSentinelOutsideTraces([task.task_id]);
});

test("failed script tasks keep their rounds; content_blocked and call failures leak nothing else", async () => {
  const blockedTask = await setupScript("e_script_blocked");
  stubScriptFetch(() => Response.json({ choices: [{ message: { content: JSON.stringify(validRawShots().map((s, i) => (i === 0 ? { ...s, kf_prompt: "色情场景" } : s))) } }] }));
  await handleTask(blockedTask);
  const blocked = await traces("e_script_blocked");
  expect(blocked.map((r) => r.outcome)).toEqual(["content_blocked", "content_blocked", "content_blocked"]);
  assertNoSentinelOutsideTraces([blockedTask.task_id]);

  const failedTask = await setupScript("e_script_http");
  stubScriptFetch(() => new Response(`upstream echoed ${SENTINEL}`, { status: 500 }));
  await handleTask(failedTask);
  const retry = (await dequeueTask())!;
  expect(retry.attempt).toBe(2);
  await handleTask(retry);
  const failed = await traces("e_script_http");
  expect(failed.map((r) => [r.attempt, r.outcome])).toEqual([[1, "call_failed"], [2, "call_failed"]]);
  assertNoSentinelOutsideTraces([failedTask.task_id]);
});

test("script optimization records revision rounds and its failure rounds", async () => {
  const episode = { ...scriptEpisode("e_revision"), status: "script_review" as const,
    shots: [{ no: 1, scene: "s1", size: "medium", beat: "经过", camera: "push", landmark: null, kf_prompt: "a", motion_prompt: "b",
      duration_s: 1.5, candidates: [], kf_selected: null, clip: null, trim_start_s: null, status: "draft",
      regen_stage: null, bad_shot_reported: false, model: {} } as Shot] };
  await insertEpisode(episode);
  getDb().query("insert into users (user_id, username, password_hash) values (?, 'tester', 'hash')").run(OWNER);
  grantCredits(OWNER, 3, "grant-revision");
  expect(submitScriptAction({ episode_id: episode.episode_id, owner_id: OWNER, row_version: 1,
    operation: "script_optimize", instruction: `突出夜景 ${SENTINEL}` }).ok).toBe(true);
  const task = (await dequeueTask())!;
  stubScriptFetch();
  await handleTask(task);
  const rows = await traces("e_revision");
  expect(rows.map((r) => [r.kind, r.outcome])).toEqual([["script_revision", "accepted"]]);
  expect(rows[0]!.user_message).toContain(`突出夜景 ${SENTINEL}`);

  const failing = { ...scriptEpisode("e_revision_fail"), status: "script_review" as const, shots: episode.shots };
  await insertEpisode(failing);
  expect(submitScriptAction({ episode_id: failing.episode_id, owner_id: OWNER, row_version: 1,
    operation: "script_optimize", instruction: "x" }).ok).toBe(true);
  const failTask = (await dequeueTask())!;
  stubScriptFetch(() => new Response("nope", { status: 500 }));
  await handleTask(failTask);
  expect((await traces("e_revision_fail")).map((r) => [r.kind, r.outcome])).toEqual([["script_revision", "call_failed"]]);
});

test("lease loss, user cancellation and a deleted work commit no traces and raise no error", async () => {
  const lost = await setupScript("e_lease");
  stubScriptFetch(() => { getDb().query("update tasks set lease_token = 'new-owner' where task_id = ?").run(lost.task_id); });
  await handleTask(lost);
  expect(await traces("e_lease")).toEqual([]);

  const cancelled = await setupScript("e_cancel");
  const controller = new AbortController();
  stubScriptFetch(() => { controller.abort(); });
  await handleTask(cancelled, { signal: controller.signal });
  expect(await traces("e_cancel")).toEqual([]);

  const deleted = await setupScript("e_deleted");
  stubScriptFetch(async () => { await deleteEpisode("e_deleted", OWNER); });
  await handleTask(deleted);
  expect(await traces("e_deleted")).toEqual([]);
  expect(getDb().query("select count(*) as n from prompt_traces where episode_id = 'e_deleted'").get()).toEqual({ n: 0 });
});

// --- video -----------------------------------------------------------------------------------

function videoShot(): Shot {
  return { no: 1, scene: "s1", size: "detail", beat: `展示黄山烧饼 ${SENTINEL}`, camera: "static", landmark: "lm_1",
    kf_prompt: "仅手部与黄山烧饼细节", motion_prompt: "手腕轻微旋转，固定镜头", duration_s: 4, candidates: [],
    kf_selected: null, clip: null, trim_start_s: null, status: "draft", regen_stage: null,
    bad_shot_reported: false, model: {} };
}
function refSections(durationS: number) {
  return {
    subject_definitions: "<Subject 1> is the person from <Picture 1>. <Subject 2> is the scene from <Picture 2>.",
    summary: "[reference generation] A detail of <Subject 1>'s hands with pastry in <Subject 2>.",
    retention_analysis: "<Subject 1> (appears in [Shot 1]): partially_preserved - hands only.\n<Subject 2> (appears in [Shot 1]): weak_reference - scene only.",
    detailed_description: `[Shot 1] A detail shot shows only hands and pastry. A slight wrist rotation continues with a static camera through 00:0${durationS}.000, in one continuous shot. <Subject 1> is framed against <Subject 2>.`,
    overall_soundscape: "Quiet ambient sound.", non_diegetic_music: "N/A",
  };
}
function stubH3Fetch(mode: "ok" | "bad") {
  let calls = 0;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls += 1;
    const messages = JSON.parse(init!.body as string).messages as { role: string; content: string }[];
    const context = JSON.parse(messages[1]!.content) as { duration_s: number };
    const body = mode === "ok" ? refSections(context.duration_s) : { summary: "only one field" };
    return Response.json({ choices: [{ message: { content: JSON.stringify(body) } }] });
  }) as unknown as typeof fetch;
  return { calls: () => calls };
}
async function setupVideo(id: string) {
  const episode = { ...deletionEpisodeFixture(id, OWNER), video_source: "references" as const,
    status: "clipping" as const, shots: [videoShot()] };
  await insertEpisode(episode);
  await enqueueTask({ episode_id: id, stage: "video", shot_no: 1 });
  return { shotId: `sh_${id}_active_0_1`, task: (await dequeueTask())! };
}
const clip = { async generate(input: { seed: number }) {
  return { key: "clip/01.mp4", model: "MiniMax-H3", version: "v1", seed: input.seed, seconds: 1, ref_hashes: ["a", "b"] };
} };

test("a video retry records the llm rewrite, then its cache hit as a new version", async () => {
  const { shotId, task } = await setupVideo("e_video");
  const fetched = stubH3Fetch("ok");
  await handleTask(task, { video: { async generate() { throw new Error("backend exploded"); } } });
  const retry = (await dequeueTask())!;
  expect(retry.attempt).toBe(2);
  await handleTask(retry, { video: clip });

  const rows = await traces("e_video", "video");
  expect(rows.map((r) => [r.attempt, r.seq, r.source, r.outcome, r.shot_id, r.kind]))
    .toEqual([[1, 0, "llm", "ok", shotId, "h3_rewrite"], [2, 0, "cache", "ok", shotId, "h3_rewrite"]]);
  expect(fetched.calls()).toBe(1);
  expect(rows[0]!.user_message).toContain(SENTINEL);
  expect(rows[0]!.final_prompt).toContain("detailed_description:");
  expect(rows[0]!.final_prompt).toBe(rows[1]!.final_prompt!);
  expect(rows[0]!.h3_mode).toBe("Ref2VA");
  expect(rows[0]!.input_hash).toHaveLength(64);
  const filtered = await listPromptTraces({ episodeId: "e_video", ownerId: OWNER, kind: "video", shotId, limit: 10 });
  expect(filtered.items).toHaveLength(2);
  const finished = await getEpisode("e_video");
  expect(finished.ok && finished.episode.status).toBe("clip_review");
});

test("a failed rewrite keeps the attempt with its rule and no final prompt, without leaking elsewhere", async () => {
  const { shotId, task } = await setupVideo("e_video_bad");
  stubH3Fetch("bad");
  const status = () => (getDb().query("select status, attempt from tasks where task_id = ?").get(task.task_id)) as
    { status: string; attempt: number };
  // Attempt 1: format failure is requeued (model output is random), the attempt's trace is still kept.
  await handleTask(task, { video: clip });
  expect(status()).toMatchObject({ status: "pending", attempt: 2 });
  const first = await traces("e_video_bad", "video");
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({ shot_id: shotId, outcome: "prompt_format_invalid", rule: "section_fields", final_prompt: null });
  expect(first[0]!.correction_message).not.toBeNull();

  // Attempt 2: still invalid -> terminal, no further requeue.
  const second = (await dequeueTask())!;
  expect(second.task_id).toBe(task.task_id);
  expect(second.attempt).toBe(2);
  await handleTask(second, { video: clip });
  expect(status().status).toBe("failed");
  const rows = await traces("e_video_bad", "video");
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.outcome === "prompt_format_invalid")).toBe(true);
  assertNoSentinelOutsideTraces([task.task_id]);
});
