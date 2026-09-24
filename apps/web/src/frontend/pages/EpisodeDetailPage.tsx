import { useParams } from "react-router-dom";
import { getEpisode } from "../api/client";
import { usePolledApiResource } from "../hooks/useApiResource";

export default function EpisodeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { loading, data, error } = usePolledApiResource(() => getEpisode(id!), [id]);

  if (loading) return <p className="k-empty">加载中…</p>;
  if (error) return <p className="k-error">加载失败：{error}</p>;
  if (!data) return null;
  const { episode, row_version } = data;

  return (
    <div>
      <div className="k-eyebrow">期详情</div>
      <h1>
        {episode.episode_id} <span className="k-pill k-pill-accent">{episode.status}</span>
      </h1>
      <div className="k-card">
        <div className="k-card-meta">row_version：{row_version}</div>
        <div className="k-card-meta">
          角色版本：{episode.persona_version} / 目的地版本：{episode.destination_version}
        </div>
        <div className="k-card-meta">
          镜数：{episode.shots.length}（已完成 {episode.shots.filter((s) => s.status === "approved").length}）
        </div>
      </div>
      <p className="k-empty">每 3 秒自动刷新一次状态。</p>
    </div>
  );
}
