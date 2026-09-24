import { type StageName, runStage, transitionEpisode } from "@kelvoy/engine";
import { getDestination, getEpisode, patchEpisode, replaceEpisode } from "@kelvoy/store";

/**
 * 已知限制（M1-13, #28）：`run compose` 在 CLI 里跑不通，会拿到 engine 的
 * "compose 阶段需要 ComposeProvider" 错误。ffmpeg 实现在 apps/worker
 * （CLAUDE.md：compose 只在 worker 上跑），而 packages/cli 不能 import
 * apps/*——那会让内部工具反向依赖一个应用。
 *
 * 现在合成只能通过 worker 的任务队列触发（apps/web 的
 * POST /api/episodes/:id/recompose，或手工 enqueueTask）。以后要让 CLI 也能
 * 直接跑，正解是把 provider 实现下沉成一个独立包（比如 @kelvoy/providers），
 * worker 和 cli 都依赖它——等第二个调用方真出现时再做，现在不提前拆。
 */
export type RunStageResult = { ok: true; row_version: number } | { ok: false; error: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Drives one pipeline stage for a single episode (M1-7) — the CLI's manual
 * equivalent of apps/worker's automated queue consumer (PRD §2: CLI is an
 * internal validation tool, not customer-facing). No retry/requeue logic
 * here (unlike the worker) since a human re-runs `run` by hand.
 */
export async function runEpisodeStage(episodeId: string, stage: StageName): Promise<RunStageResult> {
  const result = await getEpisode(episodeId);
  if (!result.ok) {
    return { ok: false, error: `期不存在：${episodeId}` };
  }

  // Fail fast if the episode can't advance at all right now (e.g. already
  // done/failed) — don't bother invoking the stage.
  try {
    transitionEpisode(result.episode.status, { type: "advance" });
  } catch {
    return {
      ok: false,
      error: `当前状态 "${result.episode.status}" 无法推进，不会运行阶段 ${stage}`,
    };
  }

  try {
    // Engine stages don't touch @kelvoy/store (CLAUDE.md directory table) —
    // "script" needs the destination record, so it's fetched here and
    // threaded through as context. Other stages ignore it for now.
    const destination = await getDestination(result.episode.destination_id);
    const updated = await runStage(stage, result.episode, undefined, destination ? { destination } : undefined);
    const written = await replaceEpisode(episodeId, result.row_version, updated);
    if (!written.ok) {
      return { ok: false, error: `写回失败：${written.error}` };
    }
    return { ok: true, row_version: written.row_version };
  } catch (err) {
    // Best-effort: only succeeds if the current status is a generating
    // state (@kelvoy/engine's state machine) — status "draft" (the stage
    // "brief" runs from) has no legal path to "failed" yet, so this
    // silently no-ops there. Not a bug to fix in this issue: a
    // state-machine gap for whichever stage owns "draft", left for when
    // that stage is actually implemented.
    await patchEpisode(episodeId, result.row_version, { status: "failed" });
    return { ok: false, error: `阶段 ${stage} 失败：${errorMessage(err)}` };
  }
}
