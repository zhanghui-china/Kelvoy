import type { Episode } from "@kelvoy/engine";
import { episodeFileUrl, recompose, regenShot, setEpisodeShare, shareUrl } from "../api/client";
import { MutationError } from "./ShotHeader";
import { tally } from "./tally";
import type { EpisodeMutation } from "./useEpisodeMutation";

/**
 * 成片文件名约定和 engine 的 `finalOutputKey(episodeId)`
 * （packages/engine/src/stages/compose.ts）保持一致。前端不 import engine
 * 的运行时代码（会把 providers/stages 一起拉进 bundle，见 #30 的取舍），
 * 所以这里手抄同一个字符串；改约定时两处一起改。
 */
function finalKey(episodeId: string): string {
  return `final/${episodeId}.mp4`;
}

export default function DoneView({
  episode,
  mutation,
}: {
  episode: Episode;
  mutation: EpisodeMutation;
}) {
  const url = episodeFileUrl(episode.episode_id, finalKey(episode.episode_id));
  const rows = tally(episode);
  const totalCost = rows.reduce((sum, row) => sum + row.costUsd, 0);

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
      <div className="k-card-title">成片</div>
      <video className="k-media k-desk-final" src={url} controls aria-label="成片" />
      <p className="k-card-meta">文件还没生成时播放器会是空的，那说明合成还没跑完。</p>
      <p>
        <a href={url} download>
          下载成片
        </a>
      </p>

      <div className="k-card k-share-card">
        <div className="k-card-title">分享</div>
        {episode.share.enabled ? (
          <>
            <div className="k-share-row">
              <input className="k-share-input" readOnly value={shareUrl(episode.share.slug)} />
              <button
                type="button"
                className="k-btn k-btn-secondary"
                onClick={() => navigator.clipboard?.writeText(shareUrl(episode.share.slug))}
              >
                复制链接
              </button>
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
      </div>

      <div className="k-card">
        <div className="k-card-title">成本报告</div>
        <div className="k-card-meta">
          预估 <span className="k-mono">{episode.estimated_credits}</span> GPU 分钟 · 实际用掉{" "}
          <span className="k-mono">{episode.credits_used}</span> GPU 分钟
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
        <div className="k-card-title">重做镜头</div>
        <p className="k-card-meta">选一镜重生成；审核新结果后再合成。其他已通过的镜头继续保留。</p>
        {episode.shots.map((shot) => (
          <div className="k-desk-actions" key={shot.no}>
            <span className="k-card-meta">第 {shot.no} 镜 · {shot.beat}</span>
            <button type="button" className="k-btn k-btn-secondary k-btn-tiny"
              disabled={mutation.pending}
              onClick={() => mutation.run((rowVersion) =>
                regenShot(episode.episode_id, shot.no, rowVersion, "keyframe"))}>
              重生成关键帧
            </button>
            <button type="button" className="k-btn k-btn-secondary k-btn-tiny"
              disabled={mutation.pending || !shot.kf_selected}
              onClick={() => mutation.run((rowVersion) =>
                regenShot(episode.episode_id, shot.no, rowVersion, "video"))}>
              重生成视频
            </button>
          </div>
        ))}
      </div>
      <div className="k-desk-actions">
        <button
          type="button"
          className="k-btn k-btn-secondary"
          disabled={mutation.pending}
          onClick={() => mutation.run((rowVersion) => recompose(episode.episode_id, rowVersion))}
        >
          重新合成
        </button>
        <span className="k-card-meta">重新合成只重跑合成，不动任何镜（FR-08）。</span>
      </div>
    </section>
  );
}
