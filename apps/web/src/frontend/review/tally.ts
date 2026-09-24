import type { Episode, ShotModelRecord } from "@kelvoy/engine";

export interface ProviderTally {
  provider: string;
  model: string;
  shots: number;
  attempts: number;
  costUsd: number;
}

/**
 * 成本报告按 provider+model 汇总每镜的 model.image / model.video 记录
 * （§6 的可复现记录里就有 attempts 和 cost_usd，不用另存一份账）。
 *
 * 从 DoneView.tsx 抽出来（M2-16, #44）：单期成本报告（DoneView）和账号级
 * 跨期用量页（UsagePage，对每期跑一遍后再按 provider/model 合并）共用同一
 * 份口径，不能各写一份容易走样的聚合逻辑。
 */
export function tally(episode: Episode): ProviderTally[] {
  const rows = new Map<string, ProviderTally>();
  const records: ShotModelRecord[] = [];
  for (const shot of episode.shots) {
    if (shot.model.image) records.push(shot.model.image);
    if (shot.model.video) records.push(shot.model.video);
  }
  for (const record of records) {
    const key = `${record.provider}/${record.model}`;
    const row = rows.get(key) ?? {
      provider: record.provider,
      model: record.model,
      shots: 0,
      attempts: 0,
      costUsd: 0,
    };
    row.shots += 1;
    row.attempts += record.attempts;
    row.costUsd += record.cost_usd;
    rows.set(key, row);
  }
  return [...rows.values()];
}
