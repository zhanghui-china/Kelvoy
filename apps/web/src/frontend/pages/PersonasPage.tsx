import { useState } from "react";
import { Card, EmptyState, ErrorState, LoadingState, PageHeading, Status } from "../ui";
import { Link } from "react-router-dom";
import type { Persona } from "@kelvoy/engine";
import { AssetImage } from "../AssetImage";
import { GuideTip } from "../GuideTip";
import { listPersonas } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";
import { canEditPersona } from "../persona-access";

// 跟 personas.ts 的 MIN_REFS 同值（M2-13, #41）——本地定义一份，跟
// DestinationsPage.tsx 的 MIN_LANDMARK_REFS 一样，没有共享常量可 import。
const MIN_REFS = 3;

export function PersonaCard({ persona: p }: { persona: Persona }) {
  return (
    <Card className="k-persona-card">
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
        {p.owner_id === null && <Status tone="info">官方角色</Status>}
        {p.refs.length < MIN_REFS && <Status tone="warning">参考图不足</Status>}
      </div>
      {p.desc && <div className="k-card-meta">{p.desc}</div>}
      {p.locked.length > 0 && (
        <div className="k-persona-row">
          <span className="k-card-meta">锁定</span>
          {p.locked.map((trait) => (
            <span className="k-pill k-pill-accent" key={trait}>{trait}</span>
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
        <span className="k-card-meta">{p.style.lut} · {p.style.title_style}</span>
      </div>
      {canEditPersona(p) && (
        <Link to={`/personas/${p.persona_id}/edit`} className="k-btn k-btn-secondary">编辑</Link>
      )}
    </Card>
  );
}

export default function PersonasPage() {
  const [attempt, setAttempt] = useState(0);
  const { loading, data, error } = useApiResource(listPersonas, [attempt]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={`加载失败：${error}`} onRetry={() => setAttempt((value) => value + 1)} />;
  const personas = data?.personas ?? [];

  return (
    <div>
      <PageHeading title="角色" eyebrow="账号级资产 · 跨期复用">
        <Link to="/personas/new" className="k-btn k-btn-primary">
          新建角色
        </Link>
      </PageHeading>
      <GuideTip section="personas">官方角色可直接用于新建一期。自己的角色建议用 3–7 张多视角参考图，锁定特征帮助跨期保持一致；编辑后版本号会更新。</GuideTip>
      {personas.length === 0 ? (
        <EmptyState>
          还没有角色，点上面"新建角色"开始第一个。
        </EmptyState>
      ) : (
        <div className="k-persona-grid">
          {personas.map((p) => <PersonaCard key={p.persona_id} persona={p} />)}
        </div>
      )}
    </div>
  );
}
