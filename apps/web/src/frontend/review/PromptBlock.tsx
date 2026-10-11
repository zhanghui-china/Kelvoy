import { useState } from "react";

const MIN_ROWS = 3;
const MAX_ROWS = 14;

/**
 * One prompt text with a copy button.
 *
 * A readOnly <textarea> rather than <pre tabindex=0>: it scrolls on its own and
 * click/focus selects the whole text, and Ctrl/Cmd+A inside it selects only this
 * block, so a person without clipboard permission can still select and copy by
 * hand. Content is always a text value, never markup.
 */
export function PromptBlock({ title, text, copyName, lang }: {
  title: string; text: string; /** Accessible name, e.g. "第 2 版 发给模型的消息". */ copyName: string; lang?: string;
}) {
  const [feedback, setFeedback] = useState("");
  const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, text.split("\n").length));

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback("已复制");
    } catch {
      setFeedback("复制失败，请手动选择文本复制");
    }
  }

  return <div className="k-prompt-block">
    <div className="k-prompt-block-head">
      <span className="k-card-meta">{title}</span>
      <button type="button" className="k-btn k-btn-secondary k-btn-tiny" aria-label={`复制${copyName}`}
        onClick={() => void copy()}>复制</button>
    </div>
    <textarea className="k-prompt-text" readOnly value={text} rows={rows} lang={lang} spellCheck={false}
      aria-label={copyName}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.currentTarget.select()} />
    <p className="k-card-meta k-prompt-feedback" role="status" aria-live="polite">{feedback}</p>
  </div>;
}
