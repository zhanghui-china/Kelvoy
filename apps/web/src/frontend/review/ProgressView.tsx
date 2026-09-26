import type { Episode } from "@kelvoy/engine";
import { retryFailedTask } from "../api/client";
import { EPISODE_STATUS_LABELS } from "../labels";
import { MutationError } from "./ShotHeader";
import type { EpisodeMutation } from "./useEpisodeMutation";

export default function ProgressView({
  episode,
  mutation,
}: {
  episode: Episode;
  mutation: EpisodeMutation;
}) {
  const retryAvailable = episode.status === "failed" || episode.shots.some((shot) => shot.status === "failed");
  const doneShots = episode.shots.filter((s) => s.status === "approved").length;
  const readyShots = episode.shots.filter(
    (s) => s.status === "kf_ready" || s.status === "kf_selected" || s.status === "clip_ready",
  ).length;

  return (
    <section className="k-desk-main">
      <div className="k-card">
        <div className="k-card-title">{EPISODE_STATUS_LABELS[episode.status]}</div>
        {episode.status === "failed" ? (
          <p className="k-error" role="alert">
            这一期失败了。产物和已有的镜都还在，重试只会重跑失败的那个阶段。
          </p>
        ) : (
          <p className="k-card-meta">后台正在跑，页面每 3 秒自动刷新一次。</p>
        )}
        <div className="k-card-meta">
          共 {episode.shots.length} 镜 · 已通过 {doneShots} 镜 · 有产物 {readyShots} 镜
        </div>
      </div>

      <MutationError error={mutation.error} />
      {retryAvailable && (
        <div className="k-desk-actions">
          <button
            type="button"
            className="k-btn k-btn-primary"
            disabled={mutation.pending}
            onClick={() =>
              mutation.run((rowVersion) => retryFailedTask(episode.episode_id, rowVersion))
            }
          >
            重新执行失败任务
          </button>
        </div>
      )}
    </section>
  );
}
