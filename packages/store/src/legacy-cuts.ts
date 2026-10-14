import type { Episode } from "@kelvoy/engine";
import { getDb } from "./db";

export type UpgradeLongCutsResult =
  | { ok: true; row_version: number }
  | { ok: false; error: "not_found" | "version_conflict" | "illegal_transition" | "invalid_duration";
      current_row_version?: number }
  | { ok: false; error: "duration_infeasible"; shots: number; min_s: number; max_s: number };

/** Explicit migration of a reviewed legacy film (fixed_1s / beat_aligned) to long shots (3–6 s each).
 * Existing clips are retained, but each shot must be confirmed again and the old final stops being
 * delivered until recomposed (status leaves `done`). Pre-checks only the coarse feasibility 3n ≤ d ≤ 6n;
 * intro/outro lengths are only known at compose time, where `planLongCuts` is the exact gate. */
export function upgradeToLongCuts(input: { episode_id: string; owner_id: string; row_version: number;
  duration_s: number }): UpgradeLongCutsResult {
  if (!Number.isFinite(input.duration_s) || input.duration_s <= 0) return { ok: false, error: "invalid_duration" };
  return getDb().transaction((): UpgradeLongCutsResult => {
    const row = getDb().query<{ doc: string; row_version: number }, [string, string]>(
      "select doc, row_version from episodes where episode_id = ? and owner_id = ?",
    ).get(input.episode_id, input.owner_id);
    if (!row) return { ok: false, error: "not_found" };
    if (row.row_version !== input.row_version) return { ok: false,
      error: "version_conflict", current_row_version: row.row_version };
    const episode = JSON.parse(row.doc) as Episode;
    if (episode.mode !== "per_shot" || episode.cut_policy === "long_3_6" ||
        !["clip_review", "done"].includes(episode.status) || episode.shots.length === 0 ||
        episode.shots.some((shot) => !shot.clip)) {
      return { ok: false, error: "illegal_transition" };
    }
    const shots = episode.shots.length;
    if (input.duration_s < shots * 3 || input.duration_s > shots * 6) {
      return { ok: false, error: "duration_infeasible", shots, min_s: shots * 3, max_s: shots * 6 };
    }
    const updated: Episode = {
      ...episode, status: "clip_review", cut_policy: "long_3_6",
      brief: { ...episode.brief, duration_s: input.duration_s },
      // 4 s matches the storyboard editor's default suggestion for a new long shot.
      shots: episode.shots.map((shot) => ({ ...shot, duration_s: 4, trim_start_s: null,
        status: "clip_ready" as const })),
      render: { ...episode.render, transitions_enabled: false },
    };
    getDb().query(`update episodes set doc = ?, row_version = row_version + 1,
      updated_at = datetime('now') where episode_id = ?`).run(JSON.stringify(updated), input.episode_id);
    return { ok: true, row_version: row.row_version + 1 };
  }).immediate();
}
