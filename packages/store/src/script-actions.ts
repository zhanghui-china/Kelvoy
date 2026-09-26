import type { Episode, Task } from "@kelvoy/engine";
import { getDb } from "./db";
import { reserveCredits } from "./credits";

export type ScriptActionResult =
  | { ok: true; row_version: number; task: Task }
  | { ok: false; error: "not_found" | "version_conflict" | "illegal_transition" | "action_pending" | "insufficient_credits"; current_row_version?: number };

/** Version check, pending marker and queue insert commit together. */
export function submitScriptAction(input: {
  episode_id: string;
  owner_id: string;
  row_version: number;
  operation: "script_regenerate" | "script_optimize";
  instruction?: string;
}): ScriptActionResult {
  const db = getDb();
  return db.transaction(() => {
    const row = db.query<{ doc: string; row_version: number }, [string, string]>(
      "select doc, row_version from episodes where episode_id = ? and owner_id = ?",
    ).get(input.episode_id, input.owner_id);
    if (!row) return { ok: false, error: "not_found" } as const;
    if (row.row_version !== input.row_version) {
      return { ok: false, error: "version_conflict", current_row_version: row.row_version } as const;
    }
    const episode = JSON.parse(row.doc) as Episode;
    if (episode.status !== "script_review") return { ok: false, error: "illegal_transition" } as const;
    if (episode.script_pending_task_id) return { ok: false, error: "action_pending" } as const;
    const taskId = `tk_${crypto.randomUUID()}`;
    const reserved = reserveCredits({ action_id: taskId, user_id: input.owner_id,
      episode_id: input.episode_id, task_id: taskId, kind: "script", units: 1 });
    if (!reserved.ok) return { ok: false,
      error: reserved.error === "insufficient_credits" ? "insufficient_credits" : "not_found" } as const;
    const updated = { ...episode, script_pending_task_id: taskId, script_action_error: null };
    db.query("update episodes set doc = ?, row_version = row_version + 1, updated_at = datetime('now') where episode_id = ?")
      .run(JSON.stringify(updated), input.episode_id);
    db.query(`insert into tasks
      (task_id, episode_id, stage, operation, instruction, attempt, status)
      values (?, ?, 'script', ?, ?, 1, 'pending')`)
      .run(taskId, input.episode_id, input.operation, input.instruction ?? null);
    return { ok: true, row_version: row.row_version + 1,
      task: { task_id: taskId, episode_id: input.episode_id, stage: "script" as const,
        attempt: 1, operation: input.operation, ...(input.instruction ? { instruction: input.instruction } : {}) } } as const;
  }).immediate();
}
