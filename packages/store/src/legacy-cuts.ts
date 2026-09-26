import type { Episode } from "@kelvoy/engine";
import { getDb } from "./db";

/** Explicit migration of a reviewed legacy film to the one-second editor.
 * Existing clips are retained, but each shot must be confirmed again. */
export function convertLegacyCuts(input: { episode_id: string; owner_id: string; row_version: number }):
  { ok: true; row_version: number } |
  { ok: false; error: "not_found" | "version_conflict" | "illegal_transition";
    current_row_version?: number } {
  return getDb().transaction(() => {
    const row = getDb().query<{ doc: string; row_version: number }, [string, string]>(
      "select doc, row_version from episodes where episode_id = ? and owner_id = ?",
    ).get(input.episode_id, input.owner_id);
    if (!row) return { ok: false, error: "not_found" } as const;
    if (row.row_version !== input.row_version) return { ok: false,
      error: "version_conflict", current_row_version: row.row_version } as const;
    const episode = JSON.parse(row.doc) as Episode;
    if (episode.mode !== "per_shot" || episode.cut_policy === "fixed_1s" ||
        !["clip_review", "done"].includes(episode.status) || episode.shots.length === 0 ||
        episode.shots.some((shot) => !shot.clip)) {
      return { ok: false, error: "illegal_transition" } as const;
    }
    const updated: Episode = {
      ...episode, status: "clip_review", cut_policy: "fixed_1s",
      shots: episode.shots.map((shot) => ({ ...shot, duration_s: 1, trim_start_s: null,
        status: "clip_ready" as const })),
      render: { ...episode.render, subtitles_enabled: true, transitions_enabled: true },
    };
    getDb().query(`update episodes set doc = ?, row_version = row_version + 1,
      updated_at = datetime('now') where episode_id = ?`).run(JSON.stringify(updated), input.episode_id);
    return { ok: true, row_version: row.row_version + 1 } as const;
  }).immediate();
}
