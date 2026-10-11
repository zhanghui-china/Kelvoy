import type { Episode } from "@kelvoy/engine";
import { useRef, useState } from "react";
import { retryFailedTask } from "../api/client";
import type { FailedTaskSummary, ShotFailureSummary } from "../api/client";
import ComposeSetup from "./ComposeSetup";
import { GuideTip } from "../GuideTip";
import type { GuideSectionId } from "../guide";
import { EPISODE_STATUS_LABELS } from "../labels";
import { MutationError } from "./ShotHeader";
import { failedStageLabel } from "./StageSteps";
import type { EpisodeMutation } from "./useEpisodeMutation";

export default function ProgressView({
  episode,
  mutation,
  failedTask,
  failedTasks,
  shotFailures,
}: {
  episode: Episode;
  mutation: EpisodeMutation;
  failedTask?: FailedTaskSummary | null;
  failedTasks?: FailedTaskSummary[];
  shotFailures?: ShotFailureSummary[];
}) {
  const submitting = useRef(false);
  // Hide the action immediately after success, until refreshed episode data
  // supplies the authoritative failed-task summary (or a new failure).
  const [queuedEpisode, setQueuedEpisode] = useState<Episode | null>(null);
  const retryQueued = queuedEpisode === episode;
  const hasFailure = episode.status === "failed" || episode.shots.some((shot) => shot.status === "failed");
  // 只要显示失败就给重试：没有可重试的任务记录时，后端按镜头当前状态补发。
  const canRetry = hasFailure && !retryQueued;
  const failedShots = episode.shots.filter((shot) => shot.status === "failed");
  const failedCount = Math.max(failedTasks?.length ?? 0, failedShots.length);
  const showRetryAll = canRetry && failedCount >= 2 && failedTask?.stage !== "compose";

  async function retry(opts?: { shotNo?: number; all?: boolean }) {
    if (submitting.current || mutation.pending || retryQueued) return;
    submitting.current = true;
    try {
      const result = await mutation.run((rowVersion) => retryFailedTask(episode.episode_id, rowVersion, opts));
      if (result?.ok) setQueuedEpisode(episode);
    } finally {
      submitting.current = false;
    }
  }
  // 有任务记录时沿用"最近一个失败任务"；没有记录时明确指向失败镜头，让后端补发。
  const primaryRetry = failedTask ? undefined
    : failedShots.length === 1 ? { shotNo: failedShots[0].no }
    : failedShots.length > 1 ? { all: true } : undefined;
  const failedShot = failedTask?.shot_no != null ? episode.shots.find(shot => shot.no === failedTask.shot_no) : undefined;
  const failureMessage = failedTask?.shot_no != null
    ? shotFailures?.find(item => item.shot_id === failedShot?.shot_id)?.message ?? "历史任务未记录具体原因"
    : episode.failure_reason;
  const doneShots = episode.shots.filter((s) => s.status === "approved").length;
  const readyShots = episode.shots.filter(
    (s) => s.status === "kf_ready" || s.status === "kf_selected" || s.status === "clip_ready",
  ).length;
  const failedGuideSection: Record<FailedTaskSummary["stage"], GuideSectionId> = {
    brief: "create", script: "script", assets: episode.video_source === "references" ? "clips" : "keyframes", keyframe: "keyframes",
    video: "clips", compose: "compose",
  };
  const guideSection: GuideSectionId = canRetry && failedTask
    ? failedGuideSection[failedTask.stage]
    : episode.shots.length === 0 ? "script"
    : episode.shots.every((shot) => shot.status === "approved") ? "compose"
    : episode.shots.some((shot) => shot.clip || shot.status === "generating_clip" || shot.status === "clip_ready") ? "clips"
    : episode.video_source === "references" ? "clips" : "keyframes";

  return (
    <section className="k-desk-main" id="failure-retry">
      <GuideTip section={guideSection}>{canRetry ? "生成失败时可重新执行失败任务；已完成的产物会保留。"
        : hasFailure ? "失败任务已排队重试；页面会自动刷新。"
        : "生成在后台进行，页面会自动刷新；出现失败后可在这里重试。"}</GuideTip>
      <div className="k-card">
        <div className="k-card-title">{EPISODE_STATUS_LABELS[episode.status]}</div>
        {canRetry && failedTask && (
          <p className="k-card-meta">失败阶段：{failedStageLabel(failedTask)}
            {failedTask.shot_no !== null ? ` · 第 ${failedTask.shot_no} 镜` : ""}
          </p>
        )}
        {canRetry ? (
          <p className="k-error" role="alert">
            {failureMessage ?? "生成失败。产物和已有的镜都还在，重试只会重跑失败的阶段。"}
            {!failedTask && " 没有对应的任务记录，重试会按当前进度重新排队生成。"}
          </p>
        ) : retryQueued ? (
          <p className="k-card-meta" role="status">失败任务已排队重试，等待后台处理。页面会自动刷新。</p>
        ) : (
          <p className="k-card-meta">后台正在跑，页面每 3 秒自动刷新一次。</p>
        )}
        <div className="k-card-meta">
          共 {episode.shots.length} 镜 · 已通过 {doneShots} 镜 · 有产物 {readyShots} 镜
        </div>
      </div>

      <MutationError error={mutation.error} />
      {canRetry && failedTask?.stage === "compose" && <details open>
        <summary>调整合成设置</summary>
        <ComposeSetup episode={episode} mutation={mutation} retryFailed />
      </details>}
      {canRetry && failedTask?.stage !== "compose" && (
        <div className="k-desk-actions">
          <button
            type="button"
            className="k-btn k-btn-primary"
            disabled={mutation.pending}
            onClick={() => retry(primaryRetry)}
          >
            {mutation.pending ? "正在提交重试…" : "重新执行失败任务"}
          </button>
          {showRetryAll && (
            <button
              type="button"
              className="k-btn k-btn-secondary"
              disabled={mutation.pending}
              onClick={() => retry({ all: true })}
            >
              {mutation.pending ? "正在提交重试…" : `重试全部失败镜头（${failedCount}）`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
