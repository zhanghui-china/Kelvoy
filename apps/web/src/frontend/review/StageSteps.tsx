import type { EpisodeStatus } from "@kelvoy/engine";
import type { FailedTaskSummary } from "../api/client";

const STAGES: { states: EpisodeStatus[]; label: string }[] = [
  { states: ["draft"], label: "① 创建项目" },
  { states: ["scripting", "script_review"], label: "② 分镜脚本" },
  { states: ["assets", "keyframing", "kf_review"], label: "③ 关键帧" },
  { states: ["clipping", "clip_review"], label: "④ 视频片段" },
  { states: ["compose_ready", "composing"], label: "⑤ 合成预览" },
  { states: ["done"], label: "⑥ 成片分享" },
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

export default function StageSteps({ status, failedTask }: {
  status: EpisodeStatus; failedTask?: FailedTaskSummary | null;
}) {
  const current = status === "failed"
    ? (failedTask ? FAILURE_STAGE_INDEX[failedTask.stage] : -1)
    : STAGES.findIndex((stage) => stage.states.includes(status));
  return <ol className="k-desk-steps" aria-label="创作进度">
    {STAGES.map((stage, index) => <li key={stage.label}
      className={`k-desk-step ${index === current ? "is-current" : ""} ${index < current ? "is-done" : ""}`}
      aria-current={index === current ? "step" : undefined}>
      {stage.label}
    </li>)}
  </ol>;
}
