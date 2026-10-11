import { expect, test } from "bun:test";
import type { Task } from "@kelvoy/engine";
import { createPromptTraceCollector } from "./prompt-trace-collector";

const task = { task_id: "tk_1", shot_id: "sh_1", attempt: 1 } as Task;

test("script entries map to store rows with the prompt as the user message", () => {
  const { sink, drain } = createPromptTraceCollector(task);
  sink({ kind: "script", operation: "generate", round: 1, prompt: "P1", outcome: "rule_violation" });
  sink({ kind: "script", operation: "revision", round: 2, prompt: "P2", outcome: "accepted" });
  expect(drain()).toEqual([
    { kind: "script_generate", round: 1, source: "llm", user_message: "P1", outcome: "rule_violation" },
    { kind: "script_revision", round: 2, source: "llm", user_message: "P2", outcome: "accepted" },
  ]);
});

test("h3 entries map one to one and take shot_id from the task", () => {
  const { sink, drain } = createPromptTraceCollector(task);
  sink({ kind: "h3_rewrite", source: "cache", user_message: "U", final_prompt: "F", outcome: "ok",
    model: "m", skill_version: "s", writer_version: "w", mode: "I2VA", input_hash: "h" });
  sink({ kind: "h3_rewrite", source: "llm", user_message: "U2", correction_message: "C", outcome: "prompt_format_invalid",
    rule: "r", model: "m", skill_version: "s", writer_version: "w", mode: "Ref2VA", input_hash: "h2" });
  expect(drain()).toEqual([
    { kind: "h3_rewrite", shot_id: "sh_1", source: "cache", user_message: "U", final_prompt: "F", outcome: "ok",
      model: "m", skill_version: "s", writer_version: "w", h3_mode: "I2VA", input_hash: "h" },
    { kind: "h3_rewrite", shot_id: "sh_1", source: "llm", user_message: "U2", correction_message: "C",
      outcome: "prompt_format_invalid", rule: "r", model: "m", skill_version: "s", writer_version: "w",
      h3_mode: "Ref2VA", input_hash: "h2" },
  ]);
});

test("drain empties the collector so one batch is never committed twice", () => {
  const { sink, drain } = createPromptTraceCollector(task);
  sink({ kind: "script", operation: "generate", round: 1, prompt: "P", outcome: "accepted" });
  expect(drain()).toHaveLength(1);
  expect(drain()).toEqual([]);
});
