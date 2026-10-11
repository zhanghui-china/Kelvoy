import { expect, test } from "bun:test";
import type { H3PromptWriter } from "@kelvoy/engine";
import { observeH3Rewrite } from "./diagnostics";
import { H3FormatError } from "./h3-prompt-format";
import { GenerationError } from "./errors";

test("format correction exhaustion has a safe prompt rewrite diagnostic and does not retry", async () => {
  const writer = observeH3Rewrite({ async write() { throw new H3FormatError("private model output"); } }, { task_id: "tk_1", attempt: 1 });
  try { await writer.write({} as Parameters<H3PromptWriter["write"]>[0]); throw new Error("expected failure"); }
  catch (error) {
    expect(error).toBeInstanceOf(GenerationError);
    const failure = error as GenerationError;
    expect(failure.retryable).toBe(false);
    expect(failure.diagnostic.stage).toBe("prompt_rewrite");
    expect(failure.diagnostic.message).not.toContain("private");
  }
});

test("semantic H3 constraints are terminal format failures", async () => {
  const { validateSections } = await import("./h3-prompt-format");
  expect(() => validateSections({ integrated_multimodal_description: "中文", non_diegetic_music: "N/A" },
    { mode: "I2VA", duration_s: 4 } as Parameters<typeof validateSections>[1])).toThrow(H3FormatError);
});

test("diagnostic carries only the declared rule and distinguishes corrected failures", async () => {
  async function fail(error: H3FormatError) {
    const writer = observeH3Rewrite({ async write() { throw error; } }, { task_id: "tk_1", attempt: 1 });
    return await writer.write({} as Parameters<H3PromptWriter["write"]>[0])
      .then(() => { throw new Error("expected rewrite failure"); }, (e: unknown) => e as GenerationError);
  }
  const constraint = new H3FormatError("H3 constraint: preserve shot size and camera", false, "preserve shot size and camera");
  const first = await fail(constraint);
  expect(first.diagnostic.rule).toBe("preserve shot size and camera");
  expect(first.diagnostic.message).not.toContain("校正后");

  const corrected = new H3FormatError("H3 constraint: invalid visible retention syntax", true, "invalid visible retention syntax");
  corrected.corrected = true;
  const second = await fail(corrected);
  expect(second.diagnostic.message).toContain("校正后仍无效");

  const undeclared = await fail(new H3FormatError("private model output"));
  expect(undeclared.diagnostic.rule).toBeUndefined();
  expect(JSON.stringify(undeclared.diagnostic)).not.toContain("private");
});

test("prompt rewrite diagnostic reports the configured per-request LLM budget", async () => {
  const original = process.env.KELVOY_LLM_TIMEOUT_SECONDS;
  async function budget() {
    const writer = observeH3Rewrite({ async write() { throw new Error("H3 rewrite HTTP 500"); } }, { task_id: "tk_1", attempt: 1 });
    const error = await writer.write({} as Parameters<H3PromptWriter["write"]>[0])
      .then(() => { throw new Error("expected rewrite failure"); }, (e: unknown) => e as GenerationError);
    return error.diagnostic.budget_seconds;
  }
  try {
    delete process.env.KELVOY_LLM_TIMEOUT_SECONDS;
    expect(await budget()).toBe(120);
    process.env.KELVOY_LLM_TIMEOUT_SECONDS = "45";
    expect(await budget()).toBe(45);
  } finally {
    if (original === undefined) delete process.env.KELVOY_LLM_TIMEOUT_SECONDS;
    else process.env.KELVOY_LLM_TIMEOUT_SECONDS = original;
  }
});
