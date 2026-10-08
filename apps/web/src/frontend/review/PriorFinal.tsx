import type { Episode } from "@kelvoy/engine";
import { episodeFileUrl } from "../api/client";

/** Delivery stays available while the next storyboard version is in progress. */
export default function PriorFinal({ episode }: { episode: Episode }) {
  if (!episode.final) return null;
  const url = episodeFileUrl(episode.episode_id, episode.final.key);
  return <details className="k-desk-main">
    <summary>上一版成片 · 下载与分享保留</summary>
    <p className="k-card-meta">当前分镜正在修改或生成，重新合成完成后更新成片。</p>
    <video className="k-media k-desk-final" src={url} controls aria-label="上一版成片" />
    <div className="k-desk-actions">
      <a className="k-btn k-btn-secondary" href={url} download>下载上一版 MP4</a>
      {episode.share.enabled && <a className="k-btn k-btn-secondary" href={`/s/${encodeURIComponent(episode.share.slug)}`} target="_blank" rel="noopener noreferrer">查看上一版分享页</a>}
    </div>
  </details>;
}
