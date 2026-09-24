import { type FormEvent, useState } from "react";
import { useParams } from "react-router-dom";
import { getEpisode, saveEpisodeAsTemplate } from "../api/client";
import { usePolledApiResource } from "../hooks/useApiResource";

// 存为模板（M2-10, #32）：inline 表单，不是这页的主体——#31 会把这整页改成
// 审片台，到时这个入口原样保留，别的部分再重构。
function SaveAsTemplateForm({ episodeId }: { episodeId: string }) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSavedName(null);
    const result = await saveEpisodeAsTemplate(episodeId, name);
    setSubmitting(false);
    if (!result.ok) {
      setError(Array.isArray(result.errors) ? (result.errors as string[]).join("；") : (result.error ?? "保存失败"));
      return;
    }
    setSavedName(result.template.name);
    setName("");
  }

  return (
    <div className="k-card">
      <div className="k-card-title">存为模板</div>
      <form onSubmit={handleSubmit} className="k-tpl-inline-form">
        <label className="k-field">
          模板名称
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button type="submit" className="k-btn k-btn-secondary" disabled={submitting}>
          {submitting ? "保存中…" : "存为模板"}
        </button>
      </form>
      {error && <p className="k-error">保存失败：{error}</p>}
      {savedName && <p className="k-empty">已保存为模板「{savedName}」。</p>}
    </div>
  );
}

export default function EpisodeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { loading, data, error } = usePolledApiResource(() => getEpisode(id!), [id]);

  if (loading) return <p className="k-empty">加载中…</p>;
  if (error) return <p className="k-error">加载失败：{error}</p>;
  if (!data) return null;
  const { episode, row_version } = data;

  return (
    <div>
      <div className="k-eyebrow">期详情</div>
      <h1>
        {episode.episode_id} <span className="k-pill k-pill-accent">{episode.status}</span>
      </h1>
      <div className="k-card">
        <div className="k-card-meta">row_version：{row_version}</div>
        <div className="k-card-meta">
          角色版本：{episode.persona_version} / 目的地版本：{episode.destination_version}
        </div>
        <div className="k-card-meta">
          镜数：{episode.shots.length}（已完成 {episode.shots.filter((s) => s.status === "approved").length}）
        </div>
      </div>
      <SaveAsTemplateForm episodeId={episode.episode_id} />
      <p className="k-empty">每 3 秒自动刷新一次状态。</p>
    </div>
  );
}
