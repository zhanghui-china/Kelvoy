import { listDestinations } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";

export default function DestinationsPage() {
  const { loading, data, error } = useApiResource(listDestinations, []);

  if (loading) return <p>加载中…</p>;
  if (error) return <p style={{ color: "red" }}>加载失败：{error}</p>;
  const destinations = data?.destinations ?? [];

  return (
    <div>
      <h1>目的地</h1>
      {destinations.length === 0 ? (
        <p>还没有目的地。</p>
      ) : (
        <ul>
          {destinations.map((d) => (
            <li key={d.destination_id}>
              {d.city} · {d.name}（{d.type}）
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
