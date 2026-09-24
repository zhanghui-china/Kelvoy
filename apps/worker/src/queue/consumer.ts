import { type Task, runStage } from "@kelvoy/engine";
import { completeTask, dequeueTask, failTask, getDestination, getEpisode, replaceEpisode } from "@kelvoy/store";

/**
 * Task queue consumer (ADR-0004): polls the local `tasks` table (no Redis,
 * no HTTP — worker and web share a machine and both call @kelvoy/store
 * directly). Dispatches to @kelvoy/engine's runStage and writes the result
 * back with optimistic-lock protection via replaceEpisode.
 */

const POLL_INTERVAL_MS = 1000;
// FR-04: local retry <=2 times before the caller (services/inference
// providers, not this loop) is expected to overflow to a domestic API.
// This loop only tracks whether to requeue; overflow policy lives in
// packages/engine/src/providers/overflow.ts.
const MAX_LOCAL_ATTEMPTS = 2;

export async function consumeLoop(signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted) {
    const task = await dequeueTask();
    if (!task) {
      await Bun.sleep(POLL_INTERVAL_MS);
      continue;
    }
    await handleTask(task);
  }
}

export async function handleTask(task: Task): Promise<void> {
  const result = await getEpisode(task.episode_id);
  if (!result.ok) {
    // Episode vanished (shouldn't happen under normal operation) — no
    // point retrying, and nowhere to write a failure status either.
    await failTask(task.task_id, { requeue: false });
    return;
  }

  try {
    // Engine stages don't touch @kelvoy/store — "script" needs the
    // destination record, fetched here and threaded through as context.
    const destination = await getDestination(result.episode.destination_id);
    const updated = await runStage(
      task.stage,
      result.episode,
      task.shot_no,
      destination ? { destination } : undefined,
    );
    const written = await replaceEpisode(task.episode_id, result.row_version, updated);
    if (!written.ok) {
      // Lost a write race or the transition became illegal between our
      // read and write — requeue so the next attempt re-reads fresh state,
      // same MAX_LOCAL_ATTEMPTS budget as a stage failure.
      await failTask(task.task_id, { requeue: task.attempt < MAX_LOCAL_ATTEMPTS });
      return;
    }
    await completeTask(task.task_id);
  } catch {
    await failTask(task.task_id, { requeue: task.attempt < MAX_LOCAL_ATTEMPTS });
  }
}
