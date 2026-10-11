import type { PromptTraceItem, PromptTraceLegacy } from "../../shared/prompt-traces";
import type { PromptTraceState } from "./prompt-trace-controller";
import { PromptBlock } from "./PromptBlock";

const SOURCE_LABELS = { llm: "模型生成", cache: "命中缓存，沿用此前改写结果" } as const;
const SCRIPT_KIND_LABELS: Record<string, string> = { script_generate: "生成", script_revision: "优化" };

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function Version({ item, no, open, script }: { item: PromptTraceItem; no: number; open: boolean; script: boolean }) {
  const name = `第 ${no} 版`;
  const scriptLabel = SCRIPT_KIND_LABELS[item.kind];
  return <li>
    <details className="k-prompt-version" open={open}>
      <summary>
        <span className="k-prompt-version-title">{name}{no === 1 ? "（最新）" : ""}</span>
        <span className="k-card-meta">
          <time dateTime={item.created_at}>{formatTime(item.created_at)}</time>
          {" · "}{SOURCE_LABELS[item.source]}
          {" · "}{item.validated ? "通过" : "未通过校验"}
        </span>
      </summary>
      <div className="k-prompt-version-body">
        {(script || !item.validated || item.attempt > 1) && <p className="k-card-meta">
          {script && scriptLabel && `${scriptLabel}${item.round !== null ? ` · 第 ${item.round} 轮` : ""}`}
          {!script && item.attempt > 1 && `第 ${item.attempt} 次尝试`}
          {!item.validated && item.rule && `${script || item.attempt > 1 ? " · " : ""}校验规则：${item.rule}`}
        </p>}
        {item.truncated && <p className="k-card-meta">内容过长，已截断</p>}
        <PromptBlock title="发给模型的消息" text={item.user_message} copyName={`${name} 发给模型的消息`} />
        {item.correction_message !== null && item.correction_message !== "" &&
          <PromptBlock title="格式纠正消息" text={item.correction_message} copyName={`${name} 格式纠正消息`} />}
        {item.rejected_output !== null && item.rejected_output !== "" &&
          <PromptBlock title="被校验拒绝的模型输出" text={item.rejected_output}
            copyName={`${name} 被校验拒绝的模型输出`} />}
        {item.final_prompt !== null && item.final_prompt !== "" &&
          <PromptBlock title="最终发给视频模型的提示词" text={item.final_prompt} lang="en"
            copyName={`${name} 最终发给视频模型的提示词`} />}
      </div>
    </details>
  </li>;
}

function LegacyFinal({ prompt }: { prompt: string }) {
  return <div className="k-prompt-version k-prompt-legacy">
    <p className="k-prompt-version-title">历史记录（仅保留最终提示词）</p>
    <p className="k-card-meta">此作品生成于提示词记录上线之前，只保留了最终发给视频模型的提示词。</p>
    <PromptBlock title="最终发给视频模型的提示词" text={prompt} lang="en" copyName="历史记录 最终发给视频模型的提示词" />
  </div>;
}

function legacyPrompt(legacy: PromptTraceLegacy | null, fallback: string | null | undefined): string | null {
  if (legacy) return legacy.note === "final_only" ? legacy.final_prompt : null;
  return fallback ? fallback : null;
}

/** Pure presentation of the prompt-trace state machine (ADR-0012). */
export function PromptVersions({ kind, state, fallbackPrompt, onRetry, onLoadMore }: {
  kind: "script" | "video"; state: PromptTraceState; fallbackPrompt?: string | null;
  onRetry: () => void; onLoadMore: () => void;
}) {
  if (state.status === "idle" || state.status === "loading") {
    return <p className="k-empty" role="status" aria-live="polite">正在读取提示词…</p>;
  }
  if (state.status === "error") {
    return <div className="k-error-state">
      <p className="k-error" role="alert">提示词暂时读取失败，请重试。</p>
      <button type="button" className="k-btn k-btn-secondary k-btn-tiny" onClick={onRetry}>重试</button>
    </div>;
  }
  if (state.status === "empty") {
    const prompt = legacyPrompt(state.legacy, fallbackPrompt);
    if (prompt) return <LegacyFinal prompt={prompt} />;
    return <p className="k-empty">此作品生成于提示词记录上线之前，没有保留当时的提示词</p>;
  }

  const script = kind === "script";
  // Group consecutive items of the same execution (attempt); video stays flat.
  const groups: { attempt: number; entries: { item: PromptTraceItem; no: number }[] }[] = [];
  state.items.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (last && (!script || last.attempt === item.attempt)) last.entries.push({ item, no: index + 1 });
    else groups.push({ attempt: item.attempt, entries: [{ item, no: index + 1 }] });
  });
  const showRuns = script && groups.length > 1;

  return <div className="k-prompt-versions">
    <p className="k-card-meta">按时间倒序，第 1 版为最新。</p>
    {groups.map((group) => <section key={`${group.attempt}:${group.entries[0].item.id}`}>
      {showRuns && <p className="k-prompt-run">第 {group.attempt} 次执行</p>}
      <ol className="k-prompt-list">
        {group.entries.map(({ item, no }) => <Version key={item.id} item={item} no={no} open={no === 1} script={script} />)}
      </ol>
    </section>)}
    {state.moreFailed && <p className="k-error" role="alert">加载更早版本失败，请重试。</p>}
    {state.nextBefore !== null && <div className="k-desk-actions">
      <button type="button" className="k-btn k-btn-secondary k-btn-tiny" disabled={state.loadingMore} onClick={onLoadMore}>
        {state.loadingMore ? "正在加载…" : "加载更早版本"}
      </button>
      {state.loadingMore && <span className="k-card-meta" role="status" aria-live="polite">正在加载更早版本…</span>}
    </div>}
  </div>;
}
