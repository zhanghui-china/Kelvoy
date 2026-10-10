import { type Destination, type Episode, type EpisodeStatus, type RegenStage, type ShotStatus, type Task,
  checkScriptRules, isLegalEpisodeStatusChange, isLegalShotStatusChange, mergeGeneratedShotResult,
  reviewAdvanceError, planStoryboardGeneration, validateStoryboardFields } from "@kelvoy/engine";
import { finalizeCredits, getCreditAction, getCreditBalance, getCreditPrice, reserveCredits } from "./credits";
import { getDb } from "./db";
import { decodeEpisode } from "./episode-codec";

import type { TaskDiagnostic } from "./task-diagnostics";

type LeaseRow = { status: string; lease_token: string | null; lease_until: number | null };

function ownsLiveLease(row: LeaseRow | null, task: Task): boolean {
  return !!row && row.status === "processing" && !!task.lease_token &&
    row.lease_token === task.lease_token &&
    row.lease_until !== null && row.lease_until > Math.floor(Date.now() / 1000);
}

/** Fence the pre-inference shot transition with the same lease as result commit. */
export function prepareTaskShot(task: Task, rowVersion: number, status: ShotStatus):
  { ok: true; row_version: number } |
  { ok: false; error: "lease_lost" | "not_found" | "version_conflict" | "illegal_transition" } {
  return getDb().transaction(() => {
    const lease = getDb().query<LeaseRow, [string]>(
      "select status, lease_token, lease_until from tasks where task_id = ?",
    ).get(task.task_id);
    if (!ownsLiveLease(lease, task)) return { ok: false, error: "lease_lost" } as const;
    const row = getDb().query<{ doc: string; row_version: number }, [string]>(
      "select doc, row_version from episodes where episode_id = ?",
    ).get(task.episode_id);
    if (!row) return { ok: false, error: "not_found" } as const;
    if (row.row_version !== rowVersion) return { ok: false, error: "version_conflict" } as const;
    const episode = decodeEpisode(row.doc);
    const index = episode.shots.findIndex((shot) => task.shot_id ? shot.shot_id === task.shot_id : shot.no === task.shot_no);
    if (index < 0) return { ok: false, error: "not_found" } as const;
    const shot = episode.shots[index]!;
    if (!isLegalShotStatusChange(shot.status, status)) {
      return { ok: false, error: "illegal_transition" } as const;
    }
    const shots = [...episode.shots];
    shots[index] = { ...shot, status };
    getDb().query(`update episodes set doc = ?, row_version = row_version + 1,
      updated_at = datetime('now') where episode_id = ?`)
      .run(JSON.stringify({ ...episode, shots }), task.episode_id);
    return { ok: true, row_version: row.row_version + 1 } as const;
  }).immediate();
}

export function createEpisodeWithScriptTask(episode: Episode):
  { ok: true; task_id: string } | { ok: false; error: "insufficient_credits" | "not_found" | "persona_not_found" } {
  return getDb().transaction(() => {
    const persona = getDb().query<{ owner_id: string | null }, [string]>(
      "select owner_id from personas where persona_id = ? and deleted_at is null",
    ).get(episode.persona_id);
    if (!persona || (persona.owner_id !== null && persona.owner_id !== episode.owner_id)) {
      return { ok: false, error: "persona_not_found" } as const;
    }
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
    const planned = episode.status === "script_review" ? planStoryboardGeneration(episode) : null;
    const nextStatus = planned?.next_status ?? input.next_status;
    if (!isLegalEpisodeStatusChange(episode.status, nextStatus)) {
      return { ok: false, error: "illegal_transition" } as const;
    }
    if (getDb().query("select 1 from tasks where episode_id = ? and status in ('held','pending','processing') limit 1").get(input.episode_id)) return { ok: false, error: "illegal_transition" } as const;
    if (episode.script_pending_task_id) return { ok: false, error: "illegal_transition" } as const;
    if (reviewAdvanceError(episode)) return { ok: false, error: "illegal_transition" } as const;
    if (episode.status === "script_review") {
      const revision = getDb().query<{ doc: string }, [string, number]>(
        "select doc from destination_versions where destination_id = ? and version = ?",
      ).get(episode.destination_id, episode.destination_version);
      if (!revision) return { ok: false, error: "not_found" } as const;
      if (!episode.shots.length || episode.shots.some(shot => validateStoryboardFields(episode, { scene: shot.scene, beat: shot.beat, caption: shot.caption ?? "", size: shot.size, camera: shot.camera, landmark: shot.landmark, kf_prompt: shot.kf_prompt, motion_prompt: shot.motion_prompt }, JSON.parse(revision.doc) as Destination, true).length > 0) || checkScriptRules(episode.shots, JSON.parse(revision.doc) as Destination).some(v => v.rule === "landmark_reference")) {
        return { ok: false, error: "script_rule_violation" } as const;
      }
    }
    const chargedTasks: { id: string; stage: "keyframe" | "video" | "compose";
      shot_no?: number; shot_id?: string; units: number; held: boolean }[] = [];
    if (planned && nextStatus === "assets") {
      for (const shot of planned.keyframes) chargedTasks.push({ id: `tk_${crypto.randomUUID()}`,
        stage: "keyframe", shot_no: shot.no, shot_id: shot.shot_id,
        units: episode.candidate_count ?? 2, held: true });
      for (const shot of planned.videos) chargedTasks.push({ id: `tk_${crypto.randomUUID()}`,
        stage: "video", shot_no: shot.no, shot_id: shot.shot_id, units: 1, held: true });
    } else if (episode.status === "kf_review" && nextStatus === "clipping") {
      for (const shot of episode.shots.filter((item) => item.status === "kf_selected")) {
        chargedTasks.push({ id: `tk_${crypto.randomUUID()}`, stage: "video",
          shot_no: shot.no, shot_id: shot.shot_id, units: 1, held: false });
      }
    } else if (nextStatus === "composing") {
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
      getDb().query(`insert into tasks (task_id, episode_id, stage, shot_no, shot_id, attempt, status)
        values (?, ?, ?, ?, ?, 1, ?)`).run(task.id, input.episode_id, task.stage,
          task.shot_no ?? null, task.shot_id ?? null, task.held ? "held" : "pending");
    }
    if (nextStatus === "assets") {
      getDb().query(`insert into tasks (task_id, episode_id, stage, attempt, status)
        values (?, ?, 'assets', 1, 'pending')`).run(`tk_${crypto.randomUUID()}`, input.episode_id);
    }
    getDb().query(`update episodes set doc = ?, row_version = row_version + 1,
      updated_at = datetime('now') where episode_id = ?`)
      .run(JSON.stringify({ ...episode, status: nextStatus }), input.episode_id);
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
    getDb().query(`insert into tasks (task_id, episode_id, stage, shot_no, shot_id, attempt, status)
      values (?, ?, ?, ?, ?, 1, 'pending')`).run(taskId, input.episode_id, input.stage, input.shot_no, shot.shot_id ?? null);
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
      ? mergeGeneratedShotResult(task.stage, task.shot_id ?? task.shot_no, decodeEpisode(JSON.stringify(started)), before, decodeEpisode(JSON.stringify(updated))) : null;
    if (isShotTask && started && !merged) {
      return { ok: false, error: "illegal_transition" } as const;
    }
    if (row.row_version !== rowVersion && !merged) {
      return { ok: false, error: "version_conflict" } as const;
    }
    const committed = decodeEpisode(JSON.stringify(merged ?? updated));
    if (task.stage === "compose") {
      committed.final_needs_recompose = false;
      delete committed.shared_storyboard;
    }
    if (before.status !== committed.status && !isLegalEpisodeStatusChange(before.status, committed.status) &&
        !(task.stage === "assets" && before.status === "assets" && ["kf_review", "clipping", "clip_review", "compose_ready"].includes(committed.status))) {
      return { ok: false, error: "illegal_transition" } as const;
    }
    const action = getCreditAction(task.task_id);
    const charged = action?.status === "reserved" ? action.price : 0;
    const withCredits = { ...committed, credits_used: (before.credits_used ?? 0) + charged };
    getDb().query(`update episodes set doc = ?, row_version = row_version + 1,
      updated_at = datetime('now') where episode_id = ?`).run(JSON.stringify(withCredits), task.episode_id);
    // Uncharged tasks have no credit action; that is expected for brief/assets.
    finalizeCredits(task.task_id, "settled");
    getDb().query(`update tasks set status = 'done', error = null, lease_token = null, lease_until = null,
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
    getDb().query(`update tasks set status = 'done', error = null, lease_token = null, lease_until = null,
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

export function failTaskWithCredits(task: Task, requeue: boolean, failureReason?: string, diagnostic?: TaskDiagnostic): boolean {
  return getDb().transaction(() => {
    const row = getDb().query<LeaseRow, [string]>(
      "select status, lease_token, lease_until from tasks where task_id = ?",
    ).get(task.task_id);
    if (!ownsLiveLease(row, task)) return false;
    if (diagnostic) getDb().query("update tasks set error = ? where task_id = ?")
      .run(JSON.stringify(diagnostic), task.task_id);
    if (requeue) {
      getDb().query(`update tasks set status = 'pending', attempt = attempt + 1,
        lease_token = null, lease_until = null, updated_at = datetime('now') where task_id = ?`)
        .run(task.task_id);
    } else {
      if (task.operation === "script_regenerate" || task.operation === "script_optimize") {
        const episodeRow = getDb().query<{ doc: string }, [string]>(
          "select doc from episodes where episode_id = ?",
        ).get(task.episode_id);
        if (episodeRow) {
          const episode = decodeEpisode(episodeRow.doc);
          if (episode.script_pending_task_id === task.task_id) {
            const updated = { ...episode, script_pending_task_id: null,
              script_action_error: "脚本处理失败，原稿已保留，请重试。" };
            getDb().query(`update episodes set doc = ?, row_version = row_version + 1,
              updated_at = datetime('now') where episode_id = ?`)
              .run(JSON.stringify(updated), task.episode_id);
          }
        }
      } else if (task.operation === "shot_suggest") {
        getDb().query("update tasks set error = ? where task_id = ?").run(failureReason ?? "AI 补全失败，请重试。", task.task_id);
      } else if (failureReason) {
        const episodeRow = getDb().query<{ doc: string }, [string]>(
          "select doc from episodes where episode_id = ?",
        ).get(task.episode_id);
        if (episodeRow) {
          const episode = decodeEpisode(episodeRow.doc);
          const target = task.stage === "keyframe" ? "generating_kf"
            : task.stage === "video" ? "generating_clip" : null;
          const shot = episode.shots.find((item) => task.shot_id ? item.shot_id === task.shot_id : item.no === task.shot_no);
          let updated: Episode | null = null;
          if (target && shot?.status === target) {
            updated = { ...episode, failure_reason: failureReason,
              shots: episode.shots.map((item) => (task.shot_id ? item.shot_id === task.shot_id : item.no === task.shot_no)
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
