import type { Episode, ShotModelRecord } from "./schema";

export interface ProviderTally {
  provider: string;
  model: string;
  shots: number;
  attempts: number;
  costUsd: number;
}

/** Shared cost projection for one episode and account-level reports. */
export function tally(episode: Pick<Episode, "shots">): ProviderTally[] {
  const rows = new Map<string, ProviderTally>();
  const records: ShotModelRecord[] = [];
  for (const shot of episode.shots) {
    if (shot.model.image) records.push(shot.model.image);
    if (shot.model.video) records.push(shot.model.video);
  }
  for (const record of records) {
    const key = `${record.provider}/${record.model}`;
    const row = rows.get(key) ?? {
      provider: record.provider, model: record.model,
      shots: 0, attempts: 0, costUsd: 0,
    };
    row.shots += 1;
    row.attempts += record.attempts;
    row.costUsd += record.cost_usd;
    rows.set(key, row);
  }
  return [...rows.values()];
}
