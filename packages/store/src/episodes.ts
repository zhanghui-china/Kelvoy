import {
  type Episode,
  type EpisodePatch,
  type ShotPatch,
  type ProviderTally,
  isLegalEpisodeStatusChange,
  isLegalShotStatusChange,
  tally,
} from "@kelvoy/engine";
import { getDb } from "./db";
import { decodeEpisode } from "./episode-codec";
import { hasEpisodeDeletion, type DeletedEpisodeUsage } from "./episode-deletion";

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
  if (hasEpisodeDeletion(episode.episode_id)) throw new Error("episode deleted");
  getDb()
    .query(
      "insert into episodes (episode_id, owner_id, row_version, doc) values (?, ?, 1, ?)",
    )
    .run(episode.episode_id, episode.owner_id, JSON.stringify(episode));
}

export async function getEpisode(episodeId: string): Promise<GetEpisodeResult> {
  const row = readRow(episodeId);
  if (!row) return { ok: false, error: "not_found" };
  return { ok: true, episode: decodeEpisode(row.doc), row_version: row.row_version };
}

export async function listEpisodes(ownerId: string): Promise<Episode[]> {
  const rows = getDb()
    .query<{ doc: string }, [string]>(
      "select doc from episodes where owner_id = ? order by episode_id",
    )
    .all(ownerId);
  return rows.map((row) => decodeEpisode(row.doc));
}

/** Account usage projection: only aggregate costs and table fields leave the server. */
export async function getUsageSummary(ownerId: string): Promise<{
  periods: { episode_id: string; destination_name: string; persona_name: string;
    name?: string; deleted?: boolean;
    created_at: string; shot_count: number; credits_used: number; cost_usd: number }[];
  providers: ProviderTally[];
  totals: { episodes: number; credits_used: number; cost_usd: number };
}> {
  const rows = getDb().query<{
    episode_id: string; destination_name: string | null; persona_name: string | null;
    destination_id: string; persona_id: string; created_at: string;
    credits_used: number | null; shots: string | null;
  }, [string]>(`select e.episode_id,
    json_extract(e.doc, '$.destination_id') as destination_id,
    json_extract(e.doc, '$.persona_id') as persona_id,
    json_extract(d.doc, '$.name') as destination_name,
    json_extract(p.doc, '$.name') as persona_name,
    json_extract(e.doc, '$.created_at') as created_at,
    json_extract(e.doc, '$.credits_used') as credits_used,
    json_extract(e.doc, '$.shots') as shots
    from episodes e
    left join destinations d on d.destination_id = json_extract(e.doc, '$.destination_id')
    left join personas p on p.persona_id = json_extract(e.doc, '$.persona_id')
    where e.owner_id = ? order by created_at desc, e.episode_id desc`).all(ownerId);
  const providers = new Map<string, ProviderTally>();
  let credits = 0;
  let cost = 0;
  const periods = rows.map((row) => {
    const shots = JSON.parse(row.shots ?? "[]") as Episode["shots"];
    const cost_usd = tally({ shots }).reduce((sum, item) => {
      const key = `${item.provider}/${item.model}`;
      const current = providers.get(key) ?? { provider: item.provider, model: item.model,
        shots: 0, attempts: 0, costUsd: 0 };
      current.shots += item.shots;
      current.attempts += item.attempts;
      current.costUsd += item.costUsd;
      providers.set(key, current);
      return sum + item.costUsd;
    }, 0);
    credits += row.credits_used ?? 0;
    cost += cost_usd;
    return { episode_id: row.episode_id,
      destination_name: row.destination_name ?? row.destination_id,
      persona_name: row.persona_name ?? row.persona_id,
      created_at: row.created_at, shot_count: shots.length,
      credits_used: row.credits_used ?? 0, cost_usd };
  });
  const deleted = getDb().query<{ usage_json: string }, [string]>("select usage_json from episode_deletions where owner_id = ?").all(ownerId);
  for (const row of deleted) {
    const { providers: history, ...period } = JSON.parse(row.usage_json) as DeletedEpisodeUsage;
    periods.push(period);
    credits += period.credits_used;
    cost += period.cost_usd;
    for (const item of history) {
      const key = `${item.provider}/${item.model}`;
      const current = providers.get(key) ?? { provider: item.provider, model: item.model, shots: 0, attempts: 0, costUsd: 0 };
      current.shots += item.shots; current.attempts += item.attempts; current.costUsd += item.costUsd;
      providers.set(key, current);
    }
  }
  periods.sort((a,b) => b.created_at.localeCompare(a.created_at) || b.episode_id.localeCompare(a.episode_id));
  return { periods, providers: [...providers.values()].sort((a, b) => b.costUsd - a.costUsd),
    totals: { episodes: periods.length, credits_used: credits, cost_usd: cost } };
}

/** Small list projection: no prompts, candidate paths, or model provenance leave the DB. */
export async function listEpisodeOverviews(ownerId: string): Promise<{
  episode_id: string; name: string; status: Episode["status"]; persona_id: string;
  destination_id: string; created_at: string; credits_used: number; season: string;
  render: { title: string }; shot_count: number; approved_shot_count: number;
  any_shot_started: boolean; all_keyframes_selected: boolean; all_shots_approved: boolean;
}[]> {
  const rows = getDb().query<{
    episode_id: string; name: string | null; status: Episode["status"];
    persona_id: string; destination_id: string; created_at: string;
    credits_used: number | null; title: string | null; season: string | null; shots: string;
  }, [string]>(`select episode_id,
    json_extract(doc, '$.name') as name,
    json_extract(doc, '$.status') as status,
    json_extract(doc, '$.persona_id') as persona_id,
    json_extract(doc, '$.destination_id') as destination_id,
    json_extract(doc, '$.created_at') as created_at,
    json_extract(doc, '$.credits_used') as credits_used,
    json_extract(doc, '$.render.title') as title,
    json_extract(doc, '$.brief.season') as season,
    json_extract(doc, '$.shots') as shots
    from episodes where owner_id = ? order by episode_id`).all(ownerId);
  return rows.map((row) => {
    const shots = JSON.parse(row.shots ?? "[]") as Episode["shots"];
    return {
      episode_id: row.episode_id, name: row.name ?? row.title ?? row.destination_id,
      status: row.status, persona_id: row.persona_id, destination_id: row.destination_id,
      created_at: row.created_at, credits_used: row.credits_used ?? 0,
      season: row.season ?? "",
      render: { title: row.title ?? "" },
      shot_count: shots.length,
      approved_shot_count: shots.filter((shot) => shot.status === "approved").length,
      any_shot_started: shots.some((shot) => shot.status !== "draft"),
      all_keyframes_selected: shots.length > 0 && shots.every((shot) => !!shot.kf_selected),
      all_shots_approved: shots.length > 0 && shots.every((shot) => shot.status === "approved"),
    };
  });
}

/**
 * FR-12 share page lookup. `share.slug` lives inside `doc`, not a column —
 * one extra `json_extract` per row beats adding a migration + a second
 * write path just to keep a slug column in sync.
 */
export async function getEpisodeBySlug(slug: string): Promise<Episode | null> {
  const row = getDb()
    .query<{ doc: string }, [string]>(
      "select doc from episodes where json_extract(doc, '$.share.slug') = ?",
    )
    .get(slug);
  return row ? decodeEpisode(row.doc) : null;
}

export type SetShareResult = Extract<PatchResult, { ok: false }> | { ok: true; row_version: number; slug: string };

/**
 * FR-12 分享开关：slug 首次开启时生成，之后关闭/重开都复用同一个，链接
 * 发出去了不该失效。不走 patchEpisode 的通用 `EpisodePatch`——slug 不该
 * 由调用方随便传一个字符串，生成逻辑锁在这里。
 */
export async function setShare(
  episodeId: string,
  clientRowVersion: number,
  enabled: boolean,
): Promise<SetShareResult> {
  const row = readRow(episodeId);
  if (!row) return { ok: false, error: "not_found" };
  if (row.row_version !== clientRowVersion) {
    return { ok: false, error: "version_conflict", current_row_version: row.row_version };
  }

  const episode = decodeEpisode(row.doc);
  const slug = episode.share.slug || crypto.randomUUID().slice(0, 8);
  const result = commit(episodeId, clientRowVersion, { ...episode, share: { enabled, slug } }, row.row_version);
  if (!result.ok) return result;
  return { ok: true, row_version: result.row_version, slug };
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

  const episode = decodeEpisode(row.doc);
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

  const episode = decodeEpisode(row.doc);
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

  const before = decodeEpisode(row.doc);
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
