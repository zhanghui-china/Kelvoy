import { useParams } from "react-router-dom";
import { getEpisode } from "../api/client";
import { usePolledApiResource } from "../hooks/useApiResource";

export default function EpisodeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { loading, data, error } = usePolledApiResource(() => getEpisode(id!), [id]);

  if (loading) return <p>加载中…</p>;
  if (error) return <p style={{ color: "red" }}>加载失败：{error}</p>;
  if (!data) return null;
  const { episode, row_version } = data;

  return (
    <div>
      <h1>{episode.episode_id}</h1>
      <p>状态：{episode.status}</p>
      <p>row_version：{row_version}</p>
      <p>
        角色版本：{episode.persona_version} / 目的地版本：{episode.destination_version}
      </p>
      <p>
        镜数：{episode.shots.length}（已完成 {episode.shots.filter((s) => s.status === "approved").length}）
      </p>
      <p style={{ color: "#888" }}>每 3 秒自动刷新一次状态。</p>
    </div>
  );
}
