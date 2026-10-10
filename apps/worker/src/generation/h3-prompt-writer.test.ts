import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { H3PromptContext } from "@kelvoy/engine";
import { createH3PromptWriter } from "./h3-prompt-writer";
let root: string;
let oldRoot: string | undefined;
beforeEach(async () => {
  oldRoot = process.env.KELVOY_PROJECTS_ROOT;
  root = await mkdtemp(join(tmpdir(), "h3-writer-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  await mkdir(join(root, "persona")); await mkdir(join(root, "dest"));
  await mkdir(join(root, "e1", "kf"), { recursive: true });
  await writeFile(join(root, "persona/a.png"), "person"); await writeFile(join(root, "dest/a.png"), "scene");
  await writeFile(join(root, "e1/kf/a.png"), "first frame");
});
afterEach(async () => {
  if (oldRoot === undefined) delete process.env.KELVOY_PROJECTS_ROOT; else process.env.KELVOY_PROJECTS_ROOT = oldRoot;
  await rm(root, { recursive: true, force: true });
});
function context(mode: H3PromptContext["mode"] = "Ref2VA", duration_s = 4): H3PromptContext {
  return { mode, aspect: "9:16", duration_s, size: "detail", camera: "static", beat: "展示黄山烧饼",
    kf_prompt: "仅手部与黄山烧饼细节", motion_prompt: "手腕轻微旋转，固定镜头", scene: null,
    destination: "黄山", landmark: "街头", references: mode === "Ref2VA"
      ? [{ key: "persona/a.png", role: "person", picture: 1 }, { key: "dest/a.png", role: "scene", picture: 2 }]
      : [{ key: "e1/kf/a.png", role: "first_frame", picture: 1 }] };
}
function sections(mode: H3PromptContext["mode"] = "Ref2VA", duration_s = 4): Record<string, string> {
  const timeline = `[Shot 1] A detail shot shows only hands and pastry. A slight wrist rotation continues with a static camera through 00:0${duration_s}.000, in one continuous shot.`;
  return mode === "Ref2VA" ? {
    subject_definitions: "<Subject 1> is the person from <Picture 1>. <Subject 2> is the scene from <Picture 2>.",
    summary: "[reference generation] A detail of <Subject 1>'s hands with pastry in <Subject 2>.",
    retention_analysis: "<Subject 1> (appears in [Shot 1]): partially_preserved - hands only.\n<Subject 2> (appears in [Shot 1]): weak_reference - scene only.",
    detailed_description: timeline + " <Subject 1> is framed against <Subject 2>.",
    overall_soundscape: "Quiet ambient sound.", non_diegetic_music: "N/A",
  } : { integrated_multimodal_description: timeline, overall_soundscape: "Quiet ambient sound.", non_diegetic_music: "N/A" };
}
function response(value: unknown) { return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] }); }
function writer(call: typeof fetch, options = {}) { return createH3PromptWriter({ fetch: call, apiKey: "test", ...options }); }

test("official Ref2VA sections preserve reference order and cache across writer instances", async () => {
  let calls = 0;
  const fetcher = (async (_url: string, init: RequestInit) => {
    calls++; const body = JSON.parse(init!.body as string);
    expect(body.model).toBe("step-3.5-flash");
    expect(body.messages[0].content).toContain("retention_analysis");
    expect(body.messages[1].content).toContain("手腕轻微旋转");
    expect(body.messages[1].content).not.toContain("caption");
    return response(sections());
  }) as unknown as typeof fetch;
  const input = { episode_id: "e1", context: context() };
  const first = await writer(fetcher).write(input);
  expect(first.prompt.indexOf("subject_definitions:")).toBe(0);
  expect(first.prompt).toContain("non_diegetic_music: N/A");
  expect(await writer(fetcher).write(input)).toEqual(first);
  expect(calls).toBe(1);
  await writeFile(join(root, "dest/a.png"), "new scene");
  expect((await writer(fetcher).write(input)).provenance.input_hash).not.toBe(first.provenance.input_hash);
  input.context.motion_prompt += "轻轻";
  await writer(fetcher).write(input);
  expect(calls).toBe(3);
});
test("I2VA uses exact official first-frame instruction and five seconds", async () => {
  const result = await writer((async () => response(sections("I2VA", 5))) as unknown as typeof fetch)
    .write({ episode_id: "e1", context: context("I2VA", 5) });
  expect(result.prompt).toStartWith("For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\nintegrated_multimodal_description:");
  expect(result.provenance.duration_s).toBe(5);
});
test("only malformed format gets one correction", async () => {
  let calls = 0;
  const result = await writer((async () => { calls++; return response(calls === 1 ? { wrong: "field" } : sections()); }) as unknown as typeof fetch)
    .write({ episode_id: "e1", context: context() });
  expect(calls).toBe(2); expect(result.prompt).toContain("detailed_description:");
  calls = 0;
  await expect(writer((async () => { calls++; return response({}); }) as unknown as typeof fetch)
    .write({ episode_id: "e1", context: { ...context(), beat: "new input" } })).rejects.toThrow("format");
  expect(calls).toBe(2);
});
test("semantic violations and blocked output never get correction", async () => {
  for (const timeline of ["[Shot 1] A face eats pastry through 00:04.000.", "[Shot 1] detail hands static camera through 00:05.000.", "[Shot 1] hands detail static through 00:04.000. [Shot 2] Cut."]) {
    let calls = 0;
    await expect(writer((async () => { calls++; return response({ ...sections(), detailed_description: timeline }); }) as unknown as typeof fetch)
      .write({ episode_id: "e1", context: context() })).rejects.toThrow();
    expect(calls).toBe(1);
  }
  let calls = 0;
  await expect(writer((async () => { calls++; return response({ ...sections(), summary: "爆炸物" }); }) as unknown as typeof fetch)
    .write({ episode_id: "e1", context: context() })).rejects.toThrow("内容审核");
  expect(calls).toBe(1);
});
test("abort and timeout stop rewrite without fallback", async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const fetcher = ((_: string, init: RequestInit) => { calls++; return new Promise((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
  }); }) as unknown as typeof fetch;
  await expect(writer(fetcher).write({ episode_id: "e1", context: context(), signal: controller.signal })).rejects.toThrow();
  expect(calls).toBe(0);
  await expect(writer(fetcher, { timeoutMs: 10 }).write({ episode_id: "e1", context: context() })).rejects.toThrow();
  expect(calls).toBe(1);
});


test("unsafe input is blocked before LLM and unsafe cached output is blocked on reuse", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return response(sections()); }) as unknown as typeof fetch;
  await expect(writer(fetcher).write({ episode_id: "e1", context: { ...context(), motion_prompt: "爆炸物" } })).rejects.toThrow("内容审核");
  expect(calls).toBe(0);
  const input = { episode_id: "e1", context: context() };
  const result = await writer(fetcher).write(input);
  const cachePath = join(root, "e1/h3-prompts", `${result.provenance.input_hash}.json`);
  const cached = JSON.parse(await readFile(cachePath, "utf8"));
  cached.sections.summary = "porn";
  await writeFile(cachePath, JSON.stringify(cached));
  await expect(writer(fetcher).write(input)).rejects.toThrow("内容审核");
  expect(calls).toBe(1);
});

test("cache fingerprints include aspect, guide text and writer LLM configuration", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return response(sections()); }) as unknown as typeof fetch;
  const skillRoot = join(root, "skill");
  await mkdir(join(skillRoot, "references"), { recursive: true });
  await writeFile(join(skillRoot, "SKILL.md"), "test skill");
  await writeFile(join(skillRoot, "references/ref-en.txt"), "official test guide");
  await writeFile(join(skillRoot, "references/base-en.txt"), "base test guide");
  const input = { episode_id: "e1", context: context() };
  const first = await writer(fetcher, { skillRoot }).write(input);
  const wide = await writer(fetcher, { skillRoot }).write({ ...input, context: { ...input.context, aspect: "16:9" } });
  expect(wide.provenance.input_hash).not.toBe(first.provenance.input_hash);
  await writeFile(join(skillRoot, "references/ref-en.txt"), "edited guide");
  const changed = await writer(fetcher, { skillRoot }).write(input);
  expect(changed.provenance.skill_version).not.toBe(first.provenance.skill_version);
  expect((await writer(fetcher, { skillRoot, model: "other-model" }).write(input)).provenance.input_hash).not.toBe(changed.provenance.input_hash);
  expect((await writer(fetcher, { skillRoot, baseUrl: "https://example.test/v1" }).write(input)).provenance.input_hash).not.toBe(changed.provenance.input_hash);
  await writeFile(join(skillRoot, "references/base-en.txt"), "edited base guide");
  const changedBase = await writer(fetcher, { skillRoot }).write(input);
  expect(changedBase.provenance.skill_version).not.toBe(changed.provenance.skill_version);
  expect(calls).toBe(6);
});

test("source role swaps, malformed labels, invalid retention and added actions fail once", async () => {
  const valid = sections() as Record<string, string>;
  const variants = [
    { ...valid, subject_definitions: "<Subject 1> is the person from <Picture 2>. <Subject 2> is the scene from <Picture 1>." },
    { ...valid, summary: "[reference generation] <Picture 3.0> guides hands." },
    { ...valid, summary: "[reference generation] <Subject X> guides hands." },
    { ...valid, retention_analysis: "<Subject 1>: reference - hands." },
    { ...valid, detailed_description: valid.detailed_description + " The camera pans." },
    { ...valid, detailed_description: valid.detailed_description + " The clip lasts 8 seconds." },
    { ...valid, detailed_description: valid.detailed_description + " A person says hello." },
    { ...valid, non_diegetic_music: "upbeat" },
    { ...valid, summary: "[reference generation] The reference picture shows a red hat." },
    { ...valid, subject_definitions: "<Subject 1> is the scene from <Picture 1>. <Subject 2> is the person from <Picture 2>." },
  ];
  for (const invalid of variants) {
    let calls = 0;
    await expect(writer((async () => { calls++; return response(invalid); }) as unknown as typeof fetch)
      .write({ episode_id: "e1", context: context() })).rejects.toThrow("H3 constraint");
    expect(calls).toBe(1);
  }
});

test("negative production constraints do not become described actions", async () => {
  const valid = sections() as Record<string, string>;
  valid.detailed_description += " No face. No eating. No cuts. No dialogue. No captions.";
  expect((await writer((async () => response(valid)) as unknown as typeof fetch)
    .write({ episode_id: "e1", context: context() })).prompt).toContain("No face");
});

test("mutated references during rewrite and escaped symlinks fail before generation", async () => {
  await expect(writer((async () => { await writeFile(join(root, "dest/a.png"), "replacement"); return response(sections()); }) as unknown as typeof fetch)
    .write({ episode_id: "e1", context: context() })).rejects.toThrow("references changed");
  await rm(join(root, "dest/a.png")); await symlink("/etc/hosts", join(root, "dest/a.png"));
  let calls = 0;
  await expect(writer((async () => { calls++; return response(sections()); }) as unknown as typeof fetch)
    .write({ episode_id: "e1", context: context() })).rejects.toThrow("escapes projects root");
  expect(calls).toBe(0);
});

test("HTTP failures are terminal and cancellation reaches in-flight fetch", async () => {
  let calls = 0;
  await expect(writer((async () => { calls++; return new Response("private upstream error", { status: 429 }); }) as unknown as typeof fetch)
    .write({ episode_id: "e1", context: context() })).rejects.toThrow("HTTP 429");
  expect(calls).toBe(1);
  const controller = new AbortController();
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const running = writer(((_: string, init: RequestInit) => { started(); return new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  }); }) as unknown as typeof fetch).write({ episode_id: "e1", context: context(), signal: controller.signal });
  await ready; controller.abort(new Error("lease lost"));
  await expect(running).rejects.toThrow("lease lost");
});


test("escaped JSON blocked content is moderated after parsing", async () => {
  let calls = 0;
  const value = sections(); value.summary = "爆炸物";
  const fetcher = async () => { calls++; return Response.json({ choices: [{ message: { content: JSON.stringify(value).replace("爆炸物", "\\u7206\\u70b8\\u7269") } }] }); };
  await expect(writer(fetcher as unknown as typeof fetch).write({ episode_id: "e1", context: context() })).rejects.toThrow("内容审核");
  expect(calls).toBe(1);
});

test("pastry detail rejects extra motion, visible text and contradictory total duration", async () => {
  const valid = sections();
  for (const added of [
    "The hands toss the pastry into the air and catch it.",
    'A sign reads "SALE".',
    "The clip lasts 3 seconds.",
  ]) {
    let calls = 0;
    await expect(writer((async () => { calls++; return response({ ...valid, detailed_description: valid.detailed_description + " " + added }); }) as unknown as typeof fetch)
      .write({ episode_id: "e1", context: context() })).rejects.toThrow("H3 constraint");
    expect(calls).toBe(1);
  }
  const allowed = { ...valid, detailed_description: valid.detailed_description + " For the first 2 seconds, the slight wrist rotation continues. The total duration is 4 seconds." };
  expect((await writer((async () => response(allowed)) as unknown as typeof fetch)
    .write({ episode_id: "e1", context: context() })).prompt).toContain("first 2 seconds");
});

test("all rewrite sections reject added dialogue, lyrics and visible text", async () => {
  const valid = sections();
  const variants = [
    { ...valid, overall_soundscape: "A narrator says Welcome to Huangshan; a singer sings lyrics." },
    { ...valid, overall_soundscape: "Sung vocals perform a melody." },
    { ...valid, summary: '[reference generation] A sign reads "SALE" alongside <Subject 1> in <Subject 2>.' },
    { ...valid, subject_definitions: valid.subject_definitions + " A caption is visible." },
  ];
  for (const invalid of variants) {
    let calls = 0;
    await expect(writer((async () => { calls++; return response(invalid); }) as unknown as typeof fetch)
      .write({ episode_id: "e1", context: context() })).rejects.toThrow("H3 constraint");
    expect(calls).toBe(1);
  }
  const allowed = { ...valid, overall_soundscape: "Quiet ambient sound. No dialogue, lyrics, or narration. No vocals.", summary: valid.summary + " No subtitles. No on-screen text." };
  expect((await writer((async () => response(allowed)) as unknown as typeof fetch)
    .write({ episode_id: "e1", context: context() })).prompt).toContain("No dialogue, lyrics, or narration");
});
