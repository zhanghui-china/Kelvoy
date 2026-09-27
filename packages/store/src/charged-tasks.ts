import { type Destination, type Episode, type EpisodeStatus, type RegenStage, type Task,
  checkScriptRules, isLegalEpisodeStatusChange, isLegalShotStatusChange, mergeGeneratedShotResult,
  reviewAdvanceError } from "@kelvoy/engine";
import { finalizeCredits, getCreditAction, getCreditBalance, getCreditPrice, reserveCredits } from "./credits";
import { getDb } from "./db";
import { decodeEpisode } from "./episode-codec";

type LeaseRow = { status: string; lease_token: string | null; lease_until: number | null };

function ownsLiveLease(row: LeaseRow | null, task: Task): boolean {
  return !!row && row.status === "processing" && !!task.lease_token &&
    row.lease_token === task.lease_token &&
    row.lease_until !== null && row.lease_until > Math.floor(Date.now() / 1000);
}

export function createEpisodeWithScriptTask(episode: Episode):
  { ok: true; task_id: string } | { ok: false; error: "insufficient_credits" | "not_found" } {
  return getDb().transaction(() => {
    const taskId = `tk_${crypto.randomUUID()}`;
    const scriptTaskId = `tk_script_${episode.episode_id}`;
    const reserved = reserveCredits({ action_id: scriptTaskId, user_id: episode.owner_id,
      episode_id: episode.episode_id, task_id: scriptTaskId, kind: "script", units: 1 });
    if (!reserved.ok) return { ok: false,
      error: reserved.error === "insufficient_credits" ? "insufficient_credits" : "not_found" } as const;
    getDb().query("insert into episodes (episode_id, owner_id, row_version, doc) values (?, ?, 1, ?)")
      .run(episode.episode_id, episode.owner_id, JSON.stringify(episode));
    getDb().query("insert into tasks (task_id, episode_id, stage, attempt, status) values (?, ?, 'brief', 1, 'pending')")
      .run(taskId, episode.episode_id);
    // Brief is free. Its successful handoff queues the charged script task;
    // reserve is already held under this stable action id.
    return { ok: true, task_id: taskId } as const;
  }).immediate();
}

export function submitReviewAdvance(input: {
  episode_id: string; owner_id: string; row_version: number; next_status: EpisodeStatus;
}): { ok: true; row_version: number } |
  { ok: false; error: "not_found" | "version_conflict" | "illegal_transition" | "script_rule_violation" | "insufficient_credits"; current_row_version?: number } {
  return getDb().transaction(() => {
    const row = getDb().query<{ doc: string; row_version: number }, [string, string]>(
      "select doc, row_version from episodes where episode_id = ? and owner_id = ?",
    ).get(input.episode_id, input.owner_id);
    if (!row) return { ok: false, error: "not_found" } as const;
    if (row.row_version !== input.row_version) return { ok: false, error: "version_conflict",
      current_row_version: row.row_version } as const;
    const episode = decodeEpisode(row.doc);
    if (!isLegalEpisodeStatusChange(episode.status, input.next_status)) {
      return { ok: false, error: "illegal_transition" } as const;
    }
    if (episode.script_pending_task_id) return { ok: false, error: "illegal_transition" } as const;
    if (reviewAdvanceError(episode)) return { ok: false, error: "illegal_transition" } as const;
    if (episode.status === "script_review") {
      const revision = getDb().query<{ doc: string }, [string, number]>(
        "select doc from destination_versions where destination_id = ? and version = ?",
      ).get(episode.destination_id, episode.destination_version);
      if (!revision) return { ok: false, error: "not_found" } as const;
      if (checkScriptRules(episode.shots, JSON.parse(revision.doc) as Destination).length > 0) {
        return { ok: false, error: "script_rule_violation" } as const;
      }
    }
    const chargedTasks: { id: string; stage: "keyframe" | "video" | "compose";
      shot_no?: number; units: number; held: boolean }[] = [];
    if (episode.status === "script_review" && input.next_status === "assets") {
      for (const shot of episode.shots) chargedTasks.push({
        id: `tk_${crypto.randomUUID()}`,
        stage: episode.video_source === "references" ? "video" : "keyframe",
        shot_no: shot.no,
        units: episode.video_source === "references" ? 1 : episode.candidate_count ?? 2,
        held: true,
      });
    } else if (episode.status === "kf_review" && input.next_status === "clipping") {
      for (const shot of episode.shots.filter((item) => item.status === "kf_selected")) {
        chargedTasks.push({ id: `tk_${crypto.randomUUID()}`, stage: "video",
          shot_no: shot.no, units: 1, held: false });
      }
    } else if (input.next_status === "composing") {
      chargedTasks.push({ id: `tk_${crypto.randomUUID()}`, stage: "compose", units: 1, held: false });
    }
    const total = chargedTasks.reduce((sum, task) => sum + getCreditPrice(
      task.stage === "keyframe" ? "image" : task.stage,
    ) * task.units, 0);
    if (getCreditBalance(input.owner_id).available < total) {
      return { ok: false, error: "insufficient_credits" } as const;
    }
    for (const task of chargedTasks) {
      const reserved = reserveCredits({ action_id: task.id, user_id: input.owner_id,
        episode_id: input.episode_id, task_id: task.id,
        kind: task.stage === "keyframe" ? "image" : task.stage, units: task.units });
      if (!reserved.ok) throw new Error(`credit reservation failed after balance check: ${reserved.error}`);
      getDb().query(`insert into tasks (task_id, episode_id, stage, shot_no, attempt, status)
        values (?, ?, ?, ?, 1, ?)`).run(task.id, input.episode_id, task.stage,
          task.shot_no ?? null, task.held ? "held" : "pending");
    }
    if (input.next_status === "assets") {
      getDb().query(`insert into tasks (task_id, episode_id, stage, attempt, status)
        values (?, ?, 'assets', 1, 'pending')`).run(`tk_${crypto.randomUUID()}`, input.episode_id);
    }
    getDb().query(`update episodes set doc = ?, row_version = row_version + 1,
      updated_at = datetime('now') where episode_id = ?`)
      .run(JSON.stringify({ ...episode, status: input.next_status }), input.episode_id);
    return { ok: true, row_version: row.row_version + 1 } as const;
  }).immediate();
}

export function submitShotRegeneration(input: {
  episode_id: string; owner_id: string; row_version: number;
  shot_no: number; stage: RegenStage; report_bad: boolean;
}): { ok: true; row_version: number; free: boolean } |
  { ok: false; error: "not_found" | "version_conflict" | "illegal_transition" | "insufficient_credits"; current_row_version?: number } {
  return getDb().transaction(() => {
    const row = getDb().query<{ doc: string; row_version: number }, [string, string]>(
      "select doc, row_version from episodes where episode_id = ? and owner_id = ?",
    ).get(input.episode_id, input.owner_id);
    if (!row) return { ok: false, error: "not_found" } as const;
    if (row.row_version !== input.row_version) return { ok: false,
      error: "version_conflict", current_row_version: row.row_version } as const;
    const episode = decodeEpisode(row.doc);
    const shot = episode.shots.find((item) => item.no === input.shot_no);
    if (!shot) return { ok: false, error: "not_found" } as const;
    const nextStatus = input.stage === "keyframe" ? "kf_review" : "clip_review";
    if ((episode.video_source === "references" && input.stage === "keyframe") ||
        !isLegalShotStatusChange(shot.status, "rejected") ||
        (episode.status !== nextStatus && episode.status !== "done" &&
          !(episode.status === "clip_review" && nextStatus === "kf_review")) ||
        (input.stage === "video" && episode.video_source !== "references" &&
          (!shot.kf_selected || !shot.candidates.includes(shot.kf_selected))) ||
        (episode.status !== nextStatus && !isLegalEpisodeStatusChange(episode.status, nextStatus))) {
      return { ok: false, error: "illegal_transition" } as const;
    }
    const free = input.report_bad && input.stage === "video" && !shot.bad_shot_reported;
    const taskId = `tk_${crypto.randomUUID()}`;
    if (!free) {
      const reserved = reserveCredits({ action_id: taskId, user_id: input.owner_id,
        episode_id: input.episode_id, task_id: taskId,
        kind: input.stage === "keyframe" ? "image" : "video",
        units: input.stage === "keyframe" ? episode.candidate_count ?? 2 : 1 });
      if (!reserved.ok) return { ok: false, error:
        reserved.error === "insufficient_credits" ? "insufficient_credits" : "not_found" } as const;
    }
    const updatedShot = { ...shot, status: "rejected" as const, regen_stage: input.stage,
      bad_shot_reported: shot.bad_shot_reported || free };
    const updated = { ...episode, status: nextStatus,
      shots: episode.shots.map((item) => item.no === input.shot_no ? updatedShot : item) };
    getDb().query(`update episodes set doc = ?, row_version = row_version + 1,
      updated_at = datetime('now') where episode_id = ?`).run(JSON.stringify(updated), input.episode_id);
    getDb().query(`insert into tasks (task_id, episode_id, stage, shot_no, attempt, status)
      values (?, ?, ?, ?, 1, 'pending')`).run(taskId, input.episode_id, input.stage, input.shot_no);
    return { ok: true, row_version: row.row_version + 1, free } as const;
  }).immediate();
}

/** Episode write, task completion and credit settlement share one commit. */
export function completeTaskWithEpisode(task: Task, rowVersion: number, updated: Episode, started?: Episode):
  { ok: true; row_version: number } | { ok: false; error: "not_found" | "version_conflict" | "illegal_transition" | "lease_lost" } {
  return getDb().transaction(() => {
    const taskRow = getDb().query<LeaseRow, [string]>(
      "select status, lease_token, lease_until from tasks where task_id = ?",
    ).get(task.task_id);
    if (!ownsLiveLease(taskRow, task)) {
      return { ok: false, error: "lease_lost" } as const;
    }
    const row = getDb().query<{ doc: string; row_version: number }, [string]>(
      "select doc, row_version from episodes where episode_id = ?",
    ).get(task.episode_id);
    if (!row) return { ok: false, error: "not_found" } as const;
    const before = decodeEpisode(row.doc);
    const isShotTask = task.stage === "keyframe" || task.stage === "video";
    const merged = isShotTask && started && task.shot_no !== undefined
      ? mergeGeneratedShotResult(task.stage, task.shot_no, started, before, updated) : null;
    if (isShotTask && started && !merged) {
      return { ok: false, error: "illegal_transition" } as const;
    }
    if (row.row_version !== rowVersion && !merged) {
      return { ok: false, error: "version_conflict" } as const;
    }
    const committed = merged ?? updated;
    if (before.status !== committed.status && !isLegalEpisodeStatusChange(before.status, committed.status)) {
      return { ok: false, error: "illegal_transition" } as const;
    }
    const action = getCreditAction(task.task_id);
    const charged = action?.status === "reserved" ? action.price : 0;
    const withCredits = { ...committed, credits_used: (before.credits_used ?? 0) + charged };
    getDb().query(`update episodes set doc = ?, row_version = row_version + 1,
      updated_at = datetime('now') where episode_id = ?`).run(JSON.stringify(withCredits), task.episode_id);
    // Uncharged tasks have no credit action; that is expected for brief/assets.
    finalizeCredits(task.task_id, "settled");
    getDb().query(`update tasks set status = 'done', lease_token = null, lease_until = null,
      updated_at = datetime('now') where task_id = ?`).run(task.task_id);
    if (task.stage === "brief" && committed.status === "scripting") {
      getDb().query(`insert or ignore into tasks (task_id, episode_id, stage, attempt, status)
        values (?, ?, 'script', 1, 'pending')`)
        .run(`tk_script_${task.episode_id}`, task.episode_id);
    }
    if (task.stage === "assets" && (committed.status === "keyframing" || committed.status === "clipping")) {
      getDb().query(`update tasks set status = 'pending', updated_at = datetime('now')
        where episode_id = ? and stage = ? and status = 'held'`)
        .run(task.episode_id, committed.status === "clipping" ? "video" : "keyframe");
    }
    return { ok: true, row_version: row.row_version + 1 } as const;
  }).immediate();
}

export function completeTaskWithoutEpisode(task: Task): void {
  getDb().transaction(() => {
    const row = getDb().query<LeaseRow, [string]>(
      "select status, lease_token, lease_until from tasks where task_id = ?",
    ).get(task.task_id);
    if (!ownsLiveLease(row, task)) return;
    // A stale/duplicate task made no new output, so its reservation is refunded.
    finalizeCredits(task.task_id, "released");
    getDb().query(`update tasks set status = 'done', lease_token = null, lease_until = null,
      updated_at = datetime('now') where task_id = ?`).run(task.task_id);
  }).immediate();
}

/** Retry a DB write race without charging it as a model invocation failure. */
export function requeueTaskAfterCommitConflict(task: Task): boolean {
  const result = getDb().query(`update tasks set status = 'pending',
    lease_token = null, lease_until = null, updated_at = datetime('now')
    where task_id = ? and status = 'processing' and lease_token = ?
      and lease_until > unixepoch('now')`)
    .run(task.task_id, task.lease_token ?? "");
  return result.changes === 1;
}

export function failTaskWithCredits(task: Task, requeue: boolean, failureReason?: string): boolean {
  return getDb().transaction(() => {
    const row = getDb().query<LeaseRow, [string]>(
      "select status, lease_token, lease_until from tasks where task_id = ?",
    ).get(task.task_id);
    if (!ownsLiveLease(row, task)) return false;
    if (requeue) {
      getDb().query(`update tasks set status = 'pending', attempt = attempt + 1,
        lease_token = null, lease_until = null, updated_at = datetime('now') where task_id = ?`)
        .run(task.task_id);
    } else {
      if (failureReason) {
        const episodeRow = getDb().query<{ doc: string }, [string]>(
          "select doc from episodes where episode_id = ?",
        ).get(task.episode_id);
        if (episodeRow) {
          const episode = decodeEpisode(episodeRow.doc);
          const target = task.stage === "keyframe" ? "generating_kf"
            : task.stage === "video" ? "generating_clip" : null;
          const shot = episode.shots.find((item) => item.no === task.shot_no);
          let updated: Episode | null = null;
          if (target && shot?.status === target) {
            updated = { ...episode, failure_reason: failureReason,
              shots: episode.shots.map((item) => item.no === task.shot_no
                ? { ...item, status: "failed" as const } : item) };
          } else if (!target && ["brief", "script", "assets", "compose"].includes(task.stage)) {
            updated = { ...episode, status: "failed", failure_reason: failureReason };
          }
          if (updated) getDb().query(`update episodes set doc = ?, row_version = row_version + 1,
            updated_at = datetime('now') where episode_id = ?`)
            .run(JSON.stringify(updated), task.episode_id);
        }
      }
      finalizeCredits(task.task_id, "released");
      if (task.stage === "brief") finalizeCredits(`tk_script_${task.episode_id}`, "released");
      if (task.stage === "assets") {
        const held = getDb().query<{ task_id: string }, [string]>(
          "select task_id from tasks where episode_id = ? and status = 'held' and stage in ('keyframe', 'video')",
        ).all(task.episode_id);
        for (const pending of held) finalizeCredits(pending.task_id, "released");
        getDb().query(`update tasks set status = 'cancelled', updated_at = datetime('now')
          where episode_id = ? and status = 'held' and stage in ('keyframe', 'video')`).run(task.episode_id);
      }
      getDb().query(`update tasks set status = 'failed', lease_token = null,
        lease_until = null, updated_at = datetime('now') where task_id = ?`)
        .run(task.task_id);
    }
    return true;
  }).immediate();
}
