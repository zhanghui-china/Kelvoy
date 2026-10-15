import { useRef, type ReactNode } from "react";
import type { Episode } from "@kelvoy/engine";
import { episodeFileUrl, reopenStage, setEpisodeShare, shareUrl } from "../api/client";
import { GuideTip } from "../GuideTip";
import ShareActions from "./ShareActions";
import UpgradeLongCutsCard, { canUpgradeToLongCuts } from "./UpgradeLongCutsCard";
import { MutationError } from "./ShotHeader";
import { tally } from "./tally";
import type { EpisodeMutation } from "./useEpisodeMutation";
import "./DoneView.css";

/** Old episodes had a fixed key; new deliveries carry their versioned key. */
function finalKey(episode: Episode): string {
  return episode.final?.key ?? `final/${episode.episode_id}.mp4`;
}

export default function DoneView({
  episode,
  mutation,
  storyboard,
}: {
  episode: Episode;
  mutation: EpisodeMutation;
  storyboard?: ReactNode;
}) {
  const submitting = useRef(false);
  async function reopen(stage: "compose" | "clips") {
    if (submitting.current || mutation.pending) return;
    submitting.current = true;
    try {
      await mutation.run(rowVersion => reopenStage(episode.episode_id, rowVersion, stage));
    } finally {
      submitting.current = false;
    }
  }
  const url = episodeFileUrl(episode.episode_id, finalKey(episode));
  const rows = tally(episode);
  const totalCost = rows.reduce((sum, row) => sum + row.costUsd, 0);
  const final = episode.final;
  const aspectRatio = final?.width && final.height ? `${final.width}/${final.height}` :
    episode.brief.aspect === "16:9" ? "16/9" : "9/16";

  if (episode.status === "composing") {
    return (
      <section className="k-desk-main">
        <div className="k-card-title">合成中</div>
        <p className="k-empty">ffmpeg 正在合成成片，页面每 3 秒自动刷新。</p>
      </section>
    );
  }

  return (
    <section className="k-desk-main">
      <div className="k-card-title">成片 · {episode.render.title || episode.name}</div>
      {(episode as Episode & { final_needs_recompose?: boolean }).final_needs_recompose &&
        <p role="status">分镜或合成设置已修改，当前为上一版成片；下载与分享保留上一版，重新合成后更新。</p>}
      <GuideTip section="deliver">先完整播放成片，再下载或开启分享链接。</GuideTip>
      <div className="k-delivery-preview">
        <video className="k-media k-desk-final" style={{ aspectRatio }} src={url} controls aria-label="成片" />
        <div className="k-delivery-detail">
          <p className="k-card-meta">请先完整播放并检查画面、字幕与声音，再交付作品。</p>
          {final ? <p className="k-card-meta">
            {final.duration_s.toFixed(1)} 秒 · {final.width}×{final.height} · {final.fps} fps · {(final.size_bytes / 1024 / 1024).toFixed(1)} MB · {new Date(final.completed_at).toLocaleString()}
          </p> : <p className="k-card-meta">旧版作品未记录成片规格，仍可播放和下载已有文件。</p>}
          <a className="k-btn k-btn-primary" href={url} download>下载 MP4 成片</a>
        </div>
      </div>
      <p className="k-card-meta">{episode.cut_policy === "long_3_6" ? `每镜 3–6 秒，目标约 ${episode.brief.duration_s} 秒，片头片尾计入` : episode.cut_policy === "fixed_1s" ? "每镜 1 秒" : "沿用旧项目的节拍切点"}</p>
      {canUpgradeToLongCuts(episode) && <UpgradeLongCutsCard episode={episode} mutation={mutation}
        title="升级为 3–6 秒长镜头" hint="保留片段，逐镜重新确认起点。升级后旧成片暂停交付，完成新版合成后可恢复分享。" />}
      {storyboard}

      <div className="k-card k-share-card">
        <div className="k-card-title">分享</div>
        {episode.share.enabled ? (
          <>
            <div className="k-share-row">
              <input className="k-share-input" readOnly value={shareUrl(episode.share.slug)} />
            </div>
            <button
              type="button"
              className="k-btn k-btn-secondary"
              disabled={mutation.pending}
              onClick={() => mutation.run((rowVersion) => setEpisodeShare(episode.episode_id, rowVersion, false))}
            >
              关闭分享
            </button>
          </>
        ) : (
          <button
            type="button"
            className="k-btn k-btn-primary"
            disabled={mutation.pending}
            onClick={() => mutation.run((rowVersion) => setEpisodeShare(episode.episode_id, rowVersion, true))}
          >
            开启分享
          </button>
        )}
        <div className="k-card-meta">分享页不含账号信息，链接不随 90 天清理失效（FR-12）。</div>
        <ShareActions episode={episode} />
      </div>

      <div className="k-card">
        <div className="k-card-title">成本报告</div>
        <div className="k-card-meta">
          预估 <span className="k-mono">{episode.estimated_credits}</span> 积分 · 实际用掉{" "}
          <span className="k-mono">{episode.credits_used}</span> 积分
        </div>
        {rows.length === 0 ? (
          <p className="k-empty">还没有模型调用记录。</p>
        ) : (
          <div className="k-desk-tablewrap">
            <table className="k-desk-table">
              <thead>
                <tr>
                  <th>provider</th>
                  <th>模型</th>
                  <th>镜次</th>
                  <th>尝试次数</th>
                  <th>成本 (USD)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.provider}/${row.model}`}>
                    <td>{row.provider}</td>
                    <td>{row.model}</td>
                    <td className="k-mono">{row.shots}</td>
                    <td className="k-mono">{row.attempts}</td>
                    <td className="k-mono">{row.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4}>合计</td>
                  <td className="k-mono">{totalCost.toFixed(4)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <MutationError error={mutation.error} />
      <div className="k-card">
        <div className="k-card-title">还想调整？</div>
        <p className="k-card-meta">字幕、配乐和重新合成在「配乐合成」；单镜重做在「视频片段」。回去不会重跑任何镜头，也不会丢掉当前成片。</p>
        <div className="k-desk-actions">
          <button type="button" className="k-btn k-btn-secondary" disabled={mutation.pending}
            onClick={() => void reopen("compose")}>
            调整字幕/配乐 → 回到配乐合成
          </button>
          <button type="button" className="k-btn k-btn-secondary" disabled={mutation.pending}
            onClick={() => void reopen("clips")}>
            某镜不满意 → 回到视频片段
          </button>
        </div>
      </div>
    </section>
  );
}
