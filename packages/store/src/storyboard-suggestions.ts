import { storyboardEditable, validateSuggestionInput, type ShotDraft, type SuggestionInput, type Task } from "@kelvoy/engine";
import { getDb } from "./db";
import { decodeEpisode } from "./episode-codec";
import { reserveCredits, finalizeCredits, getCreditAction } from "./credits";
import { storyboardBusy } from "./storyboard";

/** Owner, version, editing lock, validation and charge reservation are one transaction. */
export function submitStoryboardSuggestion(input: {
  episode_id: string; owner_id: string; row_version: number; request: unknown;
}) {
  const db = getDb();
  return db.transaction(() => {
    const row = db.query<{ doc: string; row_version: number }, [string, string]>(
      "select doc, row_version from episodes where episode_id = ? and owner_id = ?",
    ).get(input.episode_id, input.owner_id);
    if (!row) return { ok: false, error: "not_found" } as const;
    if (row.row_version !== input.row_version) return { ok: false, error: "version_conflict", current_row_version: row.row_version } as const;
    const episode = decodeEpisode(row.doc);
    if (!storyboardEditable(episode)) return { ok: false, error: "illegal_transition" } as const;
    if (storyboardBusy(input.episode_id)) return { ok: false, error: "action_pending" } as const;
    const destination = db.query<{ doc: string }, [string, number]>(
      "select doc from destination_versions where destination_id = ? and version = ?",
    ).get(episode.destination_id, episode.destination_version);
    if (!destination) return { ok: false, error: "not_found" } as const;
    let request: SuggestionInput;
    try { request = validateSuggestionInput(input.request, episode, JSON.parse(destination.doc)); }
    catch { return { ok: false, error: "invalid_suggestion", message: "请检查镜头描述、场景及地标，内容需符合创作规范。" } as const; }
    const taskId = `tk_${crypto.randomUUID()}`;
    const reservation = reserveCredits({ action_id: taskId, user_id: input.owner_id,
      episode_id: input.episode_id, task_id: taskId, kind: "script", units: 1 });
    if (!reservation.ok) return { ok: false, error: "insufficient_credits" } as const;
    db.query(`insert into tasks (task_id, episode_id, stage, operation, payload_json, attempt, status)
      values (?, ?, 'script', 'shot_suggest', ?, 1, 'pending')`)
      .run(taskId, input.episode_id, JSON.stringify(request));
    db.query("update episodes set row_version = row_version + 1, updated_at = datetime('now') where episode_id = ?")
      .run(input.episode_id);
    return { ok: true, task_id: taskId, row_version: row.row_version + 1 } as const;
  }).immediate();
}

export function getStoryboardSuggestion(episodeId: string, ownerId: string, taskId: string) {
  const row = getDb().query<{ status: "pending" | "processing" | "done" | "failed"; result_json: string | null; error: string | null }, [string, string, string]>(
    `select tasks.status, tasks.result_json, tasks.error from tasks join episodes using (episode_id)
     where tasks.task_id = ? and tasks.episode_id = ? and episodes.owner_id = ? and operation = 'shot_suggest'`,
  ).get(taskId, episodeId, ownerId);
  if (!row) return null;
  return { ok: true, status: row.status, ...(row.result_json ? { suggestion: JSON.parse(row.result_json) as Partial<ShotDraft> } : {}),
    ...(row.status === "failed" ? { error: row.error ?? "镜头建议生成失败，积分已退回，请重试。" } : {}) } as const;
}

/** Late workers cannot write result or settle a second time. Never changes formal shots/status. */
export function completeStoryboardSuggestion(task: Task, suggestion: Partial<ShotDraft>): boolean {
  const db = getDb();
  return db.transaction(() => {
    const lease = db.query<{ task_id: string }, [string, string]>(
      `select task_id from tasks where task_id = ? and status = 'processing' and operation = 'shot_suggest'
       and lease_token = ? and lease_until > unixepoch('now')`,
    ).get(task.task_id, task.lease_token ?? "");
    if (!lease) return false;
    const row = db.query<{ doc: string }, [string]>("select doc from episodes where episode_id = ?").get(task.episode_id);
    if (!row) return false;
    const episode = decodeEpisode(row.doc);
    const action = getCreditAction(task.task_id);
    const charged = action?.status === "reserved" ? action.price : 0;
    finalizeCredits(task.task_id, "settled");
    db.query(`update episodes set doc = ?, row_version = row_version + 1, updated_at = datetime('now') where episode_id = ?`)
      .run(JSON.stringify({ ...episode, credits_used: episode.credits_used + charged }), task.episode_id);
    db.query(`update tasks set status = 'done', result_json = ?, error = null, lease_token = null,
      lease_until = null, updated_at = datetime('now') where task_id = ?`).run(JSON.stringify(suggestion), task.task_id);
    return true;
  }).immediate();
}
