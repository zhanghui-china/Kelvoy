import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Persona } from "@kelvoy/engine";
import {
  cancelViewsJob, claimViewsJob, close, createViewsJob, getCreditBalance, getDb, getPersona, getViewsJob,
  grantCredits, insertPersona, open, updatePersona, createUser,
} from "@kelvoy/store";
import type { CallInferenceResult } from "../inference-client";
import type { GenerationBackend } from "../generation/local";
import { viewPrompt, viewsSeed } from "./generate";
import { runNextViewsJob, type ViewsRunnerDeps } from "./runner";

let root = "";
let owner = "";
let counter = 0;
const backend: GenerationBackend = { comfyui_base_url: null, config_version: 1,
  inference_base_url: "http://inference.test", inherited_comfyui_base_url: null };
const persona = (): Persona => ({
  persona_id: "c_1", owner_id: owner, version: 1, name: "小岛", desc: "", locked: [], default_outfit: "衬衫",
  refs: ["persona/c_1/base.png"], style: { lut: "x", title_style: "y" },
});

type Call = Parameters<NonNullable<ViewsRunnerDeps["call"]>>;
const calls: Call[] = [];

/** Writes a staged inference output the way services/inference does and answers like a successful /image/. */
async function okResponse(seed: number): Promise<CallInferenceResult> {
  const name = `inference/image/${++counter}.png`;
  await mkdir(join(root, "inference/image"), { recursive: true });
  await writeFile(join(root, name), `png-${counter}`);
  return { ok: true, response: { paths: [name], model: "qwen-image", version: "2.1", seed, seconds: 1 } };
}
const call = (behaviour?: (n: number, args: Call) => Promise<CallInferenceResult>): NonNullable<ViewsRunnerDeps["call"]> =>
  async (...args) => {
    calls.push(args);
    return behaviour ? behaviour(calls.length, args) : okResponse(args[1].seed!);
  };
const compose: NonNullable<ViewsRunnerDeps["compose"]> = async (views, output) => {
  expect(views).toHaveLength(3);
  await writeFile(output, "jpeg-sheet");
};
const deps = (extra: ViewsRunnerDeps = {}): ViewsRunnerDeps => ({ backend, compose, call: call(), ...extra });
const create = async () => {
  const r = await createViewsJob({ persona_id: "c_1", owner_id: owner, outfit_id: null });
  if (!r.ok) throw new Error(r.error);
  return r.job;
};
const failing = (): CallInferenceResult => ({ ok: false, error: { type: "network", message: "connect ECONNREFUSED sk-secret-token /data/secret/path" } });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-views-test-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  open(":memory:");
  const user = await createUser({ username: "a", password_hash: "h" });
  if (!user.ok) throw new Error("fixture");
  owner = user.user.user_id;
  grantCredits(owner, 20, "g1");
  await insertPersona(persona());
  calls.length = 0;
});
afterEach(async () => {
  close();
  delete process.env.KELVOY_PROJECTS_ROOT;
  await rm(root, { recursive: true, force: true });
});

test("idle queue: nothing to run", async () => {
  expect(await runNextViewsJob(undefined, deps())).toBe(false);
});

test("success: V1 prompts, one fixed seed, four append-only keys, persona ready, credits settled", async () => {
  const job = await create();
  expect(await runNextViewsJob(undefined, deps())).toBe(true);

  expect(calls.map(([route]) => route)).toEqual(["/image/", "/image/", "/image/"]);
  expect(calls.map(([, body]) => body.prompt)).toEqual([viewPrompt("front"), viewPrompt("side"), viewPrompt("back")]);
  expect(calls[0]![1].prompt).toBe("把人物改为全身角色设定图：面向镜头正面站立，纯白背景，人物居中，全身入镜，双臂自然下垂，保持人物的脸型、发型、服装、鞋子和背包的款式与颜色完全不变");
  const seed = viewsSeed(job.generation_id);
  for (const [, body] of calls) expect(body).toMatchObject({ refs: ["persona/c_1/base.png"], seed, size: "9:16", count: 1 });

  const done = (await getViewsJob(job.job_id, owner))!;
  expect(done.status).toBe("succeeded");
  const stored = (await getPersona("c_1"))!;
  expect(stored.views_status).toBe("ready");
  expect(stored.views_gen).toEqual({ provider: "local", model: "qwen-image", version: "2.1", seed });
  const keys = Object.values(stored.views!);
  expect(keys).toHaveLength(4);
  for (const key of keys) {
    expect(key.startsWith(`persona/c_1/views_${job.generation_id}_`)).toBe(true);
    expect(existsSync(join(root, key))).toBe(true);
  }
  expect(stored.views!.sheet.endsWith("sheet.jpg")).toBe(true);
  expect(getCreditBalance(owner)).toEqual({ available: 17, reserved: 0 });
  // Staged inference outputs are discarded after publishing.
  expect(await readdir(join(root, "inference/image"))).toEqual([]);
});

test("regenerate publishes new keys and leaves the old files in place", async () => {
  await create();
  await runNextViewsJob(undefined, deps());
  const first = (await getPersona("c_1"))!.views!;
  const again = await createViewsJob({ persona_id: "c_1", owner_id: owner, outfit_id: null, regenerate: true });
  expect(again.ok).toBe(true);
  await runNextViewsJob(undefined, deps());
  const second = (await getPersona("c_1"))!.views!;
  expect(second.sheet).not.toBe(first.sheet);
  for (const key of [...Object.values(first), ...Object.values(second)]) expect(existsSync(join(root, key))).toBe(true);
});

test("one failure requeues, the retry succeeds and the credits settle once", async () => {
  const job = await create();
  const flaky = deps({ call: call(async (n, args) => n === 1 ? failing() : okResponse(args[1].seed!)) });
  expect(await runNextViewsJob(undefined, flaky)).toBe(true);
  const requeued = (await getViewsJob(job.job_id, owner))!;
  expect(requeued).toMatchObject({ status: "pending", attempt: 2 });
  expect(getCreditBalance(owner)).toEqual({ available: 17, reserved: 3 });

  expect(await runNextViewsJob(undefined, flaky)).toBe(true);
  expect((await getViewsJob(job.job_id, owner))!.status).toBe("succeeded");
  expect((await getPersona("c_1"))!.views_status).toBe("ready");
  expect(getCreditBalance(owner)).toEqual({ available: 17, reserved: 0 });
});

test("two failures end in failed, release credits and never leak backend details", async () => {
  const job = await create();
  const broken = deps({ call: call(async () => failing()) });
  await runNextViewsJob(undefined, broken);
  await runNextViewsJob(undefined, broken);
  expect(await runNextViewsJob(undefined, broken)).toBe(false); // no third attempt
  const failed = (await getViewsJob(job.job_id, owner))!;
  expect(failed.status).toBe("failed");
  expect(failed.error).not.toMatch(/sk-secret|ECONNREFUSED|\/data\//);
  expect(failed.error).toBeTruthy();
  expect((await getPersona("c_1"))!.views_status).toBe("failed");
  expect(getCreditBalance(owner)).toEqual({ available: 20, reserved: 0 });
  expect(calls).toHaveLength(2); // each attempt stops at the first failed view
});

test("a failure after publishing (sheet stitch) removes the partial files", async () => {
  const job = await create();
  await runNextViewsJob(undefined, deps({ compose: async () => { throw new Error("ffmpeg exit 1 /secret"); } }));
  expect((await getViewsJob(job.job_id, owner))!.status).toBe("pending");
  expect(existsSync(join(root, "persona"))).toBe(false);
  expect(await readdir(join(root, "inference/image"))).toEqual([]);
});

test("user cancel during generation: heartbeat aborts the call, nothing is published or reported", async () => {
  const job = await create();
  let aborted = false;
  const hanging = deps({ heartbeatMs: 20, call: call((_, [, , options]) => new Promise((resolve) => {
    void cancelViewsJob(job.job_id, owner);
    options!.signal!.addEventListener("abort", () => { aborted = true; resolve({ ok: false, error: { type: "cancelled" } }); });
  })) });
  await runNextViewsJob(undefined, hanging);
  expect(aborted).toBe(true);
  expect((await getViewsJob(job.job_id, owner))!.status).toBe("cancelled");
  expect(existsSync(join(root, "persona"))).toBe(false);
  expect(getCreditBalance(owner)).toEqual({ available: 20, reserved: 0 });
});

test("lease lost before commit: result is dropped and files are removed", async () => {
  const job = await create();
  const expiring = deps({ heartbeatMs: 60_000, compose: async (_v, output) => {
    await writeFile(output, "jpeg");
    getDb().query("update persona_asset_jobs set lease_until = 1 where job_id = ?").run(job.job_id);
  } });
  await runNextViewsJob(undefined, expiring);
  expect(await readdir(join(root, "persona", "c_1"))).toEqual([]);
  expect((await getViewsJob(job.job_id, owner))!.status).toBe("processing");
  expect((await getPersona("c_1"))!.views_status).toBe("pending");
});

test("source changed during generation: the store abandons the job and the files are removed", async () => {
  const job = await create();
  const edited = deps({ compose: async (_v, output) => {
    await writeFile(output, "jpeg");
    await updatePersona("c_1", { refs: ["persona/c_1/new.png"] });
  } });
  await runNextViewsJob(undefined, edited);
  expect(await getViewsJob(job.job_id, owner)).toMatchObject({ status: "cancelled", error: "source changed" });
  expect(await readdir(join(root, "persona", "c_1"))).toEqual([]);
  expect(getCreditBalance(owner)).toEqual({ available: 20, reserved: 0 });
});

test("timeout: aborts the call and reports a failure for the store to requeue", async () => {
  const job = await create();
  const slow = deps({ timeoutMs: 30, call: call((_, [, , options]) => new Promise((resolve) => {
    options!.signal!.addEventListener("abort", () => resolve({ ok: false, error: { type: "cancelled" } }));
  })) });
  await runNextViewsJob(undefined, slow);
  expect(await getViewsJob(job.job_id, owner)).toMatchObject({ status: "pending", attempt: 2 });
});

test("shutdown mid-run reports nothing; the lease expires and the job is reclaimed", async () => {
  const job = await create();
  const shutdown = new AbortController();
  const stopping = deps({ call: call((_, [, , options]) => new Promise((resolve) => {
    options!.signal!.addEventListener("abort", () => resolve({ ok: false, error: { type: "cancelled" } }));
    shutdown.abort();
  })) });
  await runNextViewsJob(shutdown.signal, stopping);
  expect((await getViewsJob(job.job_id, owner))!.status).toBe("processing");
  getDb().query("update persona_asset_jobs set lease_until = 1").run();
  expect((await claimViewsJob())!.attempt).toBe(2);
});

test("rejects a source key outside the persona's own directory", async () => {
  const job = await create();
  getDb().query("update persona_asset_jobs set source_key = 'c_2/kf/secret.png' where job_id = ?").run(job.job_id);
  await runNextViewsJob(undefined, deps());
  expect(calls).toHaveLength(0);
  expect((await getViewsJob(job.job_id, owner))!.status).toBe("pending");
});
