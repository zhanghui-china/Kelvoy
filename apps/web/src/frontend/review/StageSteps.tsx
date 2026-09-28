import type { EpisodeStatus, VideoSource } from "@kelvoy/engine";
import type { FailedTaskSummary } from "../api/client";

const STAGES: { states: EpisodeStatus[]; label: string }[] = [
  { states: ["draft"], label: "① 创建项目" },
  { states: ["scripting", "script_review"], label: "② 分镜脚本" },
  { states: ["assets", "keyframing", "kf_review"], label: "③ 关键帧" },
  { states: ["clipping", "clip_review"], label: "④ 视频片段" },
  { states: ["compose_ready", "composing"], label: "⑤ 合成预览" },
  { states: ["done"], label: "⑥ 成片分享" },
];

const DIRECT_STAGES: typeof STAGES = [
  { states: ["draft"], label: "① 创建项目" },
  { states: ["scripting", "script_review"], label: "② 分镜脚本" },
  { states: ["assets", "clipping", "clip_review"], label: "③ 视频片段" },
  { states: ["compose_ready", "composing"], label: "④ 合成预览" },
  { states: ["done"], label: "⑤ 成片分享" },
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

export default function StageSteps({ status, failedTask, videoSource }: {
  status: EpisodeStatus; failedTask?: FailedTaskSummary | null; videoSource?: VideoSource;
}) {
  const stages = videoSource === "references" ? DIRECT_STAGES : STAGES;
  const direct = stages === DIRECT_STAGES;
  const current = status === "failed"
    ? (failedTask ? direct && FAILURE_STAGE_INDEX[failedTask.stage] > 2
      ? FAILURE_STAGE_INDEX[failedTask.stage] - 1 : FAILURE_STAGE_INDEX[failedTask.stage] : -1)
    : stages.findIndex((stage) => stage.states.includes(status));
  const failure = status === "failed";
  return <div className="k-desk-progress"><ol className="k-desk-steps" aria-label="创作进度">
    {stages.map((stage, index) => <li key={stage.label}
      className={`k-desk-step ${index === current ? failure ? "is-failed" : "is-current" : ""} ${index < current ? "is-done" : ""}`}
      aria-current={index === current ? "step" : undefined}>
      {stage.label}
      <span className="k-desk-step-state">{index === current ? failure ? "失败阶段" : "当前阶段" : index < current ? "已完成" : "待开始"}</span>
    </li>)}
  </ol>{REVIEW_HINTS[status] && <p className="k-desk-review-hint">{REVIEW_HINTS[status]}</p>}</div>;
}
