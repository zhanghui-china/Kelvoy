/** Local HTTP + SQLite queue probe, not a browser render or GPU benchmark. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, createSession, createUser, getDb, open } from "../packages/store/src";
import webServer from "../apps/web/src/server/index";

const root = await mkdtemp(join(tmpdir(), "kelvoy-concurrency-"));
const dbPath = join(root, "kelvoy.db");
open(dbPath);
const user = await createUser({ username: "benchmark", password_hash: "unused" });
if (!user.ok) throw new Error("benchmark account creation failed");
const session = await createSession(user.user.user_id);
const cookie = `kelvoy_session=${session.session_id}`;
const insertEpisode = getDb().query(
  "insert into episodes (episode_id, owner_id, row_version, doc) values (?, ?, 1, ?)",
);
const insertTask = getDb().query(
  "insert into tasks (task_id, episode_id, stage, attempt, status, created_at) values (?, ?, 'brief', 1, 'pending', ?)",
);
const server = Bun.serve({ hostname: "127.0.0.1", port: 31000 + Math.floor(Math.random() * 10000),
  fetch: webServer.fetch });

function percentile(values: number[], pct: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * pct) - 1)]!.toFixed(2));
}

function makeEpisode(index: number) {
  return { episode_id: `e_${String(index).padStart(6, "0")}`, name: `Episode ${index}`,
    owner_id: user.ok ? user.user.user_id : "", status: "done", destination_id: "d", persona_id: "p",
    created_at: "2026-09-27T00:00:00Z", credits_used: 30, render: { title: "Benchmark" },
    shots: Array.from({ length: 30 }, (_, shot) => ({ no: shot + 1, status: "approved",
      kf_prompt: "landscape sample ".repeat(8), motion_prompt: "walking sample ".repeat(8),
      candidates: [`kf/${index}/${shot}.png`], model: { video: { provider: "local", model: "MiniMax-H3",
        version: "1", seed: shot, prompt: "benchmark", ref_hashes: ["hash"], attempts: 1,
        cost_usd: 0.1 } } })) };
}

try {
  let inserted = 0;
  for (const count of [10, 100, 1000]) {
    getDb().transaction(() => {
      for (let index = inserted; index < count; index++) {
        const doc = makeEpisode(index);
        insertEpisode.run(doc.episode_id, doc.owner_id, JSON.stringify(doc));
      }
    }).immediate();
    inserted = count;
    for (const browsers of [1, 5]) for (const workers of [1, 2]) {
      getDb().exec("delete from tasks");
      const created = new Date().toISOString();
      getDb().transaction(() => {
        for (let index = 0; index < 100; index++) {
          insertTask.run(`tk_${index}`, "e_000000", created);
        }
      }).immediate();
      const processes = Array.from({ length: workers }, () => Bun.spawn({
        cmd: [process.execPath, "scripts/benchmark-worker-probe.ts", dbPath],
        cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
      }));
      const latency: Record<string, number[]> = { overview: [], usage: [] };
      const bytes: Record<string, number> = { overview: 0, usage: 0 };
      await Promise.all(Array.from({ length: browsers }, async () => {
        for (let index = 0; index < 8; index++) {
          for (const kind of ["overview", "usage"] as const) {
            const started = performance.now();
            const response = await fetch(`http://127.0.0.1:${server.port}/api/episodes/${kind}`, { headers: { cookie } });
            const body = await response.arrayBuffer();
            if (!response.ok) throw new Error(`${kind} HTTP ${response.status}`);
            latency[kind]!.push(performance.now() - started);
            bytes[kind] = body.byteLength;
          }
        }
      }));
      const probes = [];
      for (const process of processes) {
        const [code, stdout, stderr] = await Promise.all([process.exited,
          new Response(process.stdout).text(), new Response(process.stderr).text()]);
        if (code !== 0) throw new Error(`queue probe failed: ${stderr}`);
        probes.push(JSON.parse(stdout) as { processed: number; dequeueMs: number[]; queueWaitMs: number[] });
      }
      const dequeueMs = probes.flatMap((probe) => probe.dequeueMs);
      const queueWaitMs = probes.flatMap((probe) => probe.queueWaitMs);
      console.log(JSON.stringify({ episodes: count, shots: count * 30, browsers, workers,
        overview: { p50_ms: percentile(latency.overview!, 0.5), p95_ms: percentile(latency.overview!, 0.95),
          bytes: bytes.overview },
        usage: { p50_ms: percentile(latency.usage!, 0.5), p95_ms: percentile(latency.usage!, 0.95),
          bytes: bytes.usage },
        queue: { processed: probes.reduce((sum, probe) => sum + probe.processed, 0),
          dequeue_p95_ms: percentile(dequeueMs, 0.95), wait_p95_ms: percentile(queueWaitMs, 0.95) },
        heap_bytes: process.memoryUsage().heapUsed }));
    }
  }
} finally {
  server.stop(true);
  close();
  await rm(root, { recursive: true, force: true });
}
