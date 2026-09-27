/** Reproducible SQLite read baseline: bun scripts/benchmark-episode-list.ts */
import { close, getDb, listEpisodeOverviews, listEpisodes, open } from "../packages/store/src";

function episode(index: number) {
  return {
    episode_id: `e_${String(index).padStart(6, "0")}`, owner_id: "u_benchmark",
    name: `Benchmark ${index}`, status: "kf_review", candidate_count: 2,
    render: { title: "Benchmark" }, destination_id: "d", persona_id: "p",
    brief: { aspect: "9:16", requirements: "" },
    shots: Array.from({ length: 30 }, (_, shot) => ({
      no: shot + 1, status: "kf_ready", candidates: [`kf/${index}/${shot}.png`],
      kf_prompt: "landscape sample ".repeat(8), motion_prompt: "walking sample ".repeat(8),
    })),
  };
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
    const samples: number[] = [];
    let responseBytes = 0;
    for (let run = 0; run < 6; run++) {
      const before = performance.now();
      const rows = await listEpisodes("u_benchmark");
      const elapsed = performance.now() - before;
      if (run > 0) samples.push(elapsed);
      responseBytes = Buffer.byteLength(JSON.stringify({ ok: true, episodes: rows }));
    }
    samples.sort((a, b) => a - b);
    const overviewSamples: number[] = [];
    let overviewBytes = 0;
    for (let run = 0; run < 6; run++) {
      const before = performance.now();
      const rows = await listEpisodeOverviews("u_benchmark");
      const elapsed = performance.now() - before;
      if (run > 0) overviewSamples.push(elapsed);
      overviewBytes = Buffer.byteLength(JSON.stringify({ ok: true, episodes: rows }));
    }
    overviewSamples.sort((a, b) => a - b);
    const plan = getDb().query<{ detail: string }, [string]>(
      "explain query plan select doc from episodes where owner_id = ? order by episode_id",
    ).all("u_benchmark").map((row) => row.detail);
    console.log(JSON.stringify({ episodes: count, shots: count * 30,
      median_ms: Number(samples[2]!.toFixed(2)), response_bytes: responseBytes,
      overview_median_ms: Number(overviewSamples[2]!.toFixed(2)),
      overview_response_bytes: overviewBytes,
      heap_used_bytes: process.memoryUsage().heapUsed, query_plan: plan }));
  }
} finally {
  close();
}
