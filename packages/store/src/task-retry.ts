import type { Episode, Shot, StageName } from "@kelvoy/engine";
import { isLegalEpisodeStatusChange, planStoryboardGeneration } from "@kelvoy/engine";
import { getCreditBalance, getCreditPrice, reserveCredits } from "./credits";
import { getDb } from "./db";
import { decodeEpisode } from "./episode-codec";
import { listRetryableFailedTasks, type RetryableFailure } from "./tasks";

type RetryError = "not_found" | "version_conflict" | "illegal_transition" |
  "insufficient_credits" | "no_failed_task" | "invalid_target";

type Queued = { stage: StageName; shot_no: number | null; resynthesized: boolean };
type Skipped = { stage: StageName; shot_no: number | null; reason: string };

/** One unit of retry work. `failed` is null for a re-issue: the shot is
 * `failed` but no retryable task record exists (history lost or retired). */
type Item = { stage: StageName; failed: RetryableFailure | null; shot: Shot | null };
type Row = { id: string; stage: StageName; shot_no: number | null; shot_id?: string | null;
  generation_id: string | null; held: boolean; units: number };

const kindOf = (stage: StageName) => stage === "keyframe" ? "image" : stage as "script" | "video" | "compose";

/** Episode status a retry of `stage` moves to; null when the stage is not retryable from here. */
function statusFor(episode: Episode, stage: StageName): { next: Episode["status"] } | null {
  const target = stage === "brief" || stage === "script" ? "scripting"
    : stage === "assets" ? "assets"
    : stage === "keyframe" ? "keyframing"
    : stage === "video" ? "clipping" : "composing";
  const reviewStatus = stage === "keyframe" ? "kf_review" : stage === "video" ? "clip_review" : null;
  if (episode.status !== "failed" && episode.status !== target && episode.status !== reviewStatus) return null;
  if (episode.status === "failed" && !isLegalEpisodeStatusChange("failed", target)) return null;
  return { next: episode.status === reviewStatus ? reviewStatus : target };
}

/** Stage a task-less failed shot must be re-run from. */
function reissueStage(episode: Episode, shot: Shot): "keyframe" | "video" {
  if (episode.video_source === "references") return "video";
  return shot.kf_selected && shot.candidates.includes(shot.kf_selected) ? "video" : "keyframe";
}

function shotOf(episode: Episode, failed: RetryableFailure): Shot | null {
  return episode.shots.find((s) => failed.shot_id ? s.shot_id === failed.shot_id : s.no === failed.shot_no) ?? null;
}

function hasActiveTask(episodeId: string, stage: StageName, shot: Shot): boolean {
  return !!getDb().query(`select 1 from tasks where episode_id = ? and stage = ?
    and status in ('pending', 'processing', 'held')
    and ((? is not null and shot_id = ?) or (? is null and shot_no is ?))`)
    .get(episodeId, stage, shot.shot_id ?? null, shot.shot_id ?? null, shot.shot_id ?? null, shot.no);
}

/** Rows to insert for one item. Assets expands into held per-shot work. */
function rowsFor(episode: Episode, item: Item): Row[] {
  const { stage, failed, shot } = item;
  const id = `tk_${crypto.randomUUID()}`;
  if (stage === "assets") {
    const rows: Row[] = [];
    const plan = planStoryboardGeneration(episode);
    for (const s of plan.keyframes) rows.push({ id: `tk_${crypto.randomUUID()}`, stage: "keyframe",
      shot_no: s.no, shot_id: s.shot_id, generation_id: null, held: true, units: episode.candidate_count ?? 2 });
    for (const s of plan.videos) rows.push({ id: `tk_${crypto.randomUUID()}`, stage: "video",
      shot_no: s.no, shot_id: s.shot_id, generation_id: null, held: true, units: 1 });
    rows.push({ id, stage, shot_no: null, generation_id: null, held: false, units: 0 });
    return rows;
  }
  const shotNo = shot ? shot.no : failed?.shot_no ?? null;
  const shotGen = stage === "keyframe" || stage === "video";
  return [{ id, stage, shot_no: shotNo, shot_id: failed ? failed.shot_id : shot?.shot_id ?? null,
    generation_id: shotGen ? failed ? failed.generation_id ?? failed.task_id : id : null,
    held: false, units: stage === "keyframe" ? episode.candidate_count ?? 2 : 1 }];
}

/** Items for `all`: only failures in the phase the episode is currently in. */
function collectAll(episode: Episode, failures: RetryableFailure[]): { items: Item[]; skipped: Skipped[] } {
  const inPhase = (stage: StageName) => episode.status === "failed" ? stage === "keyframe" || stage === "video"
    : episode.status === "kf_review" || episode.status === "keyframing" ? stage === "keyframe"
    : episode.status === "clip_review" || episode.status === "clipping" ? stage === "video" : false;
  const items: Item[] = [];
  const skipped: Skipped[] = [];
  const covered = new Set<Shot>();
  for (const failed of failures) {
    const shot = shotOf(episode, failed);
    const shotNo = shot?.no ?? failed.shot_no;
    if (!inPhase(failed.stage) || (failed.stage !== "keyframe" && failed.stage !== "video")) {
      skipped.push({ stage: failed.stage, shot_no: shotNo, reason: "not in the current phase" });
    } else if (shot && covered.has(shot)) {
      // One queued task per shot; the other stage's older failure waits.
      skipped.push({ stage: failed.stage, shot_no: shotNo, reason: "shot already queued" });
    } else items.push({ stage: failed.stage, failed, shot });
    if (shot) covered.add(shot);
  }
  for (const shot of episode.shots) {
    if (shot.status !== "failed" || covered.has(shot)) continue;
    const stage = reissueStage(episode, shot);
    if (!inPhase(stage)) skipped.push({ stage, shot_no: shot.no, reason: "not in the current phase" });
    else if (hasActiveTask(episode.episode_id, stage, shot)) {
      skipped.push({ stage, shot_no: shot.no, reason: "task already active" });
    } else items.push({ stage, failed: null, shot });
  }
  return { items, skipped };
}

/** Requeue the actual failed work with a fresh credit action and the original
 * generation identity. Cached candidate files remain available on retry.
 * Without `shot_no`/`all` the most recent failure is retried; `shot_no` targets
 * one shot (re-issuing it when no task record survives); `all` queues every
 * failed shot of the current phase atomically, reserving credits all-or-nothing. */
export function submitFailedTaskRetry(input: {
  episode_id: string; owner_id: string; row_version: number; shot_no?: number; all?: boolean;
}): { ok: true; row_version: number; stage: StageName; shot_no: number | null;
  queued: Queued[]; skipped: Skipped[] } |
  { ok: false; error: RetryError; current_row_version?: number } {
  if (input.all && input.shot_no !== undefined) return { ok: false, error: "invalid_target" };
  if (input.shot_no !== undefined && (!Number.isInteger(input.shot_no) || input.shot_no < 1)) {
    return { ok: false, error: "invalid_target" };
  }
  return getDb().transaction(() => {
    const row = getDb().query<{ doc: string; row_version: number }, [string, string]>(
      "select doc, row_version from episodes where episode_id = ? and owner_id = ?",
    ).get(input.episode_id, input.owner_id);
    if (!row) return { ok: false, error: "not_found" } as const;
    if (row.row_version !== input.row_version) return { ok: false,
      error: "version_conflict", current_row_version: row.row_version } as const;
    const episode = decodeEpisode(row.doc);
    if (episode.mode === "grid") return { ok: false, error: "illegal_transition" } as const;
    const failures = listRetryableFailedTasks(episode);
    let items: Item[] = [];
    let skipped: Skipped[] = [];
    if (input.all) {
      ({ items, skipped } = collectAll(episode, failures));
      if (!items.length) return { ok: false, error: "no_failed_task" } as const;
    } else if (input.shot_no !== undefined) {
      const shot = episode.shots.find((s) => s.no === input.shot_no);
      const own = failures.filter((f) => (f.stage === "keyframe" || f.stage === "video") && shot && shotOf(episode, f) === shot);
      const failed = own.find((f) => statusFor(episode, f.stage)) ?? own[0] ?? null;
      if (failed) items = [{ stage: failed.stage, failed, shot }];
      else if (shot && shot.status === "failed") {
        const stage = reissueStage(episode, shot);
        if (hasActiveTask(episode.episode_id, stage, shot)) return { ok: false, error: "no_failed_task" } as const;
        items = [{ stage, failed: null, shot }];
      } else return { ok: false, error: "no_failed_task" } as const;
    } else {
      const failed = failures[0];
      if (!failed) return { ok: false, error: "no_failed_task" } as const;
      // Legacy single retry: brief failures re-run the script stage.
      items = [{ stage: failed.stage === "brief" ? "script" : failed.stage, failed, shot: shotOf(episode, failed) }];
    }
    if (!input.all && !statusFor(episode, items[0]!.stage)) {
      return { ok: false, error: "illegal_transition" } as const;
    }
    const queuedItems: Item[] = [];
    for (const item of items) {
      if (statusFor(episode, item.stage)) queuedItems.push(item);
      else skipped.push({ stage: item.stage, shot_no: item.shot?.no ?? null, reason: "illegal transition" });
    }
    if (!queuedItems.length) return { ok: false, error: "no_failed_task" } as const;
    const planned = queuedItems.map((item) => ({ item, rows: rowsFor(episode, item) }));
    const total = planned.flatMap((p) => p.rows).reduce((sum, r) =>
      sum + (r.units === 0 ? 0 : getCreditPrice(kindOf(r.stage)) * r.units), 0);
    if (getCreditBalance(input.owner_id).available < total) {
      return { ok: false, error: "insufficient_credits" } as const;
    }
    for (const { item, rows } of planned) {
      for (const r of rows) {
        if (r.units > 0) {
          const reserved = reserveCredits({ action_id: r.id, user_id: input.owner_id,
            episode_id: input.episode_id, task_id: r.id, kind: kindOf(r.stage), units: r.units });
          if (!reserved.ok) throw new Error(`retry reservation failed: ${reserved.error}`);
        }
        getDb().query(`insert into tasks
          (task_id, episode_id, stage, shot_no, shot_id, generation_id, attempt, status)
          values (?, ?, ?, ?, ?, ?, 1, ?)`).run(r.id, input.episode_id, r.stage,
            r.shot_no, r.shot_id ?? null, r.generation_id, r.held ? "held" : "pending");
      }
      if (!item.failed) continue;
      // Keep the failed row for history, but retire it in the same transaction
      // as the replacement. A later failure on this shot must not revive it.
      const retired = getDb().query(`update tasks set status = 'retried', updated_at = datetime('now')
        where task_id = ? and status = 'failed'`).run(item.failed.task_id);
      if (retired.changes !== 1) throw new Error("failed task changed during retry");
      // Older failed rows for the same stage+shot are superseded as well.
      getDb().query(`update tasks set status = 'retried', updated_at = datetime('now')
        where episode_id = ? and stage = ? and status = 'failed' and operation is null
          and ((? is not null and shot_id = ?) or (? is null and shot_no is ?))`)
        .run(input.episode_id, item.failed.stage, item.failed.shot_id, item.failed.shot_id,
          item.failed.shot_id, item.failed.shot_no);
    }
    const first = queuedItems[0]!;
    const next = statusFor(episode, first.stage)!.next;
    getDb().query(`update episodes set doc = ?, row_version = row_version + 1,
      updated_at = datetime('now') where episode_id = ?`)
      .run(JSON.stringify({ ...episode, status: next, failure_reason: null }), input.episode_id);
    return { ok: true, row_version: row.row_version + 1, stage: first.stage,
      shot_no: first.failed?.shot_no ?? first.shot?.no ?? null,
      queued: queuedItems.map((i) => ({ stage: i.stage, shot_no: i.shot?.no ?? i.failed?.shot_no ?? null,
        resynthesized: !i.failed })), skipped } as const;
  }).immediate();
}
