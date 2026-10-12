import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import type { H3PromptContext, PromptTraceEntry } from "@kelvoy/engine";
import { rewriteTimeoutMs } from "./h3-prompt-writer";
import { H3FormatError } from "./h3-prompt-format";
import { context, makeWriterRoot, response, sections, writer } from "./h3-prompt-writer.fixture";
import { close, deleteEpisode, insertEpisode, open } from "@kelvoy/store";
import { deletionEpisodeFixture } from "../queue/deletion-test-fixture";
let root: string;
let restoreRoot: () => Promise<void>;
beforeEach(async () => { ({ root, restore: restoreRoot } = await makeWriterRoot()); });
afterEach(async () => { await restoreRoot(); });

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

test("a rejected attempt keeps the last raw model output; success and blocked output carry none", async () => {
  // Two rejected rounds with different raw text: the entry must hold the one that decided the failure.
  let calls = 0;
  const raws: string[] = [];
  const bad = tracing((async () => {
    calls++;
    const value = calls === 1 ? { summary: "first rejected output" } : { summary: "second rejected output" };
    raws.push(JSON.stringify(value));
    return response(value);
  }) as unknown as typeof fetch);
  await expect(bad.writer.write({ episode_id: "e1", context: { ...context(), beat: "rejected output input" } }))
    .rejects.toBeInstanceOf(H3FormatError);
  const failed = h3(bad.entries[0]);
  expect(failed.final_prompt).toBeUndefined();
  expect(failed.rejected_output).toBe(raws[1]);

  const ok = tracing((async () => response(sections())) as unknown as typeof fetch);
  await ok.writer.write({ episode_id: "e1", context: { ...context(), beat: "accepted output input" } });
  expect(h3(ok.entries[0]).rejected_output).toBeUndefined();

  // Moderation blocks are not stored: blocked text must not be copied into another table.
  const blocked = tracing((async () => response({ ...sections(), summary: "爆炸物" })) as unknown as typeof fetch);
  await expect(blocked.writer.write({ episode_id: "e1", context: { ...context(), beat: "blocked output input" } })).rejects.toThrow("内容审核");
  expect(h3(blocked.entries[0]).rejected_output).toBeUndefined();
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

// Bare "Picture N" label typos (production replay: 5 of 25 rewrites failed on them).
function bare(value: Record<string, string>): Record<string, string> {
  return { ...value, subject_definitions: value.subject_definitions!.replace(/<(Picture \d)>/g, "$1"),
    detailed_description: value.detailed_description!.replace("<Subject 1> is framed", "<Subject 1> from Picture 1 is framed") };
}

test("bare Picture labels are normalized before validation, rendering and caching", async () => {
  const { entries, writer: traced } = tracing((async () => response(bare(sections()))) as unknown as typeof fetch);
  const result = await traced.write({ episode_id: "e1", context: context() });
  expect(result.prompt).toContain("<Picture 1>");
  expect(result.prompt).toContain("<Picture 2>");
  expect(result.prompt).not.toMatch(/(?<!<)Picture \d/);
  const cached = JSON.parse(await readFile(join(root, "e1/h3-prompts", `${result.provenance.input_hash}.json`), "utf8"));
  expect(cached.sections.subject_definitions).toBe("<Subject 1> is the person from <Picture 1>. <Subject 2> is the scene from <Picture 2>.");
  expect(cached.result.prompt).toBe(result.prompt);
  const entry = h3(entries[0]);
  expect(entry.outcome).toBe("ok");
  expect(entry.normalized_labels).toBe(3);
  expect(entry.final_prompt).toBe(result.prompt);
});

test("a clean rewrite reports no normalized_labels", async () => {
  const { entries, writer: traced } = tracing((async () => response(sections())) as unknown as typeof fetch);
  await traced.write({ episode_id: "e1", context: context() });
  expect(h3(entries[0]).normalized_labels).toBeUndefined();
});

test("normalization does not rescue a supplied picture the model never mentioned", async () => {
  const value = { ...sections(), subject_definitions: "<Subject 1> is the person from Picture 1. <Subject 2> is the scene from Picture 3.",
    summary: "[reference generation] A detail of <Subject 1>'s hands with pastry in <Subject 2>." };
  const error = await writeError(value);
  expect(error.rule).toBe("all supplied pictures must be referenced");
});

test("normalization only touches provided numbers, so an unprovided <Picture 3> still fails", async () => {
  const value = { ...bare(sections()), summary: "[reference generation] Hands in <Subject 2>, see <Picture 3>." };
  const error = await writeError(value);
  expect(error.rule).toBe("unprovided picture reference");
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

test("system prompt tells the model the person is out of frame only when person_visible is false", async () => {
  const prompts: string[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    prompts.push(JSON.parse(init!.body as string).messages[0].content);
    return response(sections());
  }) as unknown as typeof fetch;
  await writer(fetcher).write({ episode_id: "e1", context: { ...context(), person_visible: false } });
  await writer(fetcher).write({ episode_id: "e2", context: context() });
  await writer(fetcher).write({ episode_id: "e3", context: { ...context(), person_visible: true } });
  expect(prompts[0]).toContain("no person is visible in this shot");
  expect(prompts[1]).not.toContain("no person is visible in this shot");
  expect(prompts[2]).not.toContain("no person is visible in this shot");
});

test("person_visible changes the cache key only when it is false", async () => {
  const hash = async (episode_id: string, extra: Partial<H3PromptContext>) =>
    (await writer((async () => response(sections())) as unknown as typeof fetch)
      .write({ episode_id, context: { ...context(), ...extra } })).provenance.input_hash;
  const base = await hash("e1", {});
  expect(await hash("e2", { person_visible: true })).toBe(base);
  expect(await hash("e3", { person_visible: false })).not.toBe(base);
});

test("system prompt keeps orientation and the landmark anchor, and the writer version invalidates v1 caches", async () => {
  let system = "";
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    system = JSON.parse(String(init.body)).messages[0].content;
    return response(sections());
  }) as unknown as typeof fetch;
  const result = await writer(fetcher).write({ episode_id: "e1", context: context() });
  expect(system).toContain("Name the shot size (wide / medium / close-up / detail / POV)");
  expect(system).toContain("keep the subject's orientation and gaze as the source states");
  expect(system).toContain("never turn the subject to face the camera unless the source action says so");
  expect(system).toContain("is visible from 00:00");
  expect(result.provenance.writer_version).toBe("h3-writer-v3");
});
