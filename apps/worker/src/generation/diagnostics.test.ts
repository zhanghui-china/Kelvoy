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
