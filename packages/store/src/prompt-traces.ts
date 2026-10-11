import type { Database } from "bun:sqlite";
import type { Task } from "@kelvoy/engine";
import { getDb } from "./db";

/**
 * ADR-0012: owner-visible prompt records. Rows are appended inside the task
 * settlement transaction (charged-tasks.ts) and are only readable through
 * listPromptTraces, which returns raw rows; redaction belongs to the web view.
 */

export type PromptTraceKind = "script_generate" | "script_revision" | "h3_rewrite";

/** One row as reported by the Worker. task_id/attempt/seq/episode_id/owner_id are filled in by the store. */
export type PromptTraceInput = {
  kind: PromptTraceKind;
  shot_id?: string; round?: number;
  source: "llm" | "cache";
  outcome: string; rule?: string;
  model?: string; skill_version?: string; writer_version?: string; h3_mode?: string;
  user_message: string; correction_message?: string; final_prompt?: string;
  input_hash?: string;
};

export type PromptTraceRow = PromptTraceInput & {
  task_id: string; attempt: number; seq: number; episode_id: string; owner_id: string;
  truncated: number; created_at: string; rowid: number;
};

/** Per-field cap, in UTF-8 bytes (matches what the column actually stores on disk). */
export const PROMPT_TRACE_FIELD_MAX_BYTES = 64 * 1024;
/** Max rows written per execution. */
export const PROMPT_TRACE_MAX_ROWS = 16;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Cut to at most PROMPT_TRACE_FIELD_MAX_BYTES UTF-8 bytes, never inside a multi-byte character. */
function clamp(value: string | undefined): { text: string | null; truncated: boolean } {
  if (value === undefined) return { text: null, truncated: false };
  const bytes = encoder.encode(value);
  if (bytes.length <= PROMPT_TRACE_FIELD_MAX_BYTES) return { text: value, truncated: false };
  let end = PROMPT_TRACE_FIELD_MAX_BYTES;
  // bytes[end] is the first dropped byte; if it is a continuation byte the cut is mid-character.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return { text: decoder.decode(bytes.subarray(0, end)), truncated: true };
}

/**
 * Synchronous and transaction-scoped: opens no transaction of its own, so a
 * failure propagates and rolls the caller's settlement back (ADR-0012 "不吞错").
 * owner_id/episode_id come from the episodes row inside SQL; a missing or
 * deleted episode inserts nothing and is not an error.
 */
export function insertPromptTraces(db: Database, task: Task, traces: PromptTraceInput[] | undefined): void {
  if (!traces?.length) return;
  const stmt = db.query(`insert or ignore into prompt_traces
    (task_id, attempt, seq, episode_id, owner_id, kind, shot_id, round, source, outcome, rule,
     model, skill_version, writer_version, h3_mode, user_message, correction_message, final_prompt,
     input_hash, truncated)
    select ?, ?, ?, e.episode_id, e.owner_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    from episodes e where e.episode_id = ?`);
  traces.slice(0, PROMPT_TRACE_MAX_ROWS).forEach((trace, seq) => {
    const user = clamp(trace.user_message);
    const correction = clamp(trace.correction_message);
    const final = clamp(trace.final_prompt);
    stmt.run(task.task_id, task.attempt, seq, trace.kind, trace.shot_id ?? null, trace.round ?? null,
      trace.source, trace.outcome, trace.rule ?? null, trace.model ?? null, trace.skill_version ?? null,
      trace.writer_version ?? null, trace.h3_mode ?? null, user.text, correction.text, final.text,
      trace.input_hash ?? null, user.truncated || correction.truncated || final.truncated ? 1 : 0,
      task.episode_id);
  });
}

const KINDS: Record<"script" | "video", PromptTraceKind[]> = {
  script: ["script_generate", "script_revision"],
  video: ["h3_rewrite"],
};

/** Newest first, scoped by owner as a second isolation layer. Raw rows: do not hand them to any route as-is. */
export async function listPromptTraces(query: {
  episodeId: string; ownerId: string; kind: "script" | "video";
  shotId?: string; limit: number; before?: number;
}): Promise<{ items: PromptTraceRow[]; next_before: number | null }> {
  const limit = Math.max(1, Math.min(Math.trunc(query.limit) || 1, 50));
  const kinds = KINDS[query.kind];
  const conditions = ["episode_id = ?", "owner_id = ?", `kind in (${kinds.map(() => "?").join(",")})`];
  const params: (string | number)[] = [query.episodeId, query.ownerId, ...kinds];
  if (query.shotId !== undefined) { conditions.push("shot_id = ?"); params.push(query.shotId); }
  if (query.before !== undefined) { conditions.push("rowid < ?"); params.push(query.before); }
  const found = getDb().query<PromptTraceRow, (string | number)[]>(
    `select rowid, * from prompt_traces where ${conditions.join(" and ")} order by rowid desc limit ?`,
  ).all(...params, limit + 1);
  const items = found.slice(0, limit);
  return { items, next_before: found.length > limit ? items[items.length - 1]!.rowid : null };
}
