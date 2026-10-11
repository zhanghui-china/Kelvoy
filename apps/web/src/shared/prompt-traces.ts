/**
 * ADR-0012 / docs/api/prompt-traces.md wire model. Built only by
 * server/routes/episode-prompts-view.ts from redacted store rows; the store row
 * type must never reach this file or the browser.
 */
export type PromptTraceKind = "script_generate" | "script_revision" | "h3_rewrite";

export type PromptTraceItem = {
  /** Opaque string; do not parse. */
  id: string;
  kind: PromptTraceKind;
  shot_id: string | null;
  round: number | null;
  attempt: number;
  source: "llm" | "cache";
  outcome: string;
  validated: boolean;
  rule: string | null;
  model: string | null;
  skill_version: string | null;
  writer_version: string | null;
  h3_mode: string | null;
  user_message: string;
  correction_message: string | null;
  final_prompt: string | null;
  /**
   * Redacted raw model output that failed validation; null for accepted attempts and for
   * failures that produced no format-checked text (timeouts, moderation blocks).
   */
  rejected_output: string | null;
  /** First 12 hex characters only. */
  input_hash: string | null;
  truncated: boolean;
  created_at: string;
};

export type PromptTraceLegacy =
  | { note: "final_only"; final_prompt: string }
  | { note: "not_retained" };

export type PromptTracesResponse = {
  ok: true;
  items: PromptTraceItem[];
  next_before: string | null;
  legacy: PromptTraceLegacy | null;
};
