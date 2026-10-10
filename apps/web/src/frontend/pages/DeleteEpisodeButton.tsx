import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteEpisode } from "../api/client";
import { episodeDeletion } from "./episode-deletion";
import "./DeleteEpisodeButton.css";

export const EPISODE_DELETED_MESSAGE = "作品已删除，素材将在后台清理";

export function DeleteEpisodeDialog({ name, pending, error, onCancel, onConfirm }: {
  name: string; pending: boolean; error: string | null;
  onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="k-delete-dialog" aria-labelledby={titleId}
    aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); if (!pending) onCancel(); }}>
    <h2 id={titleId}>删除作品「{name}」？</h2>
    <p id={descriptionId}>删除后无法恢复，分享链接将失效。正在进行的任务会停止，未结算的预留积分将退回。</p>
    {error && <p className="k-error" role="alert">{error}</p>}
    <div className="k-delete-actions">
      <button type="button" className="k-btn k-btn-secondary" autoFocus disabled={pending} onClick={onCancel}>取消</button>
      <button type="button" className="k-btn k-delete-confirm" disabled={pending} onClick={onConfirm}>
        {pending ? "删除中…" : "确认删除"}
      </button>
    </div>
  </dialog>;
}

export default function DeleteEpisodeButton({ episodeId, name, onDeleted, disabled = false }: {
  episodeId: string; name: string; onDeleted?: () => void; disabled?: boolean;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = useMemo(() => episodeDeletion({
    request: () => deleteEpisode(episodeId), busy: setPending, error: setError,
    success: () => { setOpen(false); if (onDeleted) onDeleted();
      else navigate("/works", { state: { message: EPISODE_DELETED_MESSAGE } }); },
    missing: () => { setOpen(false); if (onDeleted) onDeleted();
      else navigate("/works", { state: { message: "作品已删除" } }); },
    login: () => navigate("/login"),
  }), [episodeId, navigate, onDeleted]);
  return <>
    <button type="button" className="k-btn k-btn-secondary k-delete-work" disabled={disabled || pending}
      aria-label={`删除作品 ${name}`} onClick={() => { setError(null); setOpen(true); }}>删除作品</button>
    {open && <DeleteEpisodeDialog name={name} pending={pending} error={error}
      onCancel={() => setOpen(false)} onConfirm={() => { void submit(); }} />}
  </>;
}
