import {
  ContentBlockedError,
  type Episode,
  type EpisodeStatus,
  type ShotStatus,
  type StageContext,
  type StageName,
  type Task,
  runStage,
} from "@kelvoy/engine";
import {
  completeTask,
  dequeueTask,
  enqueueTask,
  failTask,
  getDestination,
  getEpisode,
  getPersonaVersion,
  patchEpisode,
  patchShot,
  replaceEpisode,
} from "@kelvoy/store";
import { ffmpegComposeProvider } from "../compose/ffmpeg";
import { createLocalGenerationProviders } from "../generation/local";

/**
 * Task queue consumer (ADR-0004): polls the local `tasks` table (no Redis,
 * no HTTP — worker and web share a machine and both call @kelvoy/store
 * directly). Dispatches to @kelvoy/engine's runStage and writes the result
 * back with optimistic-lock protection via replaceEpisode.
 */

const POLL_INTERVAL_MS = 1000;
// FR-04: local retry <=2 times before the caller (services/inference
// providers, not this loop) is expected to overflow to a domestic API.
// This loop only tracks whether to requeue; overflow policy lives in
// packages/engine/src/providers/overflow.ts.
const MAX_LOCAL_ATTEMPTS = 2;

// Brief proceeds to script without review. Assets separately fans out to
// per-shot keyframe tasks after review 1; other gates remain human-driven.
const AUTO_ADVANCE: Partial<Record<EpisodeStatus, StageName>> = {
  scripting: "script",
};

export async function consumeLoop(signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted) {
    const task = await dequeueTask();
    if (!task) {
      await Bun.sleep(POLL_INTERVAL_MS);
      continue;
    }
    await handleTask(task);
  }
}

/**
 * Everything a stage needs beyond the Episode itself. Engine stages never
 * touch @kelvoy/store (CLAUDE.md directory table), so the reads happen here:
 * Script needs the destination; generation gets worker-owned HTTP/file
 * adapters; compose gets the worker-owned ffmpeg backend.
 */
export async function buildStageContext(stage: StageName, episode: Episode, task?: Task): Promise<StageContext> {
  const [destination, persona] = await Promise.all([
    getDestination(episode.destination_id),
    getPersonaVersion(episode.persona_id, episode.persona_version),
  ]);
  const context: StageContext = {};
  if (destination) context.destination = destination;
  if (persona) context.persona = persona;
  if (stage === "compose") context.compose = ffmpegComposeProvider;
  if ((stage === "keyframe" || stage === "video") && task) {
    Object.assign(context, createLocalGenerationProviders(), {
      generation_id: task.task_id,
      attempt: task.attempt,
    });
  }
  return context;
}

function generationStatus(stage: StageName): ShotStatus | null {
  if (stage === "keyframe") return "generating_kf";
  if (stage === "video") return "generating_clip";
  return null;
}

/** Persist the first shot-state hop before the long model call. */
async function prepareShot(task: Task, rowVersion: number, episode: Episode): Promise<
  | { kind: "ready"; episode: Episode; row_version: number }
  | { kind: "skip" }
  | { kind: "conflict" }
> {
  const target = generationStatus(task.stage);
  if (!target) return { kind: "ready", episode, row_version: rowVersion };
  const shot = episode.shots.find((item) => item.no === task.shot_no);
  if (!shot) throw new Error(`shot ${task.shot_no} not found`);
  if (shot.status === "approved" ||
      (task.stage === "keyframe" && shot.status === "kf_ready") ||
      (task.stage === "video" && shot.status === "clip_ready")) return { kind: "skip" };
  if (shot.status === target) return { kind: "ready", episode, row_version: rowVersion };
  const expected = task.stage === "keyframe" ? "draft" : "kf_selected";
  if (shot.status !== expected && !(shot.status === "rejected" && shot.regen_stage === task.stage)) {
    throw new Error(`shot ${shot.no} cannot enter ${target} from ${shot.status}`);
  }
  const patched = await patchShot(task.episode_id, shot.no, rowVersion, { status: target });
  if (!patched.ok) return { kind: "conflict" };
  const updated = await getEpisode(task.episode_id);
  if (!updated.ok) return { kind: "conflict" };
  return { kind: "ready", episode: updated.episode, row_version: updated.row_version };
}

export async function handleTask(task: Task, overrides: Partial<StageContext> = {}): Promise<void> {
  const result = await getEpisode(task.episode_id);
  if (!result.ok) {
    // Episode vanished (shouldn't happen under normal operation) — no
    // point retrying, and nowhere to write a failure status either.
    await failTask(task.task_id, { requeue: false });
    return;
  }

  let current = result;
  try {
    const prepared = await prepareShot(task, current.row_version, current.episode);
    if (prepared.kind === "skip") {
      await completeTask(task.task_id);
      return;
    }
    if (prepared.kind === "conflict") {
      await failTask(task.task_id, { requeue: task.attempt < MAX_LOCAL_ATTEMPTS });
      return;
    }
    current = { ok: true, episode: prepared.episode, row_version: prepared.row_version };
    const context = { ...await buildStageContext(task.stage, current.episode, task), ...overrides };
    const updated = await runStage(
      task.stage,
      current.episode,
      task.shot_no,
      context,
    );
    const written = await replaceEpisode(task.episode_id, current.row_version, updated);
    if (!written.ok) {
      // Lost a write race or the transition became illegal between our
      // read and write — requeue so the next attempt re-reads fresh state,
      // same MAX_LOCAL_ATTEMPTS budget as a stage failure.
      await failTask(task.task_id, { requeue: task.attempt < MAX_LOCAL_ATTEMPTS });
      return;
    }
    await completeTask(task.task_id);

    if (task.stage === "assets" && updated.status === "keyframing") {
      for (const shot of updated.shots.filter((item) => item.status === "draft")) {
        await enqueueTask({ episode_id: task.episode_id, stage: "keyframe", shot_no: shot.no });
      }
    }

    const nextStage = AUTO_ADVANCE[updated.status];
    if (nextStage) {
      await enqueueTask({ episode_id: task.episode_id, stage: nextStage });
    }
  } catch (err) {
    if (err instanceof ContentBlockedError) {
      // 内容审核拦截是确定性失败，重试也还是命中同样的词——不重试，直接
      // 把期标成 failed（同 packages/cli/src/run-stage.ts 的失败写回方式）。
      await failTask(task.task_id, { requeue: false });
      await patchEpisode(task.episode_id, current.row_version, { status: "failed" });
      return;
    }
    const retry = task.attempt < MAX_LOCAL_ATTEMPTS;
    await failTask(task.task_id, { requeue: retry });
    if (!retry) {
      const fresh = await getEpisode(task.episode_id);
      if (fresh.ok) {
        const target = generationStatus(task.stage);
        const shot = fresh.episode.shots.find((item) => item.no === task.shot_no);
        if (target && shot?.status === target) {
          await patchShot(task.episode_id, shot.no, fresh.row_version, { status: "failed" });
        } else if (!target && ["scripting", "assets", "composing"].includes(fresh.episode.status)) {
          await patchEpisode(task.episode_id, fresh.row_version, { status: "failed" });
        }
      }
    }
  }
}
