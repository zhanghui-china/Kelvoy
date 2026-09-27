import type { Episode } from "@kelvoy/engine";
import { getDb } from "./db";

/** Worker filesystem sweeps only visit episode directories backed by this database. */
export function listArtifactEpisodeIds(): string[] {
  return getDb().query<{ episode_id: string }, []>("select episode_id from episodes").all()
    .map((row) => row.episode_id);
}

/** Conservative, exact key snapshot: old review history and retryable tasks are retained. */
export function getArtifactRetentionSnapshot(episodeId: string):
  { references: string[]; hasUnsettledTasks: boolean } | null {
  const database = getDb();
  return database.transaction(() => {
    const row = database.query<{ doc: string }, [string]>(
      "select doc from episodes where episode_id = ?",
    ).get(episodeId);
    if (!row) return null;
    const episode = JSON.parse(row.doc) as Partial<Episode>;
    const references = new Set<string>();
    for (const key of episode.grid_refs ?? []) references.add(key);
    for (const shot of [...(episode.shots ?? []), ...(episode.removed_shots ?? [])]) {
      for (const key of shot.candidates ?? []) references.add(key);
      if (shot.kf_selected) references.add(shot.kf_selected);
      if (shot.clip) references.add(shot.clip);
    }
    if (episode.final?.key) references.add(episode.final.key);
    else references.add(`final/${episodeId}.mp4`);
    const unsettled = database.query<{ task_id: string }, [string]>(
      `select task_id from tasks where episode_id = ?
       and status in ('pending', 'processing', 'held', 'failed') limit 1`,
    ).get(episodeId);
    return { references: [...references], hasUnsettledTasks: !!unsettled };
  })();
}
