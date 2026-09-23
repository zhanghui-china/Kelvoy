import {
  type Episode,
  type EpisodePatch,
  type ShotPatch,
  isLegalEpisodeStatusChange,
  isLegalShotStatusChange,
} from "@kelvoy/engine";
import { getDb } from "./db";

/**
 * Episode storage (ADR-0004): the one place that owns SQLite access for
 * episodes. apps/web and apps/worker both call these functions directly —
 * no HTTP layer between them, since they share a machine for now. Kept
 * async so a future networked implementation (when providers/DGXs split
 * across machines) can replace the body without changing callers.
 */

interface EpisodeRow {
  doc: string;
  row_version: number;
}

export type GetEpisodeResult =
  | { ok: true; episode: Episode; row_version: number }
  | { ok: false; error: "not_found" };

export type PatchResult =
  | { ok: true; row_version: number }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "version_conflict"; current_row_version: number }
  | { ok: false; error: "illegal_transition" };

function readRow(episodeId: string): EpisodeRow | null {
  return getDb()
    .query<EpisodeRow, [string]>("select doc, row_version from episodes where episode_id = ?")
    .get(episodeId);
}

export async function insertEpisode(episode: Episode): Promise<void> {
  getDb()
    .query(
      "insert into episodes (episode_id, owner_id, row_version, doc) values (?, ?, 1, ?)",
    )
    .run(episode.episode_id, episode.owner_id, JSON.stringify(episode));
}

export async function getEpisode(episodeId: string): Promise<GetEpisodeResult> {
  const row = readRow(episodeId);
  if (!row) return { ok: false, error: "not_found" };
  return { ok: true, episode: JSON.parse(row.doc) as Episode, row_version: row.row_version };
}

export async function listEpisodes(ownerId: string): Promise<Episode[]> {
  const rows = getDb()
    .query<{ doc: string }, [string]>(
      "select doc from episodes where owner_id = ? order by episode_id",
    )
    .all(ownerId);
  return rows.map((row) => JSON.parse(row.doc) as Episode);
}

export async function patchEpisode(
  episodeId: string,
  clientRowVersion: number,
  patch: EpisodePatch,
): Promise<PatchResult> {
  const row = readRow(episodeId);
  if (!row) return { ok: false, error: "not_found" };

  if (row.row_version !== clientRowVersion) {
    return { ok: false, error: "version_conflict", current_row_version: row.row_version };
  }

  const episode = JSON.parse(row.doc) as Episode;
  if (patch.status && !isLegalEpisodeStatusChange(episode.status, patch.status)) {
    return { ok: false, error: "illegal_transition" };
  }

  const updated: Episode = { ...episode, ...patch };
  return commit(episodeId, clientRowVersion, updated, row.row_version);
}

export async function patchShot(
  episodeId: string,
  shotNo: number,
  clientRowVersion: number,
  patch: ShotPatch,
): Promise<PatchResult> {
  const row = readRow(episodeId);
  if (!row) return { ok: false, error: "not_found" };

  const episode = JSON.parse(row.doc) as Episode;
  const shotIndex = episode.shots.findIndex((s) => s.no === shotNo);
  if (shotIndex === -1) return { ok: false, error: "not_found" };

  if (row.row_version !== clientRowVersion) {
    return { ok: false, error: "version_conflict", current_row_version: row.row_version };
  }

  const shot = episode.shots[shotIndex];
  if (patch.status && !isLegalShotStatusChange(shot.status, patch.status)) {
    return { ok: false, error: "illegal_transition" };
  }

  const shots = [...episode.shots];
  shots[shotIndex] = { ...shot, ...patch };
  const updated: Episode = { ...episode, shots };
  return commit(episodeId, clientRowVersion, updated, row.row_version);
}

/**
 * Whole-document write-back for stage output (apps/worker, after
 * `runStage` returns a fully-updated Episode — a stage can touch far more
 * than PatchEpisode's narrow field set, e.g. the script stage rewrites
 * `scenes`/`shots` wholesale). Still status-transition-checked and
 * row_version-guarded, same as patchEpisode/patchShot.
 */
export async function replaceEpisode(
  episodeId: string,
  clientRowVersion: number,
  episode: Episode,
): Promise<PatchResult> {
  const row = readRow(episodeId);
  if (!row) return { ok: false, error: "not_found" };

  if (row.row_version !== clientRowVersion) {
    return { ok: false, error: "version_conflict", current_row_version: row.row_version };
  }

  const before = JSON.parse(row.doc) as Episode;
  if (episode.status !== before.status && !isLegalEpisodeStatusChange(before.status, episode.status)) {
    return { ok: false, error: "illegal_transition" };
  }

  return commit(episodeId, clientRowVersion, episode, row.row_version);
}

/**
 * The WHERE row_version = clientRowVersion clause is the real concurrency
 * guard — the earlier row.row_version comparison in the callers above is
 * only a fast path. If another write won the race between our read and
 * this write, this UPDATE affects 0 rows and we re-check for the true
 * current version. Verified under real concurrent writes (two callers
 * racing on the same clientRowVersion: exactly one succeeds).
 */
function commit(
  episodeId: string,
  clientRowVersion: number,
  updated: Episode,
  fallbackVersion: number,
): PatchResult {
  const result = getDb()
    .query<{ row_version: number }, [string, string, number]>(
      `update episodes
       set doc = ?, row_version = row_version + 1, updated_at = datetime('now')
       where episode_id = ? and row_version = ?
       returning row_version`,
    )
    .get(JSON.stringify(updated), episodeId, clientRowVersion);

  if (!result) {
    const fresh = readRow(episodeId);
    return {
      ok: false,
      error: "version_conflict",
      current_row_version: fresh?.row_version ?? fallbackVersion,
    };
  }
  return { ok: true, row_version: result.row_version };
}
