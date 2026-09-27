/** bun scripts/benchmark-task-queue.ts — isolated queue lookup baseline. */
import { close, getDb, open } from "../packages/store/src";

const sql = `select task_id from tasks
  where status = 'pending' or (status = 'processing' and
    (lease_until is null or lease_until <= unixepoch('now')))
  order by created_at asc limit 1`;
open(":memory:");
const db = getDb();
if (process.env.BENCH_TASK_INDEX === "0") {
  db.exec("drop index if exists idx_tasks_status_created_lease");
}
const insert = db.query(`insert into tasks (task_id, episode_id, stage, attempt, status, created_at)
  values (?, 'e_bench', 'video', 1, ?, ?)`);
try {
  for (const total of [1000, 10000, 100000]) {
    const prior = total === 1000 ? 0 : total === 10000 ? 1000 : 10000;
    db.transaction(() => {
      for (let i = prior; i < total; i++) {
        insert.run(`tk_${String(i).padStart(6, "0")}`, "done", "2026-09-01 00:00:00");
      }
    }).immediate();
    const pending = `tk_pending_${total}`;
    insert.run(pending, "pending", "2026-09-27 00:00:00");
    const statement = db.query<{ task_id: string }, []>(sql);
    const samples: number[] = [];
    for (let run = 0; run < 101; run++) {
      const start = performance.now();
      statement.get();
      if (run > 0) samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const plan = db.query<{ detail: string }, []>(`explain query plan ${sql}`)
      .all().map((row) => row.detail);
    console.log(JSON.stringify({ historical_tasks: total, median_ms: Number(samples[49]!.toFixed(3)),
      p95_ms: Number(samples[94]!.toFixed(3)), plan }));
    db.query("delete from tasks where task_id = ?").run(pending);
  }
} finally {
  close();
}
