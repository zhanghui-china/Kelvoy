import { useRef, useState } from "react";
import type { Episode } from "@kelvoy/engine";
import { retryFailedTask } from "../api/client";
import type { ShotFailureSummary } from "../api/client";
import type { EpisodeMutation } from "./useEpisodeMutation";

/**
 * 单镜重试的提交状态。沿用 ProgressView 的做法：成功后按"当前 episode 对象"
 * 记下已排队，等下一次刷新带来新数据（新失败或新状态）再放开；submitting
 * ref 挡住同一 tick 内的重复点击。错误由 mutation.run 统一展示。
 */
export function useShotRetry(episode: Episode, mutation: EpisodeMutation) {
  const submitting = useRef(false);
  const [queued, setQueued] = useState<{ episode: Episode; shotNo: number } | null>(null);
  const isQueued = (shotNo: number) => queued?.episode === episode && queued.shotNo === shotNo;

  async function retry(shotNo: number) {
    if (submitting.current || mutation.pending || isQueued(shotNo)) return;
    submitting.current = true;
    try {
      const result = await mutation.run((rowVersion) =>
        retryFailedTask(episode.episode_id, rowVersion, { shotNo }));
      if (result?.ok) setQueued({ episode, shotNo });
    } finally {
      submitting.current = false;
    }
  }
  return { retry, isQueued, pending: mutation.pending };
}

export function ShotFailureNotice({ shot, failures, onRetry, pending = false, queued = false }: {
  shot?: { shot_id?: string; status: string };
  failures?: ShotFailureSummary[];
  /** 传入后，失败镜头的提示下方出现"重试这一镜"；没有则只显示原因。 */
  onRetry?: () => void;
  pending?: boolean;
  queued?: boolean;
}) {
  if (shot?.status !== "failed") return null;
  const failure = failures?.find(item => item.shot_id === shot.shot_id);
  return <>
    <p className="k-error" role="alert">{failure?.message ?? "历史任务未记录具体原因"}</p>
    {onRetry && <div className="k-desk-actions">
      <button type="button" className="k-btn k-btn-primary k-btn-tiny"
        disabled={pending || queued} onClick={onRetry}>
        {queued ? "已排队，等待后台处理" : pending ? "正在提交重试…" : "重试这一镜"}
      </button>
    </div>}
  </>;
}
