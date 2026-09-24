import { listDestinations } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";

export default function DestinationsPage() {
  const { loading, data, error } = useApiResource(listDestinations, []);

  if (loading) return <p className="k-empty">加载中…</p>;
  if (error) return <p className="k-error">加载失败：{error}</p>;
  const destinations = data?.destinations ?? [];

  return (
    <div>
      <div className="k-eyebrow">官方维护 · 实景为准</div>
      <h1>目的地</h1>
      {destinations.length === 0 ? (
        <p className="k-empty">还没有目的地。</p>
      ) : (
        <div className="k-card-list">
          {destinations.map((d) => (
            <div className="k-card" key={d.destination_id}>
              <div className="k-card-title">
                {d.city} · {d.name} <span className="k-pill k-pill-accent">{d.type}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
