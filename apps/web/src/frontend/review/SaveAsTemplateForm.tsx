import { type FormEvent, useState } from "react";
import { saveEpisodeAsTemplate } from "../api/client";

/**
 * 存为模板（FR-10，M2-10/#32 落地）。#31 把期详情页改成了审片台，这个入口
 * 原样搬到审片台头部，逻辑没动——它不走 useEpisodeMutation：存模板不碰期
 * 数据，没有 row_version，也不需要触发轮询刷新。
 */
export default function SaveAsTemplateForm({ episodeId }: { episodeId: string }) {
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
      setError(
        Array.isArray(result.errors) ? (result.errors as string[]).join("；") : (result.error ?? "保存失败"),
      );
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
      {error && (
        <p className="k-error" role="alert">
          保存失败：{error}
        </p>
      )}
      {savedName && <p className="k-empty">已保存为模板「{savedName}」。</p>}
    </div>
  );
}
