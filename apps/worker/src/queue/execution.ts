import type { Task } from "@kelvoy/engine";
import { acknowledgeDeletedTaskExecution, isTaskLeaseActive, renewTaskLease } from "@kelvoy/store";

/** The acknowledgement follows the handler's finally blocks, including all file IO. */
export async function executeLeasedTask(task: Task, handler: (signal: AbortSignal) => Promise<void>,
  shutdown?: AbortSignal): Promise<void> {
  const execution = new AbortController();
  const abort = () => execution.abort();
  shutdown?.addEventListener("abort", abort, { once: true });
  if (shutdown?.aborted) abort();
  let checking = false;
  const check = async (renew: boolean) => {
    if (!task.lease_token || checking || execution.signal.aborted) return;
    checking = true;
    try {
      const active = renew
        ? await renewTaskLease(task.task_id, task.lease_token)
        : await isTaskLeaseActive(task.task_id, task.lease_token);
      if (!active) abort();
    } catch { abort(); }
    finally { checking = false; }
  };
  const cancellation = setInterval(() => { void check(false); }, 1000);
  const heartbeat = setInterval(() => { void check(true); }, 30_000);
  try {
    await check(false);
    if (!execution.signal.aborted) await handler(execution.signal);
  } finally {
    clearInterval(cancellation);
    clearInterval(heartbeat);
    shutdown?.removeEventListener("abort", abort);
    if (task.lease_token) await acknowledgeDeletedTaskExecution(task.task_id, task.lease_token);
  }
}
