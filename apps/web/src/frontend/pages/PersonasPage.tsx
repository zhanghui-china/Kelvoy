import { Link } from "react-router-dom";
import { AssetImage } from "../AssetImage";
import { listPersonas } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";

// 跟 personas.ts 的 MIN_REFS 同值（M2-13, #41）——本地定义一份，跟
// DestinationsPage.tsx 的 MIN_LANDMARK_REFS 一样，没有共享常量可 import。
const MIN_REFS = 3;

export default function PersonasPage() {
  const { loading, data, error } = useApiResource(listPersonas, []);

  if (loading) return <p className="k-empty">加载中…</p>;
  if (error) return <p className="k-error">加载失败：{error}</p>;
  const personas = data?.personas ?? [];

  return (
    <div>
      <div className="k-eyebrow">账号级资产 · 跨期复用</div>
      <div className="k-persona-page-head">
        <h1>角色</h1>
        <Link to="/personas/new" className="k-btn k-btn-primary">
          新建角色
        </Link>
      </div>
      {personas.length === 0 ? (
        <p className="k-empty">
          还没有角色，点上面"新建角色"开始第一个。
        </p>
      ) : (
        <div className="k-persona-grid">
          {personas.map((p) => (
            <div className="k-card k-persona-card" key={p.persona_id}>
              <div className="k-persona-refs">
                {(p.refs.length > 0 ? p.refs.slice(0, 3) : [null, null, null]).map((ref, i) =>
                  ref ? (
                    <AssetImage key={ref} src={`/api/assets/${ref}`} alt={`${p.name} 参考图 ${i + 1}`} />
                  ) : (
                    <div className="k-media-missing" key={i}>
                      <div className="k-card-meta">未上传</div>
                    </div>
                  ),
                )}
              </div>
              <div className="k-persona-row">
                <div className="k-card-title">
                  {p.name} <span className="k-pill">v{p.version}</span>
                </div>
                {p.refs.length < MIN_REFS && <span className="k-pill">参考图不足</span>}
              </div>
              {p.desc && <div className="k-card-meta">{p.desc}</div>}
              {p.locked.length > 0 && (
                <div className="k-persona-row">
                  <span className="k-card-meta">锁定</span>
                  {p.locked.map((trait) => (
                    <span className="k-pill k-pill-accent" key={trait}>
                      {trait}
                    </span>
                  ))}
                </div>
              )}
              {p.default_outfit && (
                <div className="k-persona-row">
                  <span className="k-card-meta">默认穿搭</span>
                  <span className="k-card-meta">{p.default_outfit}</span>
                </div>
              )}
              <div className="k-persona-row">
                <span className="k-card-meta">账号风格</span>
                <span className="k-card-meta">
                  {p.style.lut} · {p.style.title_style}
                </span>
              </div>
              <Link to={`/personas/${p.persona_id}/edit`} className="k-btn k-btn-secondary">
                编辑
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
