/**
 * ADR-0012: write-only report of what was sent to a model. Engine never returns
 * traces and never touches IO; the caller (apps/worker) supplies the sink and
 * persists whatever it collected inside the task settlement transaction.
 *
 * Entries carry prompt text, so they must never be put on an Error, a
 * diagnostic or a log line. A sink is a side channel: implementations must not
 * throw into the model call, and callers must not depend on it for results.
 */
export type PromptTraceEntry =
  | {
      kind: "script";
      operation: "generate" | "revision";
      /** 1-based self-correction round. */
      round: number;
      /** The exact text sent in this round, including feedback from the previous one. */
      prompt: string;
      outcome: "accepted" | "rule_violation" | "content_blocked" | "parse_error" | "call_failed";
    }
  | {
      kind: "h3_rewrite";
      source: "llm" | "cache";
      /** `JSON.stringify(context)`, the same expression sent as the user message. */
      user_message: string;
      correction_message?: string;
      /** Absent when the rewrite failed. */
      final_prompt?: string;
      outcome: string;
      /** Fixed `H3FormatError.rule` identifier, never model output. */
      rule?: string;
      model: string;
      skill_version: string;
      writer_version: string;
      mode: string;
      input_hash: string;
    };

export type PromptTraceSink = (entry: PromptTraceEntry) => void;
