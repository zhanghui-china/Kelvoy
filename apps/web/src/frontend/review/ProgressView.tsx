import type { Episode } from "@kelvoy/engine";
import { useRef, useState } from "react";
import { retryFailedTask } from "../api/client";
import type { FailedTaskSummary } from "../api/client";
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
}: {
  episode: Episode;
  mutation: EpisodeMutation;
  failedTask?: FailedTaskSummary | null;
}) {
  const submitting = useRef(false);
  // Hide the action immediately after success, until refreshed episode data
  // supplies the authoritative failed-task summary (or a new failure).
  const [queuedEpisode, setQueuedEpisode] = useState<Episode | null>(null);
  const retryQueued = queuedEpisode === episode;
  const hasFailure = episode.status === "failed" || episode.shots.some((shot) => shot.status === "failed");
  const canRetry = hasFailure && !!failedTask && !retryQueued;

  async function retry() {
    if (submitting.current || mutation.pending || retryQueued) return;
    submitting.current = true;
    try {
      const result = await mutation.run((rowVersion) => retryFailedTask(episode.episode_id, rowVersion));
      if (result?.ok) setQueuedEpisode(episode);
    } finally {
      submitting.current = false;
    }
  }
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
    <section className="k-desk-main">
      <GuideTip section={guideSection}>{canRetry ? "生成失败时可重新执行失败任务；已完成的产物会保留。"
        : hasFailure ? "当前没有可重试的失败任务；页面会自动刷新。"
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
            {episode.failure_reason ?? "生成失败。产物和已有的镜都还在，重试只会重跑失败的阶段。"}
          </p>
        ) : retryQueued ? (
          <p className="k-card-meta" role="status">失败任务已排队重试，等待后台处理。页面会自动刷新。</p>
        ) : hasFailure && episode.status === "failed" ? (
          <p className="k-error" role="alert">
            {episode.failure_reason ?? "生成失败。"} 未找到可重试的失败任务，请刷新页面确认最新状态。
          </p>
        ) : hasFailure ? (
          <p className="k-card-meta" role="status">当前没有可重试的失败任务；可能已排队重试，等待后台处理。页面会自动刷新。</p>
        ) : (
          <p className="k-card-meta">后台正在跑，页面每 3 秒自动刷新一次。</p>
        )}
        <div className="k-card-meta">
          共 {episode.shots.length} 镜 · 已通过 {doneShots} 镜 · 有产物 {readyShots} 镜
        </div>
      </div>

      <MutationError error={mutation.error} />
      {canRetry && (
        <div className="k-desk-actions">
          <button
            type="button"
            className="k-btn k-btn-primary"
            disabled={mutation.pending}
            onClick={retry}
          >
            {mutation.pending ? "正在提交重试…" : "重新执行失败任务"}
          </button>
        </div>
      )}
    </section>
  );
}
