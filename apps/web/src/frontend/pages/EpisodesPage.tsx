import { Link } from "react-router-dom";
import { listEpisodes } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";

export default function EpisodesPage() {
  const { loading, data, error } = useApiResource(listEpisodes, []);

  if (loading) return <p className="k-empty">加载中…</p>;
  if (error) return <p className="k-error">加载失败：{error}</p>;
  const episodes = data?.episodes ?? [];

  return (
    <div>
      <div className="k-eyebrow">一期一个目的地</div>
      <h1>期</h1>
      {episodes.length === 0 ? (
        <p className="k-empty">还没有期。</p>
      ) : (
        <div className="k-card-list">
          {episodes.map((e) => (
            <Link to={`/episodes/${e.episode_id}`} key={e.episode_id} className="k-card" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
              <div className="k-card-title">
                {e.episode_id} <span className="k-pill k-pill-accent">{e.status}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
