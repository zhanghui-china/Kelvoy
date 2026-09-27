/** Compare the old full-episode usage read with the aggregate projection. */
import { close, getDb, getUsageSummary, listEpisodes, open } from "../packages/store/src";

function episode(index: number) {
  return {
    episode_id: `e_${String(index).padStart(6, "0")}`, owner_id: "u_benchmark",
    destination_id: "d", persona_id: "p", created_at: "2026-09-27T00:00:00Z",
    credits_used: 30, status: "done", name: `Benchmark ${index}`,
    brief: { aspect: "9:16" }, render: { title: "Benchmark" },
    shots: Array.from({ length: 30 }, (_, shot) => ({
      no: shot + 1, kf_prompt: "landscape sample ".repeat(8),
      motion_prompt: "walking sample ".repeat(8),
      candidates: [`kf/${index}/${shot}.png`], model: {
        video: { provider: "local", model: "MiniMax-H3", version: "1", seed: shot,
          prompt: "private inference prompt", ref_hashes: ["hash"], attempts: 1, cost_usd: 0.1 },
      },
    })),
  };
}

async function measure(read: () => Promise<unknown>): Promise<{ median_ms: number; response_bytes: number }> {
  const samples: number[] = [];
  let responseBytes = 0;
  for (let run = 0; run < 6; run++) {
    const before = performance.now();
    const value = await read();
    const elapsed = performance.now() - before;
    if (run > 0) samples.push(elapsed);
    responseBytes = Buffer.byteLength(JSON.stringify(value));
  }
  samples.sort((a, b) => a - b);
  return { median_ms: Number(samples[2]!.toFixed(2)), response_bytes: responseBytes };
}

open(":memory:");
const insert = getDb().query("insert into episodes (episode_id, owner_id, row_version, doc) values (?, ?, 1, ?)");
try {
  for (const count of [10, 100, 1000]) {
    const start = count === 10 ? 0 : count === 100 ? 10 : 100;
    getDb().transaction(() => {
      for (let index = start; index < count; index++) {
        const doc = episode(index);
        insert.run(doc.episode_id, doc.owner_id, JSON.stringify(doc));
      }
    }).immediate();
    const old = await measure(() => listEpisodes("u_benchmark"));
    const usage = await measure(() => getUsageSummary("u_benchmark"));
    console.log(JSON.stringify({ episodes: count, shots: count * 30, old, usage }));
  }
} finally {
  close();
}
