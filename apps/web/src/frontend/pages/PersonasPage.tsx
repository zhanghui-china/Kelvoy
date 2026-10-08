import { filterPersonas, type PersonaSource } from "./resource-library";
import "./ResourceLibrary.css";
import { useCallback, useMemo, useState } from "react";
import { Card, EmptyState, ErrorState, LoadingState, PageHeading, Status } from "../ui";
import { Link, useNavigate } from "react-router-dom";
import type { Persona } from "@kelvoy/engine";
import { AssetImage } from "../AssetImage";
import { GuideTip } from "../GuideTip";
import { deletePersona, listPersonas } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";
import { canEditPersona } from "../persona-access";
import { personaDeletion } from "./persona-deletion";

// 跟 personas.ts 的 MIN_REFS 同值（M2-13, #41）——本地定义一份，跟
// DestinationsPage.tsx 的 MIN_LANDMARK_REFS 一样，没有共享常量可 import。
const MIN_REFS = 3;

export function PersonaCard({ persona: p, onRefresh }: {
  persona: Persona; onRefresh?: (message?: string) => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = useMemo(() => personaDeletion({
    name: p.name, confirm: message => window.confirm(message),
    request: () => deletePersona(p.persona_id, p.version),
    busy: setBusy, error: setError, refresh: message => onRefresh?.(message),
    login: () => navigate("/login"),
  }), [p.name, p.persona_id, p.version, onRefresh, navigate]);
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
      <div className="k-library-use">
      <Link to={`/episodes/new?persona=${encodeURIComponent(p.persona_id)}`} className="k-btn k-btn-primary">使用角色</Link>
      {canEditPersona(p) && (
        <>
          <Link to={`/personas/${p.persona_id}/edit`} className="k-btn k-btn-secondary" aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); }}>编辑</Link>
          <button type="button" className="k-btn k-btn-secondary" disabled={busy} onClick={remove}>{busy ? "删除中…" : error ? "重试删除" : "删除"}</button>
        </>
      )}
      </div>
      {error && <p className="k-error" role="alert">{error}</p>}
    </Card>
  );
}

export default function PersonasPage() {
  const [source, setSource] = useState<PersonaSource>("mine");
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useCallback((message?: string) => {
    setNotice(message ?? null);
    setAttempt(value => value + 1);
  }, []);
  const { loading, data, error } = useApiResource(listPersonas, [attempt]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={`加载失败：${error}`} onRetry={() => setAttempt((value) => value + 1)} />;
  const personas = filterPersonas(data?.personas ?? [], source);

  return (
    <div>
      <PageHeading title="角色" eyebrow="账号级资产 · 跨期复用">
        <Link to="/personas/new" className="k-btn k-btn-primary">
          新建角色
        </Link>
      </PageHeading>
      {notice && <p role="status">{notice}</p>}
      <GuideTip section="personas">官方角色可直接用于新建一期。自己的角色建议用 3–7 张多视角参考图，锁定特征帮助跨期保持一致；编辑后版本号会更新。</GuideTip>
      <div className="k-library-source" role="group" aria-label="角色来源">
        {(["mine", "official"] as const).map(value => <button key={value} type="button" aria-pressed={source === value} className={`k-btn ${source === value ? "k-btn-primary" : "k-btn-secondary"}`} onClick={() => setSource(value)}>{value === "mine" ? "我的角色" : "官方角色"}</button>)}
      </div>
      {personas.length === 0 ? (
        <EmptyState>
          {source === "mine" ? "还没有自己的角色，可以新建或切换到官方角色。" : "暂无官方角色。"}
        </EmptyState>
      ) : (
        <div className="k-persona-grid">
          {personas.map((p) => <PersonaCard key={p.persona_id} persona={p} onRefresh={refresh} />)}
        </div>
      )}
    </div>
  );
}
