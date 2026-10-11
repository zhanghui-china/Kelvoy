import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { H3PromptContext, PromptTraceEntry } from "@kelvoy/engine";
import { createH3PromptWriter, rewriteTimeoutMs } from "./h3-prompt-writer";
import { H3FormatError } from "./h3-prompt-format";
import { close, deleteEpisode, insertEpisode, open } from "@kelvoy/store";
import { deletionEpisodeFixture } from "../queue/deletion-test-fixture";
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

test("deleted work cannot archive a late H3 rewrite result", async () => {
  open(":memory:");
  try {
    await insertEpisode(deletionEpisodeFixture("e1", "u_owner"));
    const fetcher = (async () => {
      await deleteEpisode("e1", "u_owner");
      return response(sections());
    }) as unknown as typeof fetch;
    await expect(writer(fetcher).write({ episode_id: "e1", context: context() })).rejects.toThrow("episode deleted");
  } finally { close(); }
});

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

test("source role swaps, malformed labels and added actions fail once", async () => {
  const valid = sections() as Record<string, string>;
  const variants = [
    { ...valid, subject_definitions: "<Subject 1> is the person from <Picture 2>. <Subject 2> is the scene from <Picture 1>." },
    { ...valid, summary: "[reference generation] <Picture 3.0> guides hands." },
    { ...valid, summary: "[reference generation] <Subject X> guides hands." },
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

test("retention section grammar receives one format correction without changing source context", async () => {
  let calls = 0;
  const original = context();
  const result = await writer((async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string); calls++;
    expect(JSON.parse(body.messages[1].content)).toEqual(original);
    if (calls === 2) expect(body.messages.at(-1).content).toContain("invalid visible retention syntax");
    return response(calls === 1 ? { ...sections(), retention_analysis: "<Subject 1>: partially_preserved; <Subject 2>: weak_reference" } : sections());
  }) as unknown as typeof fetch).write({ episode_id: "e1", context: original });
  expect(calls).toBe(2);
  expect(result.prompt).toContain("(appears in [Shot 1]): partially_preserved");
});

test("retention grammar still invalid after correction stops after two requests", async () => {
  let calls = 0;
  await expect(writer((async () => { calls++; return response({ ...sections(), retention_analysis: "invalid format" }); }) as unknown as typeof fetch)
    .write({ episode_id: "e1", context: context() })).rejects.toThrow("invalid visible retention syntax");
  expect(calls).toBe(2);
});

 test("retention formatting never permits correcting unsafe described actions", async () => {
  let calls = 0;
  await expect(writer((async () => { calls++; return response({ ...sections(), retention_analysis: "bad format", detailed_description: sections().detailed_description + " The camera pans." }); }) as unknown as typeof fetch)
    .write({ episode_id: "e1", context: context() })).rejects.toThrow("static camera cannot move");
  expect(calls).toBe(1);
});

async function writeError(value: unknown) {
  const fetcher = (async () => response(value)) as unknown as typeof fetch;
  return await writer(fetcher).write({ episode_id: "e1", context: context() })
    .then(() => { throw new Error("expected rewrite failure"); }, (e: unknown) => e as H3FormatError);
}

test("constraint failures expose a stable rule and were not corrected", async () => {
  const error = await writeError({ ...sections(), detailed_description: sections().detailed_description + " The camera pans." });
  expect(error).toBeInstanceOf(H3FormatError);
  expect(error.rule).toBe("static camera cannot move");
  expect(error.corrected).toBe(false);
});

test("retention grammar failure after correction records its rule and that correction ran", async () => {
  const error = await writeError({ ...sections(), retention_analysis: "invalid format" });
  expect(error.rule).toBe("invalid visible retention syntax");
  expect(error.corrected).toBe(true);
});

test("malformed section JSON records the structural rule", async () => {
  const error = await writeError({ summary: "only one field" });
  expect(error.rule).toBe("section_fields");
  expect(error.corrected).toBe(true);
});

// ADR-0012: prompt trace sink
function tracing(fetcher: typeof fetch, options: Parameters<typeof writer>[1] = {}) {
  const entries: PromptTraceEntry[] = [];
  return { entries, writer: writer(fetcher, { ...options, trace: (entry: PromptTraceEntry) => { entries.push(entry); } }) };
}
function h3(entry: PromptTraceEntry | undefined) {
  if (entry?.kind !== "h3_rewrite") throw new Error("expected an h3_rewrite entry");
  return entry;
}

test("trace reports the exact user message, final prompt and provenance of an LLM rewrite", async () => {
  const { entries, writer: traced } = tracing((async () => response(sections("I2VA", 5))) as unknown as typeof fetch);
  const result = await traced.write({ episode_id: "e1", context: context("I2VA", 5) });
  expect(entries).toHaveLength(1);
  const entry = h3(entries[0]);
  expect(entry.source).toBe("llm");
  expect(entry.user_message).toBe(JSON.stringify(context("I2VA", 5)));
  expect(entry.final_prompt).toBe(result.prompt);
  expect(entry.outcome).toBe("ok");
  expect(entry.correction_message).toBeUndefined();
  expect(entry.rule).toBeUndefined();
  expect({ model: entry.model, skill_version: entry.skill_version, writer_version: entry.writer_version, mode: entry.mode, input_hash: entry.input_hash })
    .toEqual({ model: result.provenance.model, skill_version: result.provenance.skill_version,
      writer_version: result.provenance.writer_version, mode: result.provenance.mode, input_hash: result.provenance.input_hash });
});

test("trace carries the correction message and failed outcome with rule but no final prompt", async () => {
  let calls = 0;
  const ok = tracing((async () => { calls++; return response(calls === 1 ? { wrong: "field" } : sections()); }) as unknown as typeof fetch);
  await ok.writer.write({ episode_id: "e1", context: context() });
  expect(h3(ok.entries[0]).correction_message).toContain("Fix JSON and section formatting only");
  expect(h3(ok.entries[0]).outcome).toBe("ok");

  const bad = tracing((async () => response({ summary: "only one field" })) as unknown as typeof fetch);
  await expect(bad.writer.write({ episode_id: "e1", context: { ...context(), beat: "another input" } })).rejects.toBeInstanceOf(H3FormatError);
  expect(bad.entries).toHaveLength(1);
  const failed = h3(bad.entries[0]);
  expect(failed.outcome).toBe("prompt_format_invalid");
  expect(failed.rule).toBe("section_fields");
  expect(failed.final_prompt).toBeUndefined();
  expect(failed.correction_message).toBeDefined();
});

test("trace marks timeouts and blocked output with the shared outcome", async () => {
  const hang = ((_: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
  })) as unknown as typeof fetch;
  const slow = tracing(hang, { timeoutMs: 10 });
  await expect(slow.writer.write({ episode_id: "e1", context: context() })).rejects.toThrow();
  expect(h3(slow.entries[0]).outcome).toBe("prompt_rewrite_timeout");

  const blocked = tracing((async () => response({ ...sections(), summary: "爆炸物" })) as unknown as typeof fetch);
  await expect(blocked.writer.write({ episode_id: "e1", context: context() })).rejects.toThrow("内容审核");
  expect(h3(blocked.entries[0])).toMatchObject({ outcome: "content_blocked", source: "llm" });
  expect(h3(blocked.entries[0]).final_prompt).toBeUndefined();
});

test("a cache hit is its own entry without any model call", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return response(sections()); }) as unknown as typeof fetch;
  const input = { episode_id: "e1", context: context() };
  const first = await writer(fetcher).write(input);
  const { entries, writer: traced } = tracing(fetcher);
  await traced.write(input);
  expect(calls).toBe(1);
  expect(entries).toHaveLength(1);
  expect(h3(entries[0])).toMatchObject({ source: "cache", outcome: "ok", final_prompt: first.prompt,
    user_message: JSON.stringify(context()), input_hash: first.provenance.input_hash });
});

test("user cancellation emits no entry", async () => {
  const controller = new AbortController();
  const fetcher = (async () => { controller.abort(); throw new Error("aborted by user"); }) as unknown as typeof fetch;
  const { entries, writer: traced } = tracing(fetcher);
  await expect(traced.write({ episode_id: "e1", context: context(), signal: controller.signal })).rejects.toThrow();
  expect(entries).toHaveLength(0);
});

test("a throwing sink never changes the writer result or its error", async () => {
  const boom = () => { throw new Error("sink exploded"); };
  const okWriter = writer((async () => response(sections())) as unknown as typeof fetch, { trace: boom });
  const result = await okWriter.write({ episode_id: "e1", context: context() });
  expect(result.prompt).toContain("detailed_description:");
  const failWriter = writer((async () => response({ ...sections(), summary: "爆炸物" })) as unknown as typeof fetch, { trace: boom });
  await expect(failWriter.write({ episode_id: "e1", context: { ...context(), beat: "x" } })).rejects.toThrow("内容审核");
});

test("rewrite timeout prefers the explicit override and otherwise follows the shared LLM budget", () => {
  const original = process.env.KELVOY_LLM_TIMEOUT_SECONDS;
  try {
    delete process.env.KELVOY_LLM_TIMEOUT_SECONDS;
    expect(rewriteTimeoutMs({})).toBe(120_000);
    expect(rewriteTimeoutMs({ timeoutMs: 10 })).toBe(10);
    process.env.KELVOY_LLM_TIMEOUT_SECONDS = "45";
    expect(rewriteTimeoutMs({})).toBe(45_000);
    expect(rewriteTimeoutMs({ timeoutMs: 10 })).toBe(10);
  } finally {
    if (original === undefined) delete process.env.KELVOY_LLM_TIMEOUT_SECONDS;
    else process.env.KELVOY_LLM_TIMEOUT_SECONDS = original;
  }
});
