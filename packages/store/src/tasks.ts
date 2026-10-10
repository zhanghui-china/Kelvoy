import type { Episode, StageName, Task } from "@kelvoy/engine";
import { decodeEpisode } from "./episode-codec";
import { getDb } from "./db";

/**
 * Task queue (ADR-0004): a `tasks` table replaces Redis. dequeueTask's
 * UPDATE ... WHERE task_id = (SELECT ... LIMIT 1) RETURNING is the
 * concurrency guard — two callers racing dequeueTask() can't grab the same
 * row, same pattern as episodes.ts's optimistic-lock commit.
 */

interface TaskRow {
  task_id: string;
  episode_id: string;
  stage: StageName;
  shot_no: number | null;
  shot_id: string | null;
  payload_json: string | null;
  attempt: number;
  operation: "script_regenerate" | "script_optimize" | "shot_suggest" | null;
  instruction: string | null;
  generation_id: string | null;
  lease_token: string | null;
}

export const TASK_LEASE_SECONDS = 90;

export type RetryableFailure = {
  task_id: string; stage: StageName; shot_no: number | null; shot_id: string | null; generation_id: string | null;
};

/** The same eligibility rule powers the retry mutation and the detail summary. */
export function findRetryableFailedTask(episode: Episode): RetryableFailure | null {
  episode = { ...episode, shots: episode.shots.map((shot, i) => ({ ...shot, shot_id: shot.shot_id ?? `sh_${episode.episode_id}_active_${i}_${shot.no}` })) };
  const failures = getDb().query<RetryableFailure, [string]>(
    `select failed.task_id, failed.stage, failed.shot_no, failed.shot_id, failed.generation_id
     from tasks as failed where failed.episode_id = ?
       and failed.status = 'failed' and failed.operation is null
       and not exists (select 1 from tasks as active
         where active.episode_id = failed.episode_id and active.stage = failed.stage
           and ((failed.shot_id is not null and active.shot_id = failed.shot_id) or (failed.shot_id is null and active.shot_no is failed.shot_no))
           and active.status in ('pending', 'processing', 'held'))
     order by failed.updated_at desc, failed.rowid desc`,
  ).all(episode.episode_id);
  return failures.find((item) => {
    if (item.stage === "keyframe" || item.stage === "video") {
      const shot = episode.shots.find((candidate) => item.shot_id ? candidate.shot_id === item.shot_id : candidate.no === item.shot_no);
      return !!shot && (shot.status === "failed" ||
        (episode.status === "failed" && shot.status ===
          (item.stage === "keyframe" ? "generating_kf" : "generating_clip")));
    }
    return episode.status === "failed";
  }) ?? null;
}

export async function getLatestFailedTask(episode: Episode): Promise<Pick<RetryableFailure, "stage" | "shot_no"> | null> {
  episode = { ...episode, shots: episode.shots.map((shot, i) => ({ ...shot, shot_id: shot.shot_id ?? `sh_${episode.episode_id}_active_${i}_${shot.no}` })) };
  const failure = findRetryableFailedTask(episode);
  return failure ? { stage: failure.stage, shot_no: failure.shot_id ? episode.shots.find(s => s.shot_id === failure.shot_id)?.no ?? null : failure.shot_no } : null;
}

function toTask(row: TaskRow): Task {
  const task: Task = {
    task_id: row.task_id,
    episode_id: row.episode_id,
    stage: row.stage,
    attempt: row.attempt,
  };
  if (row.shot_no !== null) task.shot_no = row.shot_no;
  if (row.shot_id) task.shot_id = row.shot_id;
  if (row.payload_json) task.payload_json = row.payload_json;
  if (row.operation) task.operation = row.operation;
  if (row.instruction) task.instruction = row.instruction;
  if (row.generation_id) task.generation_id = row.generation_id;
  if (row.lease_token) task.lease_token = row.lease_token;
  return task;
}

export async function enqueueTask(input: {
  task_id?: string;
  episode_id: string;
  stage: StageName;
  shot_no?: number;
  shot_id?: string;
  payload_json?: string;
  operation?: "script_regenerate" | "script_optimize" | "shot_suggest";
  instruction?: string;
  generation_id?: string;
}): Promise<Task> {
  const taskId = input.task_id ?? `tk_${crypto.randomUUID()}`;
  const episode = getDb().query<{doc:string},[string]>("select doc from episodes where episode_id = ?").get(input.episode_id);
  const shotId = input.shot_id ?? (episode ? decodeEpisode(episode.doc).shots.find(s => s.no === input.shot_no)?.shot_id : undefined);
  getDb()
    .query(
      "insert into tasks (task_id, episode_id, stage, shot_no, shot_id, operation, instruction, generation_id, payload_json, attempt, status) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending')",
    )
    .run(taskId, input.episode_id, input.stage, input.shot_no ?? null, shotId ?? null, input.operation ?? null, input.instruction ?? null, input.generation_id ?? null, input.payload_json ?? null);
  return { task_id: taskId, episode_id: input.episode_id, stage: input.stage, attempt: 1,
    ...(input.shot_no !== undefined ? { shot_no: input.shot_no } : {}),
    ...(shotId ? { shot_id: shotId } : {}),
    ...(input.payload_json ? { payload_json: input.payload_json } : {}),
    ...(input.operation ? { operation: input.operation } : {}),
    ...(input.instruction ? { instruction: input.instruction } : {}),
    ...(input.generation_id ? { generation_id: input.generation_id } : {}) };
}

export async function dequeueTask(): Promise<Task | null> {
  const leaseUntil = Math.floor(Date.now() / 1000) + TASK_LEASE_SECONDS;
  const leaseToken = `lease_${crypto.randomUUID()}`;
  const row = getDb()
    .query<TaskRow, [number, string]>(
      `update tasks
       set status = 'processing',
           attempt = attempt + case when status = 'processing' then 1 else 0 end,
           lease_until = ?, lease_token = ?, updated_at = datetime('now')
       where task_id = (
         select task_id from tasks
         where status = 'pending' or (status = 'processing' and (lease_until is null or lease_until <= unixepoch('now')))
         order by created_at asc limit 1
       )
       returning task_id, episode_id, stage, shot_no, shot_id, attempt, operation, instruction, generation_id, lease_token, payload_json`,
    )
    .get(leaseUntil, leaseToken);
  return row ? toTask(row) : null;
}

export async function renewTaskLease(taskId: string, leaseToken: string): Promise<boolean> {
  const result = getDb().query(
    `update tasks set lease_until = ?, updated_at = datetime('now')
     where task_id = ? and lease_token = ? and status = 'processing'
       and lease_until > unixepoch('now')`,
  ).run(Math.floor(Date.now() / 1000) + TASK_LEASE_SECONDS, taskId, leaseToken);
  return result.changes === 1;
}

export function hasActiveStageTasks(episodeId: string, stage: StageName): boolean {
  const row = getDb().query<{ count: number }, [string, string]>(
    `select count(*) as count from tasks where episode_id = ? and stage = ?
     and status in ('pending', 'processing', 'held')`,
  ).get(episodeId, stage);
  return (row?.count ?? 0) > 0;
}

export async function completeTask(taskId: string, leaseToken?: string): Promise<void> {
  getDb()
    .query(`update tasks set status = 'done', error = null, lease_until = null, lease_token = null,
      updated_at = datetime('now') where task_id = ? and (? is null or lease_token = ?)`)
    .run(taskId, leaseToken ?? null, leaseToken ?? null);
}

/**
 * `requeue: true` bumps attempt and puts the task back to 'pending' (local
 * retry, FR-04); `requeue: false` marks it terminally 'failed' — the
 * caller (worker) decides which based on its own retry/overflow policy,
 * this module has no opinion on retry counts.
 */
export async function failTask(taskId: string, options: { requeue: boolean; leaseToken?: string }): Promise<void> {
  if (options.requeue) {
    getDb()
      .query(
        `update tasks set status = 'pending', attempt = attempt + 1, lease_until = null,
         lease_token = null, updated_at = datetime('now')
         where task_id = ? and (? is null or lease_token = ?)`,
      )
      .run(taskId, options.leaseToken ?? null, options.leaseToken ?? null);
  } else {
    getDb()
      .query(`update tasks set status = 'failed', lease_until = null, lease_token = null,
        updated_at = datetime('now') where task_id = ? and (? is null or lease_token = ?)`)
      .run(taskId, options.leaseToken ?? null, options.leaseToken ?? null);
  }
}
