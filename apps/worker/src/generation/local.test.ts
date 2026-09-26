import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallInferenceResult } from "../inference-client";
import { createLocalGenerationProviders } from "./local";

let root: string;
afterEach(async () => {
  delete process.env.KELVOY_PROJECTS_ROOT;
  if (root) await rm(root, { recursive: true, force: true });
});

test("image adapter sends ordered references, hashes them and archives the returned image", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-generate-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  await mkdir(join(root, "persona"));
  await mkdir(join(root, "dest"));
  await writeFile(join(root, "persona", "front.png"), "persona bytes");
  await writeFile(join(root, "dest", "a.jpg"), "landmark bytes");
  await mkdir(join(root, "inference", "image"), { recursive: true });
  await writeFile(join(root, "inference", "image", "result.png"), "generated image");
  const calls: unknown[] = [];
  const call = async (route: string, body: unknown): Promise<CallInferenceResult> => {
    calls.push({ route, body });
    return { ok: true, response: { paths: ["inference/image/result.png"], model: "Qwen-Image-2.1", version: "abc", seed: 42, seconds: 40 } };
  };
  const providers = createLocalGenerationProviders(call);
  const result = await providers.keyframe.generate({
    episode_id: "e1", shot_no: 1, candidate_no: 0, prompt: "角色与真实地标",
    refs: ["persona/front.png", "dest/a.jpg"], seed: 42, generation_id: "task-1",
  });
  expect(calls).toEqual([{ route: "/image/", body: {
    prompt: "角色与真实地标", refs: ["persona/front.png", "dest/a.jpg"],
    seed: 42, size: "9:16", count: 1,
  } }]);
  expect(result.key).toBe("kf/01_task-1_0.png");
  expect(result.ref_hashes).toHaveLength(2);
  expect(await readFile(join(root, "e1", result.key), "utf8")).toBe("generated image");
});

test("image adapter sends a wide request when the episode is wide", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-generate-wide-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  await mkdir(join(root, "inference", "image"), { recursive: true });
  await writeFile(join(root, "inference", "image", "result.png"), "wide image");
  let size: string | undefined;
  const providers = createLocalGenerationProviders(async (_route, body) => {
    size = body.size;
    return { ok: true, response: { paths: ["inference/image/result.png"], model: "Qwen",
      version: "wide", seed: 42, seconds: 1 } };
  });
  await providers.keyframe.generate({ episode_id: "e1", shot_no: 1, candidate_no: 0,
    aspect: "16:9", prompt: "wide view", refs: [], seed: 42, generation_id: "task-wide" });
  expect(size).toBe("16:9");
});

test("retry reuses a completed candidate and only requests the missing one", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-generate-retry-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  await mkdir(join(root, "inference", "image"), { recursive: true });
  await writeFile(join(root, "inference", "image", "result.png"), "generated image");
  let calls = 0;
  const provider = createLocalGenerationProviders(async () => {
    calls++;
    if (calls === 2) throw new Error("temporary failure");
    return { ok: true, response: { paths: ["inference/image/result.png"],
      model: "Qwen", version: "v1", seed: 42, seconds: 1 } };
  }).keyframe;
  const first = { episode_id: "e1", shot_no: 1, candidate_no: 0, prompt: "街景",
    refs: [], seed: 42, generation_id: "task-retry" };
  await provider.generate(first);
  await expect(provider.generate({ ...first, candidate_no: 1 })).rejects.toThrow("temporary failure");
  await provider.generate(first);
  await provider.generate({ ...first, candidate_no: 1 });
  expect(calls).toBe(3);
});

test("video adapter rejects a keyframe path escaping the episode directory", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-generate-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  const providers = createLocalGenerationProviders(async () => { throw new Error("must not call model"); });
  await expect(providers.video.generate({
    episode_id: "e1", shot_no: 1, keyframe: "../other.png", prompt: "move",
    duration_s: 3, seed: 1, generation_id: "task-1",
  })).rejects.toThrow("path");
});

test("video adapter preserves an existing approved clip on a new task", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-generate-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  await mkdir(join(root, "e1", "kf"), { recursive: true });
  await mkdir(join(root, "e1", "clip"), { recursive: true });
  await mkdir(join(root, "inference", "video"), { recursive: true });
  await writeFile(join(root, "e1", "kf", "01_a.png"), "selected frame");
  await writeFile(join(root, "e1", "clip", "01_old-task.mp4"), "approved clip");
  await writeFile(join(root, "inference", "video", "result.mp4"), "new clip");
  const call = async (): Promise<CallInferenceResult> => ({
    ok: true, response: { paths: ["inference/video/result.mp4"], model: "MiniMax-H3", version: "def", seed: 7, seconds: 65 },
  });
  const providers = createLocalGenerationProviders(call);
  const result = await providers.video.generate({
    episode_id: "e1", shot_no: 1, keyframe: "kf/01_a.png", prompt: "move",
    duration_s: 3, seed: 7, generation_id: "new-task",
  });
  expect(result.key).toBe("clip/01_new-task.mp4");
  expect(await readFile(join(root, "e1", "clip", "01_old-task.mp4"), "utf8")).toBe("approved clip");
  expect(await readFile(join(root, "e1", result.key), "utf8")).toBe("new clip");
});
