import type { Episode, StageName } from "@kelvoy/engine";
import { isLegalEpisodeStatusChange } from "@kelvoy/engine";
import { getCreditBalance, getCreditPrice, reserveCredits } from "./credits";
import { getDb } from "./db";

type Failure = { task_id: string; stage: StageName; shot_no: number | null; generation_id: string | null };
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
    const episode = JSON.parse(row.doc) as Episode;
    if (episode.mode === "grid") return { ok: false, error: "illegal_transition" } as const;
    const failures = getDb().query<Failure, [string]>(
      `select task_id, stage, shot_no, generation_id from tasks where episode_id = ?
       and status = 'failed' and operation is null order by updated_at desc, rowid desc`,
    ).all(input.episode_id);
    const failed = failures.find((item) => {
      const active = getDb().query<{ count: number }, [string, string, number | null]>(
        `select count(*) as count from tasks where episode_id = ? and stage = ?
         and shot_no is ? and status in ('pending', 'processing', 'held')`,
      ).get(input.episode_id, item.stage, item.shot_no);
      if ((active?.count ?? 0) > 0) return false;
      if (item.stage === "keyframe" || item.stage === "video") {
        const shot = episode.shots.find((candidate) => candidate.no === item.shot_no);
        return !!shot && (shot.status === "failed" ||
          (episode.status === "failed" && shot.status === (item.stage === "keyframe" ? "generating_kf" : "generating_clip")));
      }
      return episode.status === "failed";
    });
    if (!failed) return { ok: false, error: "no_failed_task" } as const;
    const target = failed.stage === "brief" || failed.stage === "script" ? "scripting"
      : failed.stage === "assets" ? "assets"
      : failed.stage === "keyframe" ? "keyframing"
      : failed.stage === "video" ? "clipping" : "composing";
    if (episode.status !== "failed" && episode.status !== target) {
      return { ok: false, error: "illegal_transition" } as const;
    }
    if (episode.status === "failed" && !isLegalEpisodeStatusChange("failed", target)) {
      return { ok: false, error: "illegal_transition" } as const;
    }
    const stage = failed.stage === "brief" ? "script" : failed.stage;
    const tasks: { id: string; stage: StageName; shot_no: number | null;
      generation_id: string | null; held: boolean; units: number }[] = [];
    if (stage === "assets") {
      for (const shot of episode.shots.filter((item) => item.status === "draft")) {
        tasks.push({ id: `tk_${crypto.randomUUID()}`, stage: "keyframe", shot_no: shot.no,
          generation_id: null, held: true, units: episode.candidate_count ?? 2 });
      }
      tasks.push({ id: `tk_${crypto.randomUUID()}`, stage, shot_no: null,
        generation_id: null, held: false, units: 0 });
    } else {
      tasks.push({ id: `tk_${crypto.randomUUID()}`, stage, shot_no: failed.shot_no,
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
        (task_id, episode_id, stage, shot_no, generation_id, attempt, status)
        values (?, ?, ?, ?, ?, 1, ?)`).run(task.id, input.episode_id, task.stage,
          task.shot_no, task.generation_id, task.held ? "held" : "pending");
    }
    getDb().query(`update episodes set doc = ?, row_version = row_version + 1,
      updated_at = datetime('now') where episode_id = ?`)
      .run(JSON.stringify({ ...episode, status: target }), input.episode_id);
    return { ok: true, row_version: row.row_version + 1, stage, shot_no: failed.shot_no } as const;
  }).immediate();
}
