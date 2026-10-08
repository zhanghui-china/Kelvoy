import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createDestinationDraft, deleteDestinationDraft, listDestinationDrafts } from "../api/destination-drafts";
import { destinationDraftError } from "../destination-draft-form";
import { useApiResource } from "../hooks/useApiResource";
import type { DestinationDraft } from "@kelvoy/engine";
export default function DestinationDraftsPage() {
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  const { data, loading, error } = useApiResource(listDestinationDrafts, [revision]);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  async function create() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setFailure("");
    const result = await createDestinationDraft();
    lock.current = false; setBusy(false);
    if (result.ok) navigate(`/destinations/drafts/${encodeURIComponent(result.draft.draft_id)}`);
    else { if (result.error === "unauthorized") navigate("/login"); setFailure(destinationDraftError(result.error, result.message)); }
  }
  async function remove(draft: DestinationDraft) {
    if (!window.confirm("删除这个私有草稿？公开目的地和历史照片会保留。")) return;
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setFailure("");
    const result = await deleteDestinationDraft(draft);
    lock.current = false; setBusy(false);
    if (result.ok) setRevision(value => value + 1);
    else { if (result.error === "unauthorized") navigate("/login"); setFailure(destinationDraftError(result.error, result.message)); }
  }
  const drafts = data?.drafts.filter(draft => draft.published_version === null) ?? [];
  return <div><h1>我的目的地草稿</h1><p>草稿仅自己可见。发布后所有用户可查看照片并使用目的地。</p>
    <button className="k-btn k-btn-primary" disabled={busy} onClick={() => void create()}>{busy ? "处理中…" : "创建目的地"}</button> <Link to="/destinations">返回共享库</Link>
    {(error || failure) && <p className="k-error" role="alert">{error ? destinationDraftError(error) : failure} <button onClick={() => setRevision(value => value + 1)}>重新加载</button></p>}
    {loading ? <p role="status">加载中…</p> : drafts.length === 0 ? <p className="k-empty">还没有未发布的草稿。</p> : drafts.map(draft => <article className="k-card" key={draft.draft_id}><h2>{draft.content.name || "未命名景区"}</h2><p>{draft.content.city || "城市待填写"} · {draft.content.landmarks.length} 个地标{draft.destination_id ? " · 已发布目的地的编辑草稿" : ""}</p><Link className="k-btn k-btn-secondary" to={`/destinations/drafts/${encodeURIComponent(draft.draft_id)}`}>继续编辑</Link> <button disabled={busy} onClick={() => void remove(draft)}>删除草稿</button></article>)}
  </div>;
}
