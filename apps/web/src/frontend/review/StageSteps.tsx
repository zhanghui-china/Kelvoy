import type { Episode, EpisodeStatus, VideoSource } from "@kelvoy/engine";
import type { FailedTaskSummary } from "../api/client";

export type StageId = "project" | "script" | "keyframes" | "clips" | "compose" | "final";
export interface EpisodeStage { id: StageId; states: EpisodeStatus[]; label: string; available: boolean; }

const STAGES: Omit<EpisodeStage, "available">[] = [
  { id: "project", states: ["draft"], label: "① 创建项目" },
  { id: "script", states: ["scripting", "script_review"], label: "② 分镜脚本" },
  { id: "keyframes", states: ["assets", "keyframing", "kf_review"], label: "③ 关键帧" },
  { id: "clips", states: ["clipping", "clip_review"], label: "④ 视频片段" },
  { id: "compose", states: ["compose_ready", "composing"], label: "⑤ 合成预览" },
  { id: "final", states: ["done"], label: "⑥ 成片分享" },
];

const DIRECT_STAGES: typeof STAGES = [
  { id: "project", states: ["draft"], label: "① 创建项目" },
  { id: "script", states: ["scripting", "script_review"], label: "② 分镜脚本" },
  { id: "clips", states: ["assets", "clipping", "clip_review"], label: "③ 视频片段" },
  { id: "compose", states: ["compose_ready", "composing"], label: "④ 合成预览" },
  { id: "final", states: ["done"], label: "⑤ 成片分享" },
];

const FAILURE_STAGE_INDEX: Record<FailedTaskSummary["stage"], number> = {
  brief: 0, script: 1, assets: 2, keyframe: 2, video: 3, compose: 4,
};

const FAILURE_STAGE_LABEL: Record<FailedTaskSummary["stage"], string> = {
  brief: "创建项目", script: "分镜脚本", assets: "准备素材",
  keyframe: "关键帧", video: "视频片段", compose: "合成预览",
};

export function failedStageLabel(task: FailedTaskSummary): string {
  return FAILURE_STAGE_LABEL[task.stage];
}

const REVIEW_HINTS: Partial<Record<EpisodeStatus, string>> = {
  script_review: "请审核分镜脚本",
  kf_review: "请审核关键帧",
  clip_review: "请审核视频片段",
  compose_ready: "请确认合成设置",
};

/** Availability follows real progress; unknown failures need evidence from saved content. */
export function episodeStages(episode: Episode, failedTask?: FailedTaskSummary | null): EpisodeStage[] {
  const stages = episode.video_source === "references" ? DIRECT_STAGES : STAGES;
  const current = currentStageIndex(episode.status, failedTask, episode.video_source);
  const evidence: Record<StageId, boolean> = {
    project: true,
    script: episode.shots.length > 0,
    keyframes: episode.grid_refs.length > 0 || episode.shots.some(s => s.candidates.length > 0 || !!s.kf_selected),
    clips: episode.shots.some(s => !!s.clip),
    compose: !!episode.final,
    final: !!episode.final,
  };
  return stages.map((stage, index) => ({ ...stage, available: current < 0
    ? evidence[stage.id] : index <= current || evidence[stage.id] || !!episode.final }));
}

export function currentEpisodeStage(episode: Episode, failedTask?: FailedTaskSummary | null): StageId | null {
  const stages = episode.video_source === "references" ? DIRECT_STAGES : STAGES;
  return stages[currentStageIndex(episode.status, failedTask, episode.video_source)]?.id ?? null;
}

function currentStageIndex(status: EpisodeStatus, failedTask?: FailedTaskSummary | null, videoSource?: VideoSource) {
  const stages = videoSource === "references" ? DIRECT_STAGES : STAGES;
  return status === "failed"
    ? (failedTask ? videoSource === "references" && FAILURE_STAGE_INDEX[failedTask.stage] > 2
      ? FAILURE_STAGE_INDEX[failedTask.stage] - 1 : FAILURE_STAGE_INDEX[failedTask.stage] : -1)
    : stages.findIndex(stage => stage.states.includes(status));
}

export default function StageSteps({ status, failedTask, videoSource, stages: navigationStages, selectedStage, onSelect }: {
  status: EpisodeStatus; failedTask?: FailedTaskSummary | null; videoSource?: VideoSource;
  stages?: EpisodeStage[]; selectedStage?: StageId | null; onSelect?: (stage: StageId) => void;
}) {
  const stages = navigationStages ?? (videoSource === "references" ? DIRECT_STAGES : STAGES);
  const direct = videoSource === "references";
  const current = currentStageIndex(status, failedTask, videoSource);
  const failure = status === "failed";
  const completed = status === "done";
  const unknownFailure = failure && !failedTask;
  const directAssetsFailure = failure && direct && failedTask?.stage === "assets";
  return <div className="k-desk-progress"><ol className="k-desk-steps" aria-label="创作进度">
    {stages.map((stage, index) => {
      const content = <>{directAssetsFailure && index === current ? "③ 素材准备与视频片段" : stage.label}
        <span className="k-desk-step-state">{unknownFailure ? "阶段未知" : completed ? "已完成" : index === current ? directAssetsFailure ? "准备素材失败" : failure ? "失败阶段" : "当前阶段" : index < current ? "已完成" : navigationStages?.[index].available ? "已保存 · 可回看" : "待开始"}</span></>;
      return <li key={stage.id}
        className={`k-desk-step ${index === current && !completed ? failure ? "is-failed" : "is-current" : ""} ${index < current || completed ? "is-done" : ""} ${selectedStage === stage.id ? "is-viewing" : ""}`}
        aria-current={index === current && !completed ? "step" : undefined}>
        {onSelect ? <button type="button" data-stage={stage.id} className="k-desk-step-button"
          disabled={navigationStages ? !navigationStages[index].available : index > current}
          aria-pressed={selectedStage === stage.id} onClick={() => onSelect(stage.id)}>{content}</button> : content}
      </li>;
    })}
  </ol>{unknownFailure && <p className="k-desk-review-hint">生成失败，阶段未知</p>}{REVIEW_HINTS[status] && <p className="k-desk-review-hint">{REVIEW_HINTS[status]}</p>}</div>;
}
