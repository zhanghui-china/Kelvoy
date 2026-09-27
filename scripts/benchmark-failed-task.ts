/** Compare the prior N+1 failed-task lookup with the single-query form. */
import { close, findRetryableFailedTask, getDb, open } from "../packages/store/src";
import type { Episode } from "@kelvoy/engine";

open(":memory:");
const db = getDb();
const episode = { episode_id: "e_bench", status: "failed",
  shots: [{ no: 1, status: "failed" }] } as Episode;
const insert = db.query(`insert into tasks (task_id, episode_id, stage, shot_no, status,
  updated_at) values (?, 'e_bench', 'video', 1, ?, ?)`);
insert.run("tk_active", "pending", "2026-09-27 00:00:00");
const oldFailures = db.query<{ task_id: string; stage: string; shot_no: number | null }, [string]>(
  `select task_id, stage, shot_no from tasks where episode_id = ? and status = 'failed'
   and operation is null order by updated_at desc, rowid desc`);
const oldActive = db.query<{ count: number }, [string, string, number | null]>(
  `select count(*) as count from tasks where episode_id = ? and stage = ?
   and shot_no is ? and status in ('pending', 'processing', 'held')`);
function oldLookup(): void {
  for (const task of oldFailures.all("e_bench")) {
    if ((oldActive.get("e_bench", task.stage, task.shot_no)?.count ?? 0) === 0) return;
  }
}
function measure(run: () => void): { median_ms: number; p95_ms: number } {
  const samples: number[] = [];
  for (let i = 0; i < 101; i++) {
    const start = performance.now();
    run();
    if (i > 0) samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { median_ms: Number(samples[49]!.toFixed(3)),
    p95_ms: Number(samples[94]!.toFixed(3)) };
}
try {
  for (const total of [100, 1000, 10000]) {
    db.transaction(() => {
      const current = db.query<{ count: number }, []>(
        "select count(*) as count from tasks where status = 'failed'").get()?.count ?? 0;
      for (let i = current; i < total; i++) {
        insert.run(`tk_failed_${i}`, "failed", "2026-09-27 00:00:00");
      }
    }).immediate();
    const before = measure(oldLookup);
    const after = measure(() => { findRetryableFailedTask(episode); });
    console.log(JSON.stringify({ failed_tasks: total, before, after }));
  }
} finally {
  close();
}
