import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from "node:fs/promises";
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
  expect(await Bun.file(join(root, "inference", "image", "result.png")).exists()).toBe(false);
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
    await writeFile(join(root, "inference", "image", "result.png"), "generated image");
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

test("reclaimed executions cannot overwrite each other's generated files", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-executions-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  await mkdir(join(root, "inference", "image"), { recursive: true });
  const source = join(root, "inference", "image", "result.png");
  await writeFile(source, "old execution");
  const provider = createLocalGenerationProviders(async () => ({ ok: true,
    response: { paths: ["inference/image/result.png"], model: "Qwen", version: "1",
      seed: 42, seconds: 1 } })).keyframe;
  const input = { episode_id: "e1", shot_no: 1, candidate_no: 0, prompt: "scene",
    refs: [], seed: 42, generation_id: "generation-1" };
  const old = await provider.generate({ ...input, execution_id: "lease_old" });
  await writeFile(source, "new execution");
  const current = await provider.generate({ ...input, execution_id: "lease_new" });
  expect(current.key).toBe(old.key);
  expect(await readFile(join(root, "e1", old.key), "utf8")).toBe("old execution");
  expect(await Bun.file(source).exists()).toBe(true);
});

test("new lease reuses only matching intact candidates and regenerates changed references", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-reclaim-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  await mkdir(join(root, "persona"));
  await mkdir(join(root, "inference", "image"), { recursive: true });
  const reference = join(root, "persona", "front.png");
  const source = join(root, "inference", "image", "result.png");
  await writeFile(reference, "version 1");
  let calls = 0;
  const provider = createLocalGenerationProviders(async () => {
    calls++;
    await writeFile(source, `image ${calls}`);
    return { ok: true, response: { paths: ["inference/image/result.png"],
      model: "Qwen", version: "1", seed: 42, seconds: 1 } };
  }).keyframe;
  const input = { episode_id: "e1", shot_no: 1, candidate_no: 0, prompt: "scene",
    refs: ["persona/front.png"], seed: 42, generation_id: "generation-1" };
  const first = await provider.generate({ ...input, execution_id: "old" });
  expect((await provider.generate({ ...input, execution_id: "new" })).key).toBe(first.key);
  expect(calls).toBe(1);
  await writeFile(reference, "version 2");
  const changed = await provider.generate({ ...input, execution_id: "new" });
  expect(changed.key).not.toBe(first.key);
  expect(calls).toBe(2);
  await writeFile(join(root, "e1", changed.key), "tampered");
  const recovered = await provider.generate({ ...input, execution_id: "new" });
  expect(recovered.key).not.toBe(changed.key);
  expect(await readFile(join(root, "e1", changed.key), "utf8")).toBe("tampered");
  expect(calls).toBe(3);
});

test("new lease reuses matching direct video without another model call", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-video-reclaim-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  await mkdir(join(root, "persona"));
  await mkdir(join(root, "dest"));
  await mkdir(join(root, "inference", "video"), { recursive: true });
  await writeFile(join(root, "persona", "front.png"), "person");
  await writeFile(join(root, "dest", "scene.jpg"), "scene");
  const source = join(root, "inference", "video", "result.mp4");
  let calls = 0;
  const provider = createLocalGenerationProviders(async () => {
    calls++;
    await writeFile(source, "video");
    return { ok: true, response: { paths: ["inference/video/result.mp4"],
      model: "MiniMax", version: "1", seed: 7, seconds: 20 } };
  }).video;
  const input = { episode_id: "e1", shot_no: 1, refs: ["persona/front.png", "dest/scene.jpg"],
    prompt: "walking", duration_s: 3, seed: 7, generation_id: "generation-1" };
  const first = await provider.generate({ ...input, execution_id: "old" });
  expect((await provider.generate({ ...input, execution_id: "new" })).key).toBe(first.key);
  expect(calls).toBe(1);
});

test("an orphaned media file from a failed metadata publish does not block a same-lease retry", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-orphan-retry-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  await mkdir(join(root, "e1", "kf"), { recursive: true });
  await mkdir(join(root, "inference", "image"), { recursive: true });
  const orphan = join(root, "e1", "kf", "01_generation-1_lease-1_0.png");
  await writeFile(orphan, "orphan from interrupted publish");
  const source = join(root, "inference", "image", "result.png");
  let calls = 0;
  const provider = createLocalGenerationProviders(async () => {
    calls++;
    await writeFile(source, "fresh generation");
    return { ok: true, response: { paths: ["inference/image/result.png"],
      model: "Qwen", version: "1", seed: 42, seconds: 1 } };
  }).keyframe;
  const input = { episode_id: "e1", shot_no: 1, candidate_no: 0, prompt: "scene",
    refs: [], seed: 42, generation_id: "generation-1", execution_id: "lease-1" };
  const result = await provider.generate(input);
  expect(result.key).not.toBe("kf/01_generation-1_lease-1_0.png");
  expect(await readFile(orphan, "utf8")).toBe("orphan from interrupted publish");
  expect(await readFile(join(root, "e1", result.key), "utf8")).toBe("fresh generation");
  expect((await provider.generate(input)).key).toBe(result.key);
  expect(calls).toBe(1);
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

test("inference media symlink cannot turn source cleanup into deletion of a reference", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-media-link-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  await mkdir(join(root, "persona"), { recursive: true });
  await mkdir(join(root, "inference", "image"), { recursive: true });
  const reference = join(root, "persona", "front.png");
  await writeFile(reference, "keep me");
  await symlink(reference, join(root, "inference", "image", "linked.png"));
  const provider = createLocalGenerationProviders(async () => ({ ok: true,
    response: { paths: ["inference/image/linked.png"], model: "Qwen", version: "1",
      seed: 42, seconds: 1 } })).keyframe;
  await expect(provider.generate({ episode_id: "e1", shot_no: 1, candidate_no: 0,
    prompt: "scene", refs: [], seed: 42, generation_id: "task-link" })).rejects.toThrow();
  expect(await readFile(reference, "utf8")).toBe("keep me");
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

test("direct video sends person and scene references without a keyframe", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-direct-video-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  await mkdir(join(root, "persona"));
  await mkdir(join(root, "dest"));
  await mkdir(join(root, "inference", "video"), { recursive: true });
  await writeFile(join(root, "persona", "front.png"), "person");
  await writeFile(join(root, "dest", "scene.jpg"), "scene");
  await writeFile(join(root, "inference", "video", "result.mp4"), "video");
  let request: unknown;
  const provider = createLocalGenerationProviders(async (route, body) => {
    request = { route, body };
    return { ok: true, response: { paths: ["inference/video/result.mp4"], model: "MiniMax-H3",
      version: "dual", seed: 7, seconds: 30 } };
  }).video;
  const result = await provider.generate({ episode_id: "e1", shot_no: 1,
    refs: ["persona/front.png", "dest/scene.jpg"], prompt: "人物在场景中行走",
    duration_s: 3, aspect: "16:9", seed: 7, generation_id: "direct-1" });
  expect(request).toEqual({ route: "/video/", body: {
    prompt: "人物在场景中行走", refs: ["persona/front.png", "dest/scene.jpg"],
    seed: 7, size: "16:9", count: 1, params: { duration_s: 3 },
  } });
  expect(result.ref_hashes).toHaveLength(2);
  expect(await readFile(join(root, "e1", result.key), "utf8")).toBe("video");
});

test("task backend snapshot propagates override and prevents reuse across backend revisions", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-backend-cache-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  await mkdir(join(root, "inference", "image"), { recursive: true });
  const requests: { body: unknown; options: unknown }[] = [];
  const call = async (_route: string, body: unknown, options: unknown): Promise<CallInferenceResult> => {
    requests.push({ body, options });
    await writeFile(join(root, "inference", "image", "result.png"), `image ${requests.length}`);
    return { ok: true, response: { paths: ["inference/image/result.png"], model: "Qwen",
      version: "1", seed: 42, seconds: 1 } };
  };
  const snapshot = { comfyui_base_url: "http://gpu-a:8188", config_version: 2,
    inference_base_url: "http://inference-a:8100", inherited_comfyui_base_url: null };
  const input = { episode_id: "e1", shot_no: 1, candidate_no: 0, prompt: "scene",
    refs: [], seed: 42, generation_id: "generation-1" };
  const provider = createLocalGenerationProviders(call, snapshot).keyframe;
  snapshot.comfyui_base_url = "http://changed-after-task-start:8188";
  const first = await provider.generate({ ...input, execution_id: "old" });
  expect(requests[0]?.body).toMatchObject({ comfyui_base_url: "http://gpu-a:8188" });
  expect(requests[0]?.options).toMatchObject({ baseUrl: "http://inference-a:8100" });
  expect((await provider.generate({ ...input, execution_id: "retry" })).key).toBe(first.key);
  const changed = createLocalGenerationProviders(call, { ...snapshot,
    comfyui_base_url: null, config_version: 3 }).keyframe;
  const second = await changed.generate({ ...input, execution_id: "new" });
  expect(second.key).not.toBe(first.key);
  expect(requests[1]?.body).toMatchObject({ comfyui_base_url: null });
  expect(requests).toHaveLength(2);
  await createLocalGenerationProviders(call, { ...snapshot, comfyui_base_url: null,
    config_version: 3, inference_base_url: "http://inference-b:8100" }).keyframe.generate({ ...input, execution_id: "another" });
  expect(requests).toHaveLength(3);
});


test("video rejects reference changes since the prompt rewrite before inference", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-h3-reference-change-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  await mkdir(join(root, "e1/kf"), { recursive: true });
  await writeFile(join(root, "e1/kf/a.png"), "changed frame");
  let calls = 0;
  const video = createLocalGenerationProviders(async () => { calls++; throw new Error("must not run"); }).video;
  await expect(video.generate({ episode_id: "e1", shot_no: 1, generation_id: "g", keyframe: "kf/a.png",
    expected_ref_hashes: ["a".repeat(64)], prompt: "official H3", duration_s: 4, seed: 1 })).rejects.toThrow("references changed");
  expect(calls).toBe(0);
});

test("image rejects changed rewrite references before inference", async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-image-hash-")); process.env.KELVOY_PROJECTS_ROOT = root;
  await mkdir(join(root, "persona")); await writeFile(join(root, "persona/front.png"), "changed reference");
  let calls = 0;
  const provider = createLocalGenerationProviders(async () => { calls++; throw new Error("must not submit"); });
  await expect(provider.keyframe.generate({ episode_id: "e1", shot_no: 1, candidate_no: 0, prompt: "Only hands from <image1>.", refs: ["persona/front.png"], expected_ref_hashes: ["a".repeat(64)], seed: 42, generation_id: "g1" })).rejects.toThrow("references changed");
  expect(calls).toBe(0);
});
