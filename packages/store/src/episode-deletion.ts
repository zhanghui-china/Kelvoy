import { tally, type Episode, type ProviderTally } from "@kelvoy/engine";
import { getDb } from "./db";
import { finalizeCredits } from "./credits";

export type DeletedEpisodeUsage = {
  episode_id: string; destination_name: string; persona_name: string; created_at: string;
  shot_count: number; credits_used: number; cost_usd: number; deleted: true;
  name: string; providers: ProviderTally[];
};

export function hasEpisodeDeletion(episodeId: string): boolean {
  return !!getDb().query("select 1 from episode_deletions where episode_id = ?").get(episodeId);
}

/** An expired writer may resume directory IO after a crash-recovery sweep. */
export function requestEpisodeDeletionCleanup(episodeId: string): void {
  getDb().query(`update episode_deletions set cleanup_status = 'pending', cleanup_retry_at = 0,
    cleanup_revision = cleanup_revision + 1 where episode_id = ?`).run(episodeId);
}

/** Logical deletion, cancellation and reservation refunds form one writer transaction. */
export async function deleteEpisode(episodeId: string, ownerId: string): Promise<
  { ok: true; cleanup_status: "pending" | "done"; refunded_credits: number } |
  { ok: false; error: "not_found" }
> {
  const db = getDb();
  return db.transaction(() => {
    const deleted = db.query<{ owner_id: string; cleanup_status: "pending" | "done" }, [string]>(
      "select owner_id, cleanup_status from episode_deletions where episode_id = ?",
    ).get(episodeId);
    if (deleted) return deleted.owner_id === ownerId
      ? { ok: true, cleanup_status: deleted.cleanup_status, refunded_credits: 0 } as const
      : { ok: false, error: "not_found" } as const;
    const row = db.query<{ doc: string }, [string, string]>(
      "select doc from episodes where episode_id = ? and owner_id = ?",
    ).get(episodeId, ownerId);
    if (!row) return { ok: false, error: "not_found" } as const;
    const episode = JSON.parse(row.doc) as Episode;
    const name = (table: "destinations" | "personas", key: "destination_id" | "persona_id", id: string) =>
      db.query<{ name: string }, [string]>(`select json_extract(doc, '$.name') as name from ${table} where ${key} = ?`).get(id)?.name ?? id;
    const providers = tally({ shots: episode.shots });
    const usage: DeletedEpisodeUsage = { episode_id: episodeId,
      name: `${episode.name ?? episode.render.title ?? episodeId}（已删除）`, deleted: true,
      destination_name: name("destinations", "destination_id", episode.destination_id),
      persona_name: name("personas", "persona_id", episode.persona_id), created_at: episode.created_at,
      shot_count: episode.shots.length, credits_used: episode.credits_used ?? 0,
      cost_usd: providers.reduce((sum, item) => sum + item.costUsd, 0), providers };
    // Capture pre-migration or externally seeded executions too. Normal dequeue already registers every token.
    db.query(`insert or ignore into task_executions (task_id, lease_token, episode_id, lease_until)
      select task_id, lease_token, episode_id, coalesce(lease_until, unixepoch('now') + 90)
      from tasks where episode_id = ? and status = 'processing' and lease_token is not null`).run(episodeId);
    db.query("insert into episode_deletions (episode_id, owner_id, usage_json) values (?, ?, ?)")
      .run(episodeId, ownerId, JSON.stringify(usage));
    const actions = db.query<{ action_id: string; price: number }, [string]>(
      "select action_id, price from credit_actions where episode_id = ? and status = 'reserved'",
    ).all(episodeId);
    for (const action of actions) finalizeCredits(action.action_id, "released");
    db.query(`update tasks set status = 'cancelled', lease_token = null, lease_until = null,
      updated_at = datetime('now') where episode_id = ? and status in ('held', 'pending', 'processing')`).run(episodeId);
    db.query("delete from episodes where episode_id = ?").run(episodeId);
    return { ok: true, cleanup_status: "pending", refunded_credits: actions.reduce((sum, action) => sum + action.price, 0) } as const;
  }).immediate();
}

/** Called only after the execution has stopped writing files (also safe before deletion). */
export async function acknowledgeDeletedTaskExecution(taskId: string, leaseToken: string): Promise<void> {
  // Once all writer IO has exited, the token has no further cleanup purpose.
  getDb().transaction(() => {
    getDb().query(`update episode_deletions set cleanup_status = 'pending', cleanup_retry_at = 0,
      cleanup_revision = cleanup_revision + 1
      where episode_id in (select episode_id from tasks where task_id = ?)`)
      .run(taskId);
    getDb().query("delete from task_executions where task_id = ? and lease_token = ?").run(taskId, leaseToken);
  }).immediate();
}

export async function listPendingEpisodeDeletions(limit = 20): Promise<{ episode_id: string; cleanup_attempts: number; cleanup_revision: number }[]> {
  return getDb().query<{ episode_id: string; cleanup_attempts: number; cleanup_revision: number }, [number]>(
    `select episode_id, cleanup_attempts, cleanup_revision from episode_deletions d
     where cleanup_status = 'pending' and cleanup_retry_at <= unixepoch('now')
       and not exists (select 1 from task_executions x where x.episode_id = d.episode_id
         and x.exited = 0 and x.lease_until > unixepoch('now'))
     order by deleted_at, episode_id limit ?`,
  ).all(Math.max(1, Math.min(limit, 100)));
}

export async function finishEpisodeDeletionCleanup(episodeId: string, cleanupRevision: number): Promise<boolean> {
  const db = getDb();
  return db.transaction(() => {
    const update = db.query(`update episode_deletions set cleanup_status = 'done', cleanup_last_error = null
      where episode_id = ? and cleanup_status = 'pending' and cleanup_revision = ?
      and not exists (select 1 from task_executions where episode_id = ? and exited = 0 and lease_until > unixepoch('now'))`)
      .run(episodeId, cleanupRevision, episodeId);
    if (!update.changes) return false;
    db.query(`update tasks set payload_json = null, result_json = null, error = null, instruction = null
      where episode_id = ?`).run(episodeId);
    db.query("delete from task_executions where episode_id = ?").run(episodeId);
    return true;
  }).immediate();
}

export async function failEpisodeDeletionCleanup(episodeId: string): Promise<void> {
  getDb().query(`update episode_deletions set cleanup_attempts = cleanup_attempts + 1,
    cleanup_last_error = 'filesystem_cleanup_failed',
    cleanup_retry_at = unixepoch('now') + min(3600, 5 * (1 << min(cleanup_attempts, 9)))
    where episode_id = ? and cleanup_status = 'pending'`).run(episodeId);
}
