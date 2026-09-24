import { listPersonas } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";

export default function PersonasPage() {
  const { loading, data, error } = useApiResource(listPersonas, []);

  if (loading) return <p className="k-empty">加载中…</p>;
  if (error) return <p className="k-error">加载失败：{error}</p>;
  const personas = data?.personas ?? [];

  return (
    <div>
      <div className="k-eyebrow">账号级资产</div>
      <h1>角色</h1>
      {personas.length === 0 ? (
        <p className="k-empty">还没有角色。</p>
      ) : (
        <div className="k-card-list">
          {personas.map((p) => (
            <div className="k-card" key={p.persona_id}>
              <div className="k-card-title">
                {p.name} <span className="k-pill">v{p.version}</span>
              </div>
              <div className="k-card-meta">{p.desc}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
