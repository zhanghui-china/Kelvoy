import type { StageName } from "@kelvoy/engine";
import { isLegalEpisodeStatusChange, planStoryboardGeneration } from "@kelvoy/engine";
import { getCreditBalance, getCreditPrice, reserveCredits } from "./credits";
import { getDb } from "./db";
import { decodeEpisode } from "./episode-codec";
import { findRetryableFailedTask } from "./tasks";

type RetryError = "not_found" | "version_conflict" | "illegal_transition" |
  "insufficient_credits" | "no_failed_task";

/** Requeue the actual failed work with a fresh credit action and the original
 * generation identity. Cached candidate files remain available on retry. */
export function submitFailedTaskRetry(input: {
  episode_id: string; owner_id: string; row_version: number;
}): { ok: true; row_version: number; stage: StageName; shot_no: number | null } |
  { ok: false; error: RetryError; current_row_version?: number } {
  return getDb().transaction(() => {
    const row = getDb().query<{ doc: string; row_version: number }, [string, string]>(
      "select doc, row_version from episodes where episode_id = ? and owner_id = ?",
    ).get(input.episode_id, input.owner_id);
    if (!row) return { ok: false, error: "not_found" } as const;
    if (row.row_version !== input.row_version) return { ok: false,
      error: "version_conflict", current_row_version: row.row_version } as const;
    const episode = decodeEpisode(row.doc);
    if (episode.mode === "grid") return { ok: false, error: "illegal_transition" } as const;
    const failed = findRetryableFailedTask(episode);
    if (!failed) return { ok: false, error: "no_failed_task" } as const;
    const target = failed.stage === "brief" || failed.stage === "script" ? "scripting"
      : failed.stage === "assets" ? "assets"
      : failed.stage === "keyframe" ? "keyframing"
      : failed.stage === "video" ? "clipping" : "composing";
    const reviewStatus = failed.stage === "keyframe" ? "kf_review"
      : failed.stage === "video" ? "clip_review" : null;
    if (episode.status !== "failed" && episode.status !== target && episode.status !== reviewStatus) {
      return { ok: false, error: "illegal_transition" } as const;
    }
    if (episode.status === "failed" && !isLegalEpisodeStatusChange("failed", target)) {
      return { ok: false, error: "illegal_transition" } as const;
    }
    const stage = failed.stage === "brief" ? "script" : failed.stage;
    const tasks: { id: string; stage: StageName; shot_no: number | null; shot_id?: string | null;
      generation_id: string | null; held: boolean; units: number }[] = [];
    if (stage === "assets") {
      const plan = planStoryboardGeneration(episode);
      for (const shot of plan.keyframes) tasks.push({ id: `tk_${crypto.randomUUID()}`,
        stage: "keyframe", shot_no: shot.no, shot_id: shot.shot_id,
        generation_id: null, held: true, units: episode.candidate_count ?? 2 });
      for (const shot of plan.videos) tasks.push({ id: `tk_${crypto.randomUUID()}`,
        stage: "video", shot_no: shot.no, shot_id: shot.shot_id,
        generation_id: null, held: true, units: 1 });
      tasks.push({ id: `tk_${crypto.randomUUID()}`, stage, shot_no: null,
        generation_id: null, held: false, units: 0 });
    } else {
      tasks.push({ id: `tk_${crypto.randomUUID()}`, stage, shot_no: failed.shot_id ? episode.shots.find(s => s.shot_id === failed.shot_id)?.no ?? null : failed.shot_no, shot_id: failed.shot_id,
        generation_id: stage === "keyframe" || stage === "video"
          ? failed.generation_id ?? failed.task_id : null,
        held: false, units: stage === "keyframe" ? episode.candidate_count ?? 2 : 1 });
    }
    const total = tasks.reduce((sum, task) => sum + (task.units === 0 ? 0 :
      getCreditPrice(task.stage === "keyframe" ? "image" : task.stage as "script" | "video" | "compose") * task.units), 0);
    if (getCreditBalance(input.owner_id).available < total) {
      return { ok: false, error: "insufficient_credits" } as const;
    }
    for (const task of tasks) {
      if (task.units > 0) {
        const reserved = reserveCredits({ action_id: task.id, user_id: input.owner_id,
          episode_id: input.episode_id, task_id: task.id,
          kind: task.stage === "keyframe" ? "image" : task.stage as "script" | "video" | "compose",
          units: task.units });
        if (!reserved.ok) throw new Error(`retry reservation failed: ${reserved.error}`);
      }
      getDb().query(`insert into tasks
        (task_id, episode_id, stage, shot_no, shot_id, generation_id, attempt, status)
        values (?, ?, ?, ?, ?, ?, 1, ?)`).run(task.id, input.episode_id, task.stage,
          task.shot_no, task.shot_id ?? null, task.generation_id, task.held ? "held" : "pending");
    }
    // Keep the failed row for history, but retire it in the same transaction
    // as the replacement. A later failure on this shot must not revive it.
    const retired = getDb().query(`update tasks set status = 'retried', updated_at = datetime('now')
      where task_id = ? and status = 'failed'`).run(failed.task_id);
    if (retired.changes !== 1) throw new Error("failed task changed during retry");
    getDb().query(`update episodes set doc = ?, row_version = row_version + 1,
      updated_at = datetime('now') where episode_id = ?`)
      .run(JSON.stringify({ ...episode, status: episode.status === reviewStatus ? reviewStatus : target,
        failure_reason: null }), input.episode_id);
    return { ok: true, row_version: row.row_version + 1, stage, shot_no: failed.shot_no } as const;
  }).immediate();
}
