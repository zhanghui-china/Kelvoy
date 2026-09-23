import { Link } from "react-router-dom";
import { listEpisodes } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";

export default function EpisodesPage() {
  const { loading, data, error } = useApiResource(listEpisodes, []);

  if (loading) return <p>加载中…</p>;
  if (error) return <p style={{ color: "red" }}>加载失败：{error}</p>;
  const episodes = data?.episodes ?? [];

  return (
    <div>
      <h1>期</h1>
      {episodes.length === 0 ? (
        <p>还没有期。</p>
      ) : (
        <ul>
          {episodes.map((e) => (
            <li key={e.episode_id}>
              <Link to={`/episodes/${e.episode_id}`}>{e.episode_id}</Link> — {e.status}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
