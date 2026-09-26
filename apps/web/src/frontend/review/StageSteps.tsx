import type { EpisodeStatus } from "@kelvoy/engine";

const STAGES: { states: EpisodeStatus[]; label: string }[] = [
  { states: ["draft", "scripting"], label: "① 创建项目" },
  { states: ["script_review", "assets"], label: "② 分镜脚本" },
  { states: ["keyframing", "kf_review"], label: "③ 关键帧" },
  { states: ["clipping", "clip_review"], label: "④ 视频片段" },
  { states: ["compose_ready", "composing"], label: "⑤ 合成预览" },
  { states: ["done"], label: "⑥ 成片分享" },
];

export default function StageSteps({ status }: { status: EpisodeStatus }) {
  const current = STAGES.findIndex((stage) => stage.states.includes(status));
  return <ol className="k-desk-steps" aria-label="创作进度">
    {STAGES.map((stage, index) => <li key={stage.label}
      className={`k-desk-step ${index === current ? "is-current" : ""} ${index < current ? "is-done" : ""}`}
      aria-current={index === current ? "step" : undefined}>
      {stage.label}
    </li>)}
  </ol>;
}
