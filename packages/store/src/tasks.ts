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
}

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
  return task;
}

export async function enqueueTask(input: {
  episode_id: string;
  stage: StageName;
  shot_no?: number;
  operation?: "script_regenerate" | "script_optimize";
  instruction?: string;
}): Promise<Task> {
  const taskId = `tk_${crypto.randomUUID()}`;
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
  const row = getDb()
    .query<TaskRow, []>(
      `update tasks
       set status = 'processing', updated_at = datetime('now')
       where task_id = (
         select task_id from tasks where status = 'pending' order by created_at asc limit 1
       )
       returning task_id, episode_id, stage, shot_no, attempt, operation, instruction`,
    )
    .get();
  return row ? toTask(row) : null;
}

export async function completeTask(taskId: string): Promise<void> {
  getDb()
    .query("update tasks set status = 'done', updated_at = datetime('now') where task_id = ?")
    .run(taskId);
}

/**
 * `requeue: true` bumps attempt and puts the task back to 'pending' (local
 * retry, FR-04); `requeue: false` marks it terminally 'failed' — the
 * caller (worker) decides which based on its own retry/overflow policy,
 * this module has no opinion on retry counts.
 */
export async function failTask(taskId: string, options: { requeue: boolean }): Promise<void> {
  if (options.requeue) {
    getDb()
      .query(
        "update tasks set status = 'pending', attempt = attempt + 1, updated_at = datetime('now') where task_id = ?",
      )
      .run(taskId);
  } else {
    getDb()
      .query("update tasks set status = 'failed', updated_at = datetime('now') where task_id = ?")
      .run(taskId);
  }
}
