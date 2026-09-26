import type { StageName, Task } from "@kelvoy/engine";
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
  attempt: number;
  operation: "script_regenerate" | "script_optimize" | null;
  instruction: string | null;
  lease_token: string | null;
}

export const TASK_LEASE_SECONDS = 90;

function toTask(row: TaskRow): Task {
  const task: Task = {
    task_id: row.task_id,
    episode_id: row.episode_id,
    stage: row.stage,
    attempt: row.attempt,
  };
  if (row.shot_no !== null) task.shot_no = row.shot_no;
  if (row.operation) task.operation = row.operation;
  if (row.instruction) task.instruction = row.instruction;
  if (row.lease_token) task.lease_token = row.lease_token;
  return task;
}

export async function enqueueTask(input: {
  task_id?: string;
  episode_id: string;
  stage: StageName;
  shot_no?: number;
  operation?: "script_regenerate" | "script_optimize";
  instruction?: string;
}): Promise<Task> {
  const taskId = input.task_id ?? `tk_${crypto.randomUUID()}`;
  getDb()
    .query(
      "insert into tasks (task_id, episode_id, stage, shot_no, operation, instruction, attempt, status) values (?, ?, ?, ?, ?, ?, 1, 'pending')",
    )
    .run(taskId, input.episode_id, input.stage, input.shot_no ?? null, input.operation ?? null, input.instruction ?? null);
  return { task_id: taskId, episode_id: input.episode_id, stage: input.stage, attempt: 1,
    ...(input.shot_no !== undefined ? { shot_no: input.shot_no } : {}),
    ...(input.operation ? { operation: input.operation } : {}),
    ...(input.instruction ? { instruction: input.instruction } : {}) };
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
       returning task_id, episode_id, stage, shot_no, attempt, operation, instruction, lease_token`,
    )
    .get(leaseUntil, leaseToken);
  return row ? toTask(row) : null;
}

export async function renewTaskLease(taskId: string, leaseToken: string): Promise<boolean> {
  const result = getDb().query(
    `update tasks set lease_until = ?, updated_at = datetime('now')
     where task_id = ? and lease_token = ? and status = 'processing'`,
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
    .query(`update tasks set status = 'done', lease_until = null, lease_token = null,
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
