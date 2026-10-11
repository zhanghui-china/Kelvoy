import type { PromptTraceEntry, PromptTraceSink, Task } from "@kelvoy/engine";
import type { PromptTraceInput } from "@kelvoy/store";

/**
 * ADR-0012: gathers what one task execution sent to models, in call order, so the
 * consumer can hand it to the settlement transaction. One collector per execution;
 * never shared across tasks. Truncation and row caps are the store's job.
 */
export interface PromptTraceCollector {
  sink: PromptTraceSink;
  /** Returns everything collected and empties the collector (a batch is committed once). */
  drain(): PromptTraceInput[];
}

function toRow(entry: PromptTraceEntry, task: Task): PromptTraceInput {
  if (entry.kind === "script") {
    return { kind: entry.operation === "revision" ? "script_revision" : "script_generate", round: entry.round,
      source: "llm", user_message: entry.prompt, outcome: entry.outcome };
  }
  // `entry.normalized_labels` is deliberately not mapped: persisting it needs a new store column
  // (out of scope for the label-normalization fix). The count stays visible to sinks via the entry.
  return { kind: "h3_rewrite", shot_id: task.shot_id, source: entry.source, user_message: entry.user_message,
    correction_message: entry.correction_message, final_prompt: entry.final_prompt,
    rejected_output: entry.rejected_output, outcome: entry.outcome,
    rule: entry.rule, model: entry.model, skill_version: entry.skill_version, writer_version: entry.writer_version,
    h3_mode: entry.mode, input_hash: entry.input_hash };
}

export function createPromptTraceCollector(task: Task): PromptTraceCollector {
  let rows: PromptTraceInput[] = [];
  return {
    sink: (entry) => { rows.push(toRow(entry, task)); },
    drain: () => { const batch = rows; rows = []; return batch; },
  };
}
