import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Destination, Episode } from "@kelvoy/engine";
import { getStoryboardSuggestion, requestStoryboardSuggestion, type StoryboardDraft } from "../api/client";
import { SHOT_CAMERA_LABELS, SHOT_SIZE_LABELS } from "../labels";
import { describeWriteError } from "./errors";
import { fillMissingSuggestion, suggestionFields } from "./storyboard-model";
import type { EpisodeMutation } from "./useEpisodeMutation";

export default function StoryboardShotForm({ episode, destination, initial, mutation, locked, afterId,
  price, onSave, onCancel, onActivityChange, captionOnly = false }: {
  episode: Episode; destination: Destination | null; initial: StoryboardDraft; mutation: EpisodeMutation;
  locked: boolean; afterId?: string | null; price?: number; captionOnly?: boolean;
  onActivityChange?: (active: boolean) => void;
  onSave: (draft: StoryboardDraft) => Promise<boolean>; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [description, setDescription] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestionStatus, setSuggestionStatus] = useState("");
  const [pollRetry, setPollRetry] = useState(0);
  const editedAfterRequest = useRef(new Set<string>());
  const pollFailed = useRef(false);
  const [awaitingRefresh, setAwaitingRefresh] = useState(false);
  // Completion writes accounting; await the next detail snapshot before inserting.
  useEffect(() => { setAwaitingRefresh(false); }, [episode]);
  useEffect(() => {
    if (!taskId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const result = await getStoryboardSuggestion(episode.episode_id, taskId!);
      if (!active) return;
      if (!result.ok) {
        setError(describeWriteError(result));
        pollFailed.current = true;
        return;
      }
      if (result.status === "done" || result.status === "failed") {
        setTaskId(null);
        if (result.status === "done") {
          setDraft((current) => fillMissingSuggestion(current, result.suggestion ?? {}, editedAfterRequest.current));
          setSuggestionStatus("建议已填入空白字段，请检查后确认插入。");
        } else setError(result.error ?? "AI 建议失败，可重试；表单内容已保留。");
        setAwaitingRefresh(Boolean(mutation.refresh));
        mutation.refresh?.();
        return;
      }
      setSuggestionStatus("AI 正在生成建议，可继续编辑表单…");
      timer = setTimeout(poll, 2000);
    }
    pollFailed.current = false;
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [taskId, episode.episode_id, pollRetry]);
  function update<K extends keyof StoryboardDraft>(field: K, value: StoryboardDraft[K]) {
    if (taskId) editedAfterRequest.current.add(field);
    setDraft((current) => ({ ...current, [field]: value }));
  }
  async function suggest() {
    setError(null);
    editedAfterRequest.current.clear();
    let queuedId: string | undefined;
    const result = await mutation.run(async (version) => {
      const response = await requestStoryboardSuggestion(episode.episode_id, version, afterId ?? null, description.trim(), suggestionFields(draft));
      if (response.ok) { queuedId = response.task_id; }
      return response;
    });
    if (result?.ok && queuedId) { setTaskId(queuedId); setSuggestionStatus("AI 建议已排队…"); }
    else if (result && !result.ok) setError(describeWriteError(result));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null);
    if (await onSave(draft)) onCancel();
  }
  useEffect(() => { onActivityChange?.(Boolean(taskId) || awaitingRefresh); }, [taskId, awaitingRefresh, onActivityChange]);
  const submittingDisabled = locked || mutation.pending || Boolean(taskId) || awaitingRefresh;
  return <form className="k-desk-editor k-storyboard-form" onSubmit={submit}>
    <div className="k-card-title">{afterId !== undefined ? "插入新镜头" : captionOnly ? "编辑字幕" : "编辑画面"}</div>
    {!captionOnly && <>
      <fieldset disabled={(locked && !taskId) || mutation.pending}>
        <legend>画面与动作</legend>
        <div className="k-desk-editor-row">
          <label className="k-field">场景<select value={draft.scene} onChange={(e) => update("scene", e.target.value)}>
            {episode.scenes.length === 0 && <option value="">默认场景（保存时创建）</option>}
            {episode.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
          </select></label>
          <label className="k-field">景别<select value={draft.size} onChange={(e) => update("size", e.target.value as StoryboardDraft["size"])}>
            {Object.entries(SHOT_SIZE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label className="k-field">机位<select value={draft.camera} onChange={(e) => update("camera", e.target.value as StoryboardDraft["camera"])}>
            {Object.entries(SHOT_CAMERA_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label className="k-field">地标<select value={draft.landmark ?? ""} onChange={(e) => update("landmark", e.target.value || null)}>
            <option value="">无</option>{destination?.landmarks.map((landmark) => <option key={landmark.id} value={landmark.id}>{landmark.name}</option>)}
          </select></label>
        </div>
        <label className="k-field">画面动作（beat）<textarea required maxLength={2000} value={draft.beat} onChange={(e) => update("beat", e.target.value)} /></label>
        <label className="k-field">关键帧描述<textarea required maxLength={2000} value={draft.kf_prompt} onChange={(e) => update("kf_prompt", e.target.value)} /></label>
        <label className="k-field">运动描述<textarea required maxLength={2000} value={draft.motion_prompt} onChange={(e) => update("motion_prompt", e.target.value)} /></label>
      </fieldset>
    </>}
    {(captionOnly || afterId !== undefined) && <fieldset disabled={(locked && !taskId) || mutation.pending}><legend>成片字幕</legend>
      <label className="k-field">字幕（可留空）<textarea value={draft.caption ?? ""} maxLength={120} onChange={(e) => update("caption", e.target.value)} /></label>
    </fieldset>}
    {afterId !== undefined && <div className="k-card">
      <label className="k-field">用一句话生成 AI 建议<textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} /></label>
      <p className="k-card-meta">手工新增与编辑免费。AI 建议{price === undefined ? "报价加载中" : `消耗 ${price} 积分`}；只补充空白字段，完成后由你确认插入。</p>
      <button type="button" className="k-btn k-btn-secondary" disabled={submittingDisabled || !description.trim() || price === undefined} onClick={suggest}>生成单镜建议{price !== undefined ? ` · ${price} 积分` : ""}</button>
      {taskId && pollFailed.current && <button type="button" className="k-btn k-btn-secondary" onClick={() => { setError(null); setPollRetry((value) => value + 1); }}>重试获取结果（不重复扣费）</button>}
      {suggestionStatus && <p role="status">{suggestionStatus}</p>}
    </div>}
    {error && <p className="k-error" role="alert">{error}</p>}
    <div className="k-desk-actions">
      <button type="submit" className="k-btn k-btn-primary" disabled={submittingDisabled}>{mutation.pending ? "保存中…" : afterId !== undefined ? "确认插入" : "保存修改"}</button>
      <button type="button" className="k-btn k-btn-secondary" disabled={Boolean(taskId) || mutation.pending} onClick={onCancel}>取消</button>
    </div>
  </form>;
}
