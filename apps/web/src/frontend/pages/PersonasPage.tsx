import { listPersonas } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";

export default function PersonasPage() {
  const { loading, data, error } = useApiResource(listPersonas, []);

  if (loading) return <p>加载中…</p>;
  if (error) return <p style={{ color: "red" }}>加载失败：{error}</p>;
  const personas = data?.personas ?? [];

  return (
    <div>
      <h1>角色</h1>
      {personas.length === 0 ? (
        <p>还没有角色。</p>
      ) : (
        <ul>
          {personas.map((p) => (
            <li key={p.persona_id}>
              {p.name}（v{p.version}）— {p.desc}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
