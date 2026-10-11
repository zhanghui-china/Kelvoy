import { useEffect, useState } from "react";
import { PromptVersions } from "./PromptVersions";
import { usePromptTraces } from "./usePromptTraces";

/**
 * ADR-0012: author-visible prompts sent to the model. Collapsed by default;
 * nothing is requested until the person first opens it.
 */
export default function PromptTrace({ episodeId, kind, shotId, shotNo, refreshKey, fallbackPrompt }: {
  episodeId: string;
  kind: "script" | "video";
  shotId?: string;
  shotNo?: number;
  refreshKey?: string | number | null;
  fallbackPrompt?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { controller, state } = usePromptTraces({ episodeId, kind, shotId, refreshKey });
  // Re-runs when the controller is replaced (shot switch) so an open panel reloads.
  useEffect(() => {
    if (open) controller.load();
    else controller.close();
  }, [open, controller]);

  const summary = kind === "script"
    ? "查看发给模型的脚本提示词"
    : `查看${shotNo !== undefined ? `第 ${shotNo} 镜` : "这一镜"}发给模型的提示词`;

  return <details className="k-prompt-trace" open={open}
    onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{summary}</summary>
    {open && <PromptVersions kind={kind} state={state} fallbackPrompt={fallbackPrompt}
      onRetry={() => controller.retry()} onLoadMore={() => controller.loadMore()} />}
  </details>;
}
