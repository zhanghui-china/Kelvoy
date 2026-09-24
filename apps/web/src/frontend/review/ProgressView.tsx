import type { Episode, EpisodeStatus } from "@kelvoy/engine";
import { patchEpisode } from "../api/client";
import { EPISODE_STATUS_LABELS } from "../labels";
import { MutationError } from "./ShotHeader";
import type { EpisodeMutation } from "./useEpisodeMutation";

// 六阶段 + 三审核点的横向步骤条（PRD §4 的流水线顺序）。draft 归到第一步，
// failed 不在条上——失败是旁支，单独提示。
const STEPS: { status: EpisodeStatus; label: string }[] = [
  { status: "scripting", label: "生成脚本" },
  { status: "script_review", label: "审核 1 · 脚本" },
  { status: "assets", label: "准备素材" },
  { status: "keyframing", label: "生成关键帧" },
  { status: "kf_review", label: "审核 2 · 关键帧" },
  { status: "clipping", label: "生成片段" },
  { status: "clip_review", label: "审核 3 · 片段" },
  { status: "composing", label: "合成" },
  { status: "done", label: "完成" },
];

function stepIndex(status: EpisodeStatus): number {
  if (status === "draft") return 0;
  return STEPS.findIndex((s) => s.status === status);
}

/**
 * 重试只把期的 status 推回对应的生成态（PATCH /api/episodes/:id），不自己
 * 往队列里塞任务——"失败后怎么重新入队"目前是 worker/CLI（`run <stage>`）
 * 那边的事，审片台不该替它决定重跑哪一条任务，#31 不加新的重试路由。
 *
 * failed 的期不记录"失败前在哪个阶段"（§6 的状态机只有一个 failed），只能
 * 从镜的形态反推。反推不出来就返回 null、不显示重试按钮——猜错会把期推进
 * 一个跑不动的阶段，比让用户找不到按钮更糟。
 */
function inferRetryTarget(episode: Episode): EpisodeStatus | null {
  if (episode.shots.length === 0) return "scripting";
  if (episode.shots.every((s) => s.status === "approved")) return "composing";
  if (episode.shots.some((s) => s.clip !== null || s.status === "generating_clip")) return "clipping";
  if (episode.shots.some((s) => s.candidates.length > 0 || s.status === "generating_kf")) {
    return "keyframing";
  }
  return null;
}

export default function ProgressView({
  episode,
  mutation,
}: {
  episode: Episode;
  mutation: EpisodeMutation;
}) {
  const current = stepIndex(episode.status);
  const retryTarget = episode.status === "failed" ? inferRetryTarget(episode) : null;
  const doneShots = episode.shots.filter((s) => s.status === "approved").length;
  const readyShots = episode.shots.filter(
    (s) => s.status === "kf_ready" || s.status === "kf_selected" || s.status === "clip_ready",
  ).length;

  return (
    <section className="k-desk-main">
      <ol className="k-desk-steps">
        {STEPS.map((step, index) => (
          <li
            key={step.status}
            className={`k-desk-step ${index === current ? "is-current" : ""} ${
              current >= 0 && index < current ? "is-done" : ""
            }`}
            aria-current={index === current ? "step" : undefined}
          >
            {step.label}
          </li>
        ))}
      </ol>

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
      {retryTarget && (
        <div className="k-desk-actions">
          <button
            type="button"
            className="k-btn k-btn-primary"
            disabled={mutation.pending}
            onClick={() =>
              mutation.run((rowVersion) =>
                patchEpisode(episode.episode_id, rowVersion, { status: retryTarget }),
              )
            }
          >
            重试「{EPISODE_STATUS_LABELS[retryTarget]}」
          </button>
        </div>
      )}
    </section>
  );
}
