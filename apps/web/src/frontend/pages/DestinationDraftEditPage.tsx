import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { DestinationDraft, DestinationDraftContent, Landmark } from "@kelvoy/engine";
import type { ApiResult } from "../api/client";
import { destinationDraftAssetUrl, getDestinationDraft, publishDestinationDraft, removeDestinationPhoto, saveDestinationDraft, uploadDestinationPhotos } from "../api/destination-drafts";
import { destinationDraftError, missingDestinationItems, photoSelectionError } from "../destination-draft-form";
import { createDraftOperationScope, saveThenMutateDraft } from "../destination-draft-workflow";
import { DESTINATION_TYPE_LABELS } from "../labels";
import "./DestinationDraftEditPage.css";

export default function DestinationDraftEditPage() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const [draft, setDraft] = useState<DestinationDraft | null>(null);
  const [content, setContent] = useState<DestinationDraftContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const lock = useRef(false);
  const uncertainPublish = useRef<string | null>(null);
  const scope = useRef(createDraftOperationScope()).current;
  scope.enter(id);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [sharing, setSharing] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    const current = scope.capture();
    lock.current = false; setBusy(""); setNotice(""); setSharing(false);
    setLoading(true); setDraft(null); setContent(null);
    void getDestinationDraft(id).then(result => {
      if (!active || !current()) return;
      setLoading(false);
      if (result.ok) { setDraft(result.draft); setContent(result.draft.content); setError(""); setConflict(false); }
      else { if (result.error === "unauthorized") navigate("/login"); setError(destinationDraftError(result.error, result.message)); }
    });
    return () => { active = false; scope.invalidate(); };
  }, [id, reload]);
  function accept(result: ApiResult<{ draft: DestinationDraft }>): DestinationDraft | null {
    if (result.ok) { setDraft(result.draft); setContent(result.draft.content); return result.draft; }
    if (result.error === "unauthorized") navigate("/login");
    setConflict(result.error === "conflict");
    setError(result.error === "conflict" ? "草稿已在其他页面更新。当前输入仍保留；请核对后重新加载最新草稿，再继续编辑。" : destinationDraftError(result.error, result.message));
    return null;
  }
  async function run(label: string, operation: (saved: DestinationDraft, commit: (result: ApiResult<{ draft: DestinationDraft }>) => DestinationDraft | null, notify: (message: string) => void, current: () => boolean) => Promise<void>) {
    if (lock.current || !draft || !content || conflict || draft.published_version !== null) return;
    const current = scope.capture();
    lock.current = true; setBusy(label); setError(""); setNotice("");
    try {
      if (uncertainPublish.current === draft.draft_id) {
        const latest = await getDestinationDraft(draft.draft_id);
        if (!current()) return;
        if (!latest.ok) { accept(latest); return; }
        uncertainPublish.current = null;
        if (latest.draft.published_version !== null) { accept(latest); setNotice("已确认发布成功！"); return; }
        if (latest.draft.edit_version !== draft.edit_version) { accept({ ok: false, error: "conflict" }); return; }
      }
      // Persist text before file mutations; use the returned revision and server-owned refs.
      await saveThenMutateDraft(() => saveDestinationDraft(draft, content), accept, async saved => {
        await operation(saved, result => current() ? accept(result) : null, message => { if (current()) setNotice(message); }, current);
      }, current);
    } catch { if (current()) setError("操作失败，请重试。"); }
    finally { if (current()) { lock.current = false; setBusy(""); } }
  }
  function patch(values: Partial<DestinationDraftContent>) { setContent(current => current ? { ...current, ...values } : current); }
  function patchLandmark(index: number, values: Partial<Landmark>) {
    if (!content) return;
    patch({ landmarks: content.landmarks.map((landmark, at) => at === index ? { ...landmark, ...values } : landmark) });
  }
  async function upload(index: number, files: File[]) {
    if (!content || !files.length) return;
    const landmark = content.landmarks[index];
    const invalid = photoSelectionError(files, landmark.refs.length);
    if (invalid) { setError(invalid); return; }
    await run("正在上传照片…", async (saved, commit, notify) => { if (commit(await uploadDestinationPhotos(saved, landmark.id, files))) notify("照片已上传，草稿已保存。"); });
  }
  if (loading || (draft !== null && draft.draft_id !== id)) return <p role="status">加载草稿中…</p>;
  if (!draft || !content) return <div><p className="k-error" role="alert">{error}</p><button onClick={() => setReload(value => value + 1)}>重试</button> <Link to="/destinations/drafts">返回我的草稿</Link></div>;
  const missing = missingDestinationItems(content);
  const published = draft.published_version !== null;
  const disabled = !!busy || published || conflict;
  const list = (value: string) => value.split("\n");
  return <div className="k-draft-editor"><h1>{draft.destination_id ? "编辑目的地" : "创建目的地"}</h1><p>草稿仅自己可见，保存后可在“我的草稿”继续编辑。创建、上传和发布不扣积分。</p>
    <Link to="/destinations/drafts">← 我的草稿</Link>
    {error && <p className="k-error" role="alert">{error} {!conflict && <button disabled={!!busy} onClick={() => { if (window.confirm("重新加载会替换当前输入，继续吗？")) setReload(value => value + 1); }}>重新加载草稿</button>}</p>}
    {conflict && <button type="button" onClick={() => { if (window.confirm("重新加载会替换当前未保存输入，已核对并准备继续吗？")) setReload(value => value + 1); }}>重新加载最新草稿</button>}
    {notice && <p role="status">{notice}</p>}
    {published && <section className="k-card"><h2>已发布到共享库</h2><p>所有用户现在都可选择这个目的地。修改已发布内容请从目的地库进入新的私有编辑草稿。</p><Link className="k-btn k-btn-primary" to={`/episodes/new?destination=${encodeURIComponent(draft.destination_id!)}`}>用这个目的地新建一期 →</Link> <Link to="/destinations">查看共享库</Link></section>}
    <fieldset disabled={disabled} className="k-draft-fields"><legend>景区信息</legend>
      <label className="k-field">景区名称<input maxLength={4000} value={content.name} onChange={event => patch({ name: event.target.value })} /></label>
      <label className="k-field">城市<input maxLength={4000} value={content.city} onChange={event => patch({ city: event.target.value })} /></label>
      <label className="k-field">类型<select value={content.type} onChange={event => patch({ type: event.target.value as DestinationDraftContent["type"] })}>{Object.entries(DESTINATION_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <h2>地标与实景照片</h2><p>每个地标发布时需 3–10 张 JPEG、PNG 或 WebP 照片，每张最多 10MB。草稿可先保存不足 3 张的内容。</p>
      {content.landmarks.map((landmark, index) => <section className="k-card" key={landmark.id}>
        <h3>地标 {index + 1}</h3>
        <label className="k-field">地标名称<input value={landmark.name} maxLength={4000} onChange={event => patchLandmark(index, { name: event.target.value })} /></label>
        <label className="k-field">最佳机位／时段<input value={landmark.best_time} maxLength={4000} onChange={event => patchLandmark(index, { best_time: event.target.value })} /></label>
        <label className="k-field">必须保真的特征（每行一项）<textarea value={(landmark.must_keep ?? []).join("\n")} onChange={event => patchLandmark(index, { must_keep: list(event.target.value) })} /></label>
        <div className="k-draft-photos">{landmark.refs.map((key, photoIndex) => <figure key={key}><img src={destinationDraftAssetUrl(draft.draft_id, key)} alt={`${landmark.name || `地标 ${index + 1}`} 实景照片 ${photoIndex + 1}`} loading="lazy" /><figcaption><button type="button" onClick={() => void run("正在移除照片…", async (saved, commit, notify) => { if (commit(await removeDestinationPhoto(saved, landmark.id, key))) notify("照片已移除，历史版本照片保留。"); })}>移除照片 {photoIndex + 1}</button></figcaption></figure>)}</div>
        <p>{landmark.refs.length} / 10 张照片</p>
        <label className="k-field">批量上传照片<input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={landmark.refs.length >= 10} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void upload(index, files); }} /></label>
        <button type="button" onClick={() => patch({ landmarks: content.landmarks.filter(item => item.id !== landmark.id) })}>移除地标</button>
      </section>)}
      <button type="button" disabled={content.landmarks.length >= 50} onClick={() => patch({ landmarks: [...content.landmarks, { id: crypto.randomUUID(), name: "", best_time: "", must_keep: [], refs: [] }] })}>添加地标</button>
      <details><summary>选填：介绍、季节、动线和旅行信息</summary>
        <label className="k-field">介绍<textarea maxLength={4000} value={content.description ?? ""} onChange={event => patch({ description: event.target.value })} /></label>
        {([ ["season_best", "最佳季节"], ["route", "动线（按顺序）"], ["food", "地方饮食"] ] as const).map(([key, label]) => <label className="k-field" key={key}>{label}（每行一项）<textarea value={content[key].join("\n")} onChange={event => patch({ [key]: list(event.target.value) })} /></label>)}
        <label className="k-field">交通<textarea maxLength={4000} value={content.transport} onChange={event => patch({ transport: event.target.value })} /></label>
        <label className="k-field">住宿<textarea maxLength={4000} value={content.stay} onChange={event => patch({ stay: event.target.value })} /></label>
      </details>
    </fieldset>
    {!published && <section className="k-card"><h2>发布准备</h2>{missing.length > 0 ? <><p>待补齐：</p><ul>{missing.map(item => <li key={item}>{item}</li>)}</ul></> : <p>必填内容已齐全。</p>}
      <p>发布无需管理员审核。发布后，目的地内容与实景照片将公开共享，所有用户都可查看、选择并用于新建一期。</p>
      <label><input type="checkbox" checked={sharing} disabled={disabled} onChange={event => setSharing(event.target.checked)} />我同意将这些照片公开共享</label>
      <div className="k-draft-actions"><button className="k-btn k-btn-secondary" disabled={disabled} onClick={() => void run("正在保存…", async (_saved, _commit, notify) => { notify("草稿已保存。"); })}>保存草稿</button>
        <button className="k-btn k-btn-primary" disabled={disabled || !sharing || missing.length > 0} onClick={() => void run("正在发布…", async (saved, commit, notify, active) => { const result = await publishDestinationDraft(saved); if (active() && !result.ok && ["network_error", "invalid_response"].includes(result.error ?? "")) uncertainPublish.current = saved.draft_id; if (commit(result)) notify("发布成功！"); })}>发布到共享库</button></div>
    </section>}
    {busy && <p role="status" aria-live="polite">{busy}</p>}
  </div>;
}
