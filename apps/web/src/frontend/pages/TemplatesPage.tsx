import { type FormEvent, type ReactNode, useState } from "react";
import type { DestinationType, Template } from "@kelvoy/engine";
import { createTemplate, deleteTemplate, listTemplates } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";
import { DESTINATION_TYPE_LABELS } from "../labels";

const SKELETON_OPTIONS = Object.entries(DESTINATION_TYPE_LABELS) as [DestinationType, string][];

function TemplateCard({ template, action }: { template: Template; action?: ReactNode }) {
  return (
    <div className="k-card">
      <div className="k-card-title">
        {template.name} <span className="k-pill">{DESTINATION_TYPE_LABELS[template.skeleton]}</span>
      </div>
      <div className="k-card-meta">LUT：{template.lut}</div>
      <div className="k-card-meta">
        片头：{template.intro ?? "无"} / 片尾：{template.outro ?? "无"}
      </div>
      <div className="k-card-meta">标题样式：{template.title_style}</div>
      {action && <div className="k-tpl-card-actions">{action}</div>}
    </div>
  );
}

export default function TemplatesPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { loading, data, error } = useApiResource(listTemplates, [refreshKey]);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [skeleton, setSkeleton] = useState<DestinationType>("scenic_area");
  const [lut, setLut] = useState("");
  const [intro, setIntro] = useState("");
  const [outro, setOutro] = useState("");
  const [titleStyle, setTitleStyle] = useState("serif-center");
  const [submitting, setSubmitting] = useState(false);
  const [createErrors, setCreateErrors] = useState<string[] | null>(null);

  async function handleDelete(templateId: string) {
    if (!window.confirm("确定删除这个模板？")) return;
    setDeletingId(templateId);
    setDeleteError(null);
    const result = await deleteTemplate(templateId);
    setDeletingId(null);
    if (!result.ok) {
      setDeleteError(result.error ?? "删除失败");
      return;
    }
    setRefreshKey((k) => k + 1);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setCreateErrors(null);
    const result = await createTemplate({
      name,
      skeleton,
      lut,
      intro: intro.trim().length > 0 ? intro : null,
      outro: outro.trim().length > 0 ? outro : null,
      title_style: titleStyle,
    });
    setSubmitting(false);
    if (!result.ok) {
      setCreateErrors(
        Array.isArray(result.errors) ? (result.errors as string[]) : [result.error ?? "创建失败"],
      );
      return;
    }
    setName("");
    setLut("");
    setIntro("");
    setOutro("");
    setTitleStyle("serif-center");
    setRefreshKey((k) => k + 1);
  }

  if (loading) return <p className="k-empty">加载中…</p>;
  if (error) return <p className="k-error">加载失败：{error}</p>;

  const templates = data?.templates ?? [];
  const official = templates.filter((t) => t.owner_id === null);
  const mine = templates.filter((t) => t.owner_id !== null);

  return (
    <div>
      <div className="k-eyebrow">账号级资产</div>
      <h1>模板</h1>

      <div>
        <h2>官方模板</h2>
        {official.length === 0 ? (
          <p className="k-empty">暂无官方模板。</p>
        ) : (
          <div className="k-card-list k-tpl-grid">
            {official.map((t) => (
              <TemplateCard key={t.template_id} template={t} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2>我的模板</h2>
        {deleteError && <p className="k-error">删除失败：{deleteError}</p>}
        {mine.length === 0 ? (
          <p className="k-empty">还没有私有模板。</p>
        ) : (
          <div className="k-card-list k-tpl-grid">
            {mine.map((t) => (
              <TemplateCard
                key={t.template_id}
                template={t}
                action={
                  <button
                    type="button"
                    className="k-btn k-btn-secondary"
                    disabled={deletingId === t.template_id}
                    onClick={() => handleDelete(t.template_id)}
                  >
                    {deletingId === t.template_id ? "删除中…" : "删除"}
                  </button>
                }
              />
            ))}
          </div>
        )}
      </div>

      <div className="k-card k-tpl-form">
        <h2>新建模板</h2>
        <form onSubmit={handleCreate}>
          <label className="k-field">
            名称
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="k-field">
            骨架
            <select value={skeleton} onChange={(e) => setSkeleton(e.target.value as DestinationType)}>
              {SKELETON_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="k-field">
            LUT
            <input value={lut} onChange={(e) => setLut(e.target.value)} required />
          </label>
          <label className="k-field">
            片头（可留空）
            <input value={intro} onChange={(e) => setIntro(e.target.value)} />
          </label>
          <label className="k-field">
            片尾（可留空）
            <input value={outro} onChange={(e) => setOutro(e.target.value)} />
          </label>
          <label className="k-field">
            标题样式
            <input value={titleStyle} onChange={(e) => setTitleStyle(e.target.value)} required />
          </label>
          {createErrors && (
            <ul className="k-error">
              {createErrors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}
          <button type="submit" className="k-btn k-btn-primary" disabled={submitting}>
            {submitting ? "创建中…" : "创建模板"}
          </button>
        </form>
      </div>
    </div>
  );
}
