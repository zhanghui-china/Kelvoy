/** SQLite queue contention probe used by benchmark-concurrency.ts; no model calls. */
import { close, dequeueTask, getDb, open } from "../packages/store/src";

const path = process.argv[2];
if (!path) throw new Error("database path required");
open(path);
const dequeueMs: number[] = [];
const queueWaitMs: number[] = [];
let processed = 0;
try {
  while (true) {
    const started = performance.now();
    const task = await dequeueTask();
    if (!task) {
      const remaining = getDb().query<{ count: number }, []>(
        "select count(*) as count from tasks where status in ('pending', 'processing')",
      ).get()?.count ?? 0;
      if (remaining === 0) break;
      await Bun.sleep(2);
      continue;
    }
    dequeueMs.push(performance.now() - started);
    const row = getDb().query<{ created_at: string }, [string]>(
      "select created_at from tasks where task_id = ?",
    ).get(task.task_id);
    if (row) queueWaitMs.push(Date.now() - Date.parse(row.created_at));
    getDb().query(`update tasks set status = 'done', lease_token = null, lease_until = null
      where task_id = ? and lease_token = ?`).run(task.task_id, task.lease_token ?? "");
    processed++;
    await Bun.sleep(3);
  }
  console.log(JSON.stringify({ processed, dequeueMs, queueWaitMs }));
} finally {
  close();
}
