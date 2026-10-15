import { transitionEpisode } from "@kelvoy/engine";
import { getDb } from "./db";
import { decodeEpisode } from "./episode-codec";
import { storyboardBusy } from "./storyboard";

export type ReopenTarget = "compose_ready" | "clip_review";

/**
 * Steps a finished/ready episode back to the stage that owns the edit controls.
 * Status only: shots, final video and credits stay untouched, so approved
 * shots are never re-run by merely reopening a stage.
 */
export function reopenEpisodeStage(input: { episode_id: string; owner_id: string; row_version: number; into: ReopenTarget }):
  { ok: true; row_version: number } |
  { ok: false; error: "not_found" | "version_conflict" | "illegal_transition"; current_row_version?: number } {
  const db = getDb();
  return db.transaction(() => {
    const row = db.query<{ doc: string; row_version: number }, [string, string]>(
      "select doc, row_version from episodes where episode_id = ? and owner_id = ?",
    ).get(input.episode_id, input.owner_id);
    if (!row) return { ok: false, error: "not_found" } as const;
    if (row.row_version !== input.row_version) return { ok: false, error: "version_conflict",
      current_row_version: row.row_version } as const;
    const episode = decodeEpisode(row.doc);
    if (episode.mode === "grid" || episode.script_pending_task_id || storyboardBusy(input.episode_id)) {
      return { ok: false, error: "illegal_transition" } as const;
    }
    let status;
    try { status = transitionEpisode(episode.status, { type: "reopen_stage", into: input.into }); }
    catch { return { ok: false, error: "illegal_transition" } as const; }
    db.query("update episodes set doc = ?, row_version = row_version + 1, updated_at = datetime('now') where episode_id = ?")
      .run(JSON.stringify({ ...episode, status }), input.episode_id);
    return { ok: true, row_version: row.row_version + 1 } as const;
  }).immediate();
}
