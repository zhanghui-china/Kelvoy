import { Link } from "react-router-dom";
import type { OnboardingState } from "./onboarding";

const STEPS = ["新建一期", "审核脚本", "选定全部关键帧", "批准全部片段", "完成成片"];

export function OnboardingChecklist({ completed, href, failed, targetDone, collapsed, pending, onToggle, onDismiss }: OnboardingState & {
  collapsed: boolean;
  pending: boolean;
  onToggle: () => void;
  onDismiss: () => void;
}) {
  const done = completed.filter(Boolean).length;
  return (
    <section className="k-card k-onboarding" aria-labelledby="onboarding-title">
      <div className="k-onboarding-head">
        <div><div className="k-eyebrow">创作指引</div><h2 id="onboarding-title">第一段旅程</h2><p>{done}/5 步已完成</p></div>
        <button type="button" className="k-onboarding-text-button" aria-expanded={!collapsed} aria-controls="onboarding-content" onClick={onToggle}>
          {collapsed ? "展开引导" : "收起引导"}
        </button>
      </div>
      <div id="onboarding-content" hidden={collapsed}>
        <ol className="k-onboarding-steps">
          {STEPS.map((label, index) => <li key={label} className={completed[index] ? "is-complete" : ""}>
            <span className="k-onboarding-step-mark" aria-hidden="true">{completed[index] ? "✓" : index + 1}</span>
            <span>{label}</span><span className="k-onboarding-step-state">{completed[index] ? "已完成" : "待完成"}</span>
          </li>)}
        </ol>
        <div className="k-onboarding-actions">
          <Link className="k-btn k-btn-primary" to={href}>{failed ? "查看失败并重试" : targetDone ? "查看成片" : done === 0 ? "新建一期" : "继续当前作品"} →</Link>
          <button type="button" className="k-onboarding-text-button" disabled={pending} onClick={onDismiss}>隐藏引导</button>
        </div>
      </div>
    </section>
  );
}
