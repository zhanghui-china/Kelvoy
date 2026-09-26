import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getShare, shareFinalVideoUrl, type SharedEpisode } from "../api/client";

/**
 * FR-12 分享页：不登录也能看，不用 Layout 的侧栏壳（那是登录后的工作台）。
 * 找不到 / 没开分享，服务端统一返回 404，这里不区分展示成同一句话——不
 * 泄露"这个链接存在但关掉了"。
 */
export default function SharePage() {
  const { slug } = useParams<{ slug: string }>();
  const [episode, setEpisode] = useState<SharedEpisode | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    getShare(slug).then((result) => {
      if (!result.ok) {
        setNotFound(true);
        return;
      }
      setEpisode(result.episode);
    });
  }, [slug]);

  if (notFound) {
    return (
      <div className="k-auth-shell">
        <p className="k-empty">链接无效，或者分享已经关闭。</p>
      </div>
    );
  }
  if (!episode || !slug) return null;

  return (
    <div className="k-share-page">
      <div className="k-nav-brand">Kelvoy</div>
      <video
        className="k-media k-share-video"
        src={shareFinalVideoUrl(slug)}
        controls
        aria-label={episode.render.title || episode.episode_id}
      />
      <h1>{episode.render.title || episode.episode_id}</h1>
      <p className="k-card-meta">{episode.shots.length} 镜 · AI 生成 · 虚构角色 · 真实目的地</p>
      {episode.final && <p className="k-card-meta">{episode.final.duration_s.toFixed(1)} 秒 · {episode.final.width}×{episode.final.height}</p>}
      <a className="k-btn k-btn-primary" href={shareFinalVideoUrl(slug)} download>下载视频</a>
    </div>
  );
}
