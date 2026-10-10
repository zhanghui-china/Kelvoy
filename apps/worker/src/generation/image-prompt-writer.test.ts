import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImagePromptContext } from "@kelvoy/engine";
import { createImagePromptWriter } from "./image-prompt-writer";
let root: string;
let oldRoot: string | undefined;
beforeEach(async () => { oldRoot = process.env.KELVOY_PROJECTS_ROOT; root = await mkdtemp(join(tmpdir(), "qwen-writer-")); process.env.KELVOY_PROJECTS_ROOT = root; await mkdir(join(root, "persona")); await mkdir(join(root, "dest")); await writeFile(join(root, "persona/a.png"), "person"); await writeFile(join(root, "dest/a.png"), "scene"); });
afterEach(async () => { if (oldRoot === undefined) delete process.env.KELVOY_PROJECTS_ROOT; else process.env.KELVOY_PROJECTS_ROOT = oldRoot; await rm(root, { recursive: true, force: true }); });
const metadata = { official_commit: "a".repeat(40), system_prompt_hash: "b".repeat(64), model: "Qwen/Qwen-Image-2.1-PE-I2I", model_revision: "c".repeat(40), sampling: { temperature: 0.6, thinking: true }, writer_version: "official-v1" };
function context(): ImagePromptContext { return { mode: "edit", aspect: "9:16", kf_prompt: "仅手部与黄山烧饼", size: "detail", camera: "static", beat: "展示烧饼", scene: null, destination: "黄山", landmark: null, references: [{ key: "persona/a.png", role: "person", image: 1 }, { key: "dest/a.png", role: "scene", image: 2 }] }; }
function fetcher(callback?: (body: Record<string, unknown>) => void, patch = {}) { return async (url: string, init: RequestInit) => {
  if (url.endsWith("metadata/")) return Response.json(metadata);
  const body = JSON.parse(init.body as string); callback?.(body);
  return Response.json({ prompt: "Only hands holding shaobing from <image1> against the scene from <image2>. No face, eating or text.", wh_ratio: "9:16", ratio_follow: "", reference_hashes: body.expected_ref_hashes, metadata, ...patch });
}; }
test("Qwen reads ordered references and caches valid final prompt independently of candidates and leases", async () => {
  let calls = 0;
  const request = fetcher(body => { calls++; expect(body.refs).toEqual(["persona/a.png", "dest/a.png"]); expect(body.context).not.toHaveProperty("caption"); });
  const input = { episode_id: "e1", context: context() };
  const first = await createImagePromptWriter({ fetch: request }).write(input);
  expect(first.prompt).toContain("<image1>");
  expect(first.provenance.ref_hashes).toHaveLength(2);
  expect(await createImagePromptWriter({ fetch: request }).write(input)).toEqual(first);
  expect(calls).toBe(1);
  await writeFile(join(root, "dest/a.png"), "new scene");
  expect((await createImagePromptWriter({ fetch: request }).write(input)).provenance.input_hash).not.toBe(first.provenance.input_hash);
  input.context.kf_prompt += "特写"; await createImagePromptWriter({ fetch: request }).write(input);
  expect(calls).toBe(3);
});
test("blocked input/output and malformed ratio/reference markers fail closed", async () => {
  let calls = 0;
  await expect(createImagePromptWriter({ fetch: fetcher(() => calls++) }).write({ episode_id: "e1", context: { ...context(), kf_prompt: "色情场景" } })).rejects.toThrow("内容审核");
  expect(calls).toBe(0);
  for (const patch of [{ prompt: "色情场景" }, { prompt: "中文提示词" }, { wh_ratio: "16:9" }, { ratio_follow: "image1" }, { prompt: "Hands from <image3>" }]) {
    await expect(createImagePromptWriter({ fetch: fetcher(undefined, patch) }).write({ episode_id: "e1", context: context() })).rejects.toThrow();
  }
});
test("single reference supported and reordered references rejected", async () => {
  const source = context(); source.references.pop();
  const result = await createImagePromptWriter({ fetch: fetcher(undefined, { prompt: "Only hands holding pastry from <image1>." }) }).write({ episode_id: "e1", context: source });
  expect(result.provenance.ref_hashes).toHaveLength(1);
  source.references[0]!.image = 2;
  await expect(createImagePromptWriter({ fetch: fetcher() }).write({ episode_id: "e1", context: source })).rejects.toThrow("reference");
});
test("timeout includes metadata request and cancellation stops without a fallback", async () => {
  const request = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => { init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }); });
  await expect(createImagePromptWriter({ fetch: request, timeoutMs: 10 }).write({ episode_id: "e1", context: context() })).rejects.toThrow("timed out");
  const controller = new AbortController(); const work = createImagePromptWriter({ fetch: request }).write({ episode_id: "e1", context: context(), signal: controller.signal });
  setTimeout(() => controller.abort(new Error("lease lost")), 10);
  await expect(work).rejects.toThrow("lease lost");
});

test("pastry regression rejects invented face, eating, action or visible text while accepting negated constraints", async () => {
  for (const prompt of ["Only hands holding pastry from <image1>. A smiling face is visible.", "Only hands holding pastry from <image1>. The person eats it.", "Only hands tossing pastry from <image1>.", "Only hands holding pastry from <image1>. A sign reads Welcome."]) {
    await expect(createImagePromptWriter({ fetch: fetcher(undefined, { prompt }) }).write({ episode_id: "e1", context: context() })).rejects.toThrow();
  }
});


test("version changes invalidate cache and cache hits are audited again", async () => {
  let calls = 0; let version = "v1";
  const request = async (url: string, init: RequestInit) => {
    const result = await fetcher(() => calls++)(url, init);
    const value = await result.json() as Record<string, unknown> & { metadata: typeof metadata };
    if (url.endsWith("metadata/")) return Response.json({ ...value, writer_version: version });
    return Response.json({ ...value, metadata: { ...value.metadata, writer_version: version } });
  };
  const input = { episode_id: "e1", context: context() };
  const first = await createImagePromptWriter({ fetch: request }).write(input);
  version = "v2";
  const second = await createImagePromptWriter({ fetch: request }).write(input);
  expect(second.provenance.input_hash).not.toBe(first.provenance.input_hash);
  expect(calls).toBe(2);
  const path = join(root, "e1/image-prompts", `${second.provenance.input_hash}.json`);
  const cached = JSON.parse(await readFile(path, "utf8")); cached.result.prompt = "色情场景";
  await writeFile(path, JSON.stringify(cached));
  await expect(createImagePromptWriter({ fetch: request }).write(input)).rejects.toThrow("内容审核");
  expect(calls).toBe(2);
});

test("mutating a reference during rewrite fails without publishing cache", async () => {
  const request = async (url: string, init: RequestInit) => {
    const response = await fetcher()(url, init);
    if (!url.endsWith("metadata/")) await writeFile(join(root, "persona/a.png"), "changed");
    return response;
  };
  await expect(createImagePromptWriter({ fetch: request }).write({ episode_id: "e1", context: context() })).rejects.toThrow("references changed");
});


test("faithful hands-only phrasing is accepted with optional article or reference possessive", async () => {
  for (const prompt of ["Only the hands of <image1> holding shaobing are visible.", "Only <image1>'s hands and the pastry are in frame.", "The frame contains only two hands and shaobing."]) {
    expect((await createImagePromptWriter({ fetch: fetcher(undefined, { prompt }) }).write({ episode_id: `phrasing_${prompt.length}`, context: context() })).prompt).toBe(prompt);
  }
});

test("hands-only regression rejects negated assertion or visible torso/head and accepts explicit cropping", async () => {
  const rejected = [
    "Not only hands and pastry; the character's torso and head are visible.",
    "Only hands and pastry from <image1>. A shoulder and head are visible.",
    "Only hands and pastry from <image1>. The upper body is in frame.",
    "Not just hands and pastry from <image1>, a full portrait appears.",
  ];
  for (const prompt of rejected) await expect(createImagePromptWriter({ fetch: fetcher(undefined, { prompt }) }).write({ episode_id: "reject_framing", context: context() })).rejects.toThrow();
  const accepted = [
    "Only hands and pastry from <image1>. No head, torso, body or shoulders.",
    "Only the hands and pastry from <image1>. The head and torso are cropped out of the frame.",
    "Only hands and pastry from <image1>, without head or torso.",
    "Only hands and pastry from <image1>. Crop out the head and torso.",
  ];
  for (let index = 0; index < accepted.length; index++) {
    const prompt = accepted[index]!;
    expect((await createImagePromptWriter({ fetch: fetcher(undefined, { prompt }) }).write({ episode_id: `crop_framing_${index}`, context: context() })).prompt).toBe(prompt);
  }
});

test("detail pastry keeps user-requested face composition and requested hand action", async () => {
  const face = { ...context(), kf_prompt: "人物咬一口烧饼的面部特写", beat: "吃烧饼" };
  const facePrompt = "A detail shot of <image1>'s face as the person bites shaobing in the scene from <image2>.";
  expect((await createImagePromptWriter({ fetch: fetcher(undefined, { prompt: facePrompt }) }).write({ episode_id: "requested_face", context: face })).prompt).toBe(facePrompt);
  const hands = { ...context(), kf_prompt: "仅手部与烧饼，双手举起烧饼", beat: "展示烧饼" };
  const handsPrompt = "Only the hands of <image1> raise the shaobing in the scene from <image2>. No face or torso.";
  expect((await createImagePromptWriter({ fetch: fetcher(undefined, { prompt: handsPrompt }) }).write({ episode_id: "requested_raise", context: hands })).prompt).toBe(handsPrompt);
});
