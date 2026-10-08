import { Fragment, useState } from "react";
import type { Destination, Episode, Shot } from "@kelvoy/engine";
import { insertStoryboardShot, patchStoryboardShot, removeStoryboardShot, reorderStoryboardShots, type StoryboardDraft, type StoryboardPrices } from "../api/client";
import { SHOT_SIZE_LABELS } from "../labels";
import { MutationError } from "./ShotHeader";
import StoryboardShotForm from "./StoryboardShotForm";
import { emptyShot, pendingGenerationEstimate, reorderedIds, shotIdentity, storyboardDuration } from "./storyboard-model";
import type { EpisodeMutation } from "./useEpisodeMutation";
import "./StoryboardEditor.css";

type Editor = { kind: "insert"; after: string | null } | { kind: "visual" | "caption"; id: string };
export default function StoryboardEditor({ episode, destination, mutation, busy = false, warnings = [], prices }: {
  episode: Episode; destination: Destination | null; mutation: EpisodeMutation;
  busy?: boolean; warnings?: string[]; prices?: StoryboardPrices;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const locked = busy || Boolean(episode.script_pending_task_id);
  const disabled = locked || mutation.pending || suggestionBusy;
  const ids = episode.shots.map(shotIdentity);
  async function reorder(source: string, target: string) {
    if (disabled) return;
    const order = reorderedIds(ids, source, target);
    if (order === ids) return;
    await mutation.run((version) => reorderStoryboardShots(episode.episode_id, version, order));
  }
  function move(id: string, delta: number) {
    const target = ids[ids.indexOf(id) + delta];
    if (target) void reorder(id, target);
  }
  async function remove(shot: Shot) {
    if (!window.confirm(`确认删除第 ${shot.no} 镜「${shot.beat || "空白镜头"}」？历史素材文件和上一版成片会保留。`)) return;
    const result = await mutation.run((version) => removeStoryboardShot(episode.episode_id, shotIdentity(shot), version));
    if (result?.ok && editor && "id" in editor && editor.id === shotIdentity(shot)) setEditor(null);
  }
  function form(current: Editor, shot?: Shot) {
    const initial = shot ? { scene: shot.scene, size: shot.size, beat: shot.beat, caption: shot.caption ?? "", camera: shot.camera,
      landmark: shot.landmark, kf_prompt: shot.kf_prompt ?? "", motion_prompt: shot.motion_prompt ?? "" } : emptyShot(episode.scenes[0]?.id ?? "");
    return <StoryboardShotForm key={current.kind === "insert" ? `insert-${current.after}` : `${current.kind}-${current.id}`}
      episode={episode} destination={destination} initial={initial} mutation={mutation} locked={locked}
      afterId={current.kind === "insert" ? current.after : undefined} price={prices?.script}
      onActivityChange={setSuggestionBusy} captionOnly={current.kind === "caption"} onCancel={() => setEditor(null)} onSave={async (draft: StoryboardDraft) => {
        const result = await mutation.run((version) => current.kind === "insert"
          ? insertStoryboardShot(episode.episode_id, version, current.after, draft)
          : patchStoryboardShot(episode.episode_id, current.id, version, current.kind === "caption" ? { caption: draft.caption } :
            { scene: draft.scene, size: draft.size, beat: draft.beat, camera: draft.camera, landmark: draft.landmark, kf_prompt: draft.kf_prompt, motion_prompt: draft.motion_prompt }));
        return Boolean(result?.ok);
      }} />;
  }
  return <section className="k-storyboard" aria-label="自由分镜编辑">
    <div className="k-desk-toolbar"><div className="k-card-title">分镜编辑</div><span className="k-nav-spacer" />
      <button type="button" className="k-btn k-btn-secondary" disabled={disabled} onClick={() => setEditor({ kind: "insert", after: null })}>在开头添加一镜</button>
    </div>
    <p className="k-card-meta">当前 {episode.shots.length} 镜 · 预计 {storyboardDuration(episode.shots, episode.cut_policy).toFixed(1)} 秒。镜头数量自由，支持保存空故事板；手工编辑免费。</p>
    {prices && <p className="k-card-meta">待生成素材预计 {pendingGenerationEstimate(episode, prices)} 积分（已保留的素材不重复生成）。图片 {prices.image} 积分 / 张 · 视频 {prices.video} 积分 / 镜 · 合成 {prices.compose} 积分。</p>}
    {locked && <p role="status">生成任务正在处理中，暂时锁定分镜修改；完成后可继续编辑。</p>}
    {warnings.map((warning, index) => <p className="k-card-meta" key={index}>{warning}</p>)}
    {(episode as Episode & { final_needs_recompose?: boolean }).final_needs_recompose &&
      <p role="status">分镜已修改，当前成片为上一版。下载与分享仍使用上一版，生成并重新合成后更新。</p>}
    <MutationError error={mutation.error} />
    {editor?.kind === "insert" && editor.after === null && form(editor)}
    {episode.shots.length === 0 && <p className="k-empty">故事板为空。从开头添加第一镜，或稍后继续。</p>}
    <div className="k-storyboard-list">
      {episode.shots.map((shot, index) => {
        const id = shotIdentity(shot);
        return <Fragment key={id}>
          <article className="k-card k-storyboard-card" draggable={!disabled && !editor}
            onDragStart={(event) => { setDraggedId(id); event.dataTransfer.setData("text/plain", id); event.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => setDraggedId(null)} onDragOver={(event) => { if (draggedId && !disabled) event.preventDefault(); }}
            onDrop={(event) => { event.preventDefault(); if (draggedId) void reorder(draggedId, id); setDraggedId(null); }}>
            <div className="k-card-title">第 {shot.no} 镜 · {SHOT_SIZE_LABELS[shot.size]}</div>
            <div className="k-card-meta">{episode.scenes.find((scene) => scene.id === shot.scene)?.name ?? shot.scene} · 拖动卡片调整顺序，或使用上移 / 下移</div>
            <p>{shot.beat || "尚未填写画面动作"}</p>
            <p className="k-card-meta">字幕：{shot.caption || "无"}</p>
            <details><summary>画面描述</summary><p>{shot.kf_prompt || "尚未填写关键帧描述"}</p><p>{shot.motion_prompt || "尚未填写运动描述"}</p></details>
            <div className="k-desk-actions">
              <button type="button" className="k-btn k-btn-secondary k-btn-tiny" aria-label={`第 ${shot.no} 镜上移`} disabled={disabled || index === 0} onClick={() => move(id, -1)}>上移</button>
              <button type="button" className="k-btn k-btn-secondary k-btn-tiny" aria-label={`第 ${shot.no} 镜下移`} disabled={disabled || index === ids.length - 1} onClick={() => move(id, 1)}>下移</button>
              <button type="button" className="k-btn k-btn-secondary k-btn-tiny" disabled={disabled} onClick={() => setEditor({ kind: "visual", id })}>编辑画面</button>
              <button type="button" className="k-btn k-btn-secondary k-btn-tiny" disabled={disabled} onClick={() => setEditor({ kind: "caption", id })}>编辑字幕</button>
              <button type="button" className="k-btn k-btn-secondary k-btn-tiny" disabled={disabled} onClick={() => void remove(shot)}>删除</button>
              <button type="button" className="k-btn k-btn-secondary k-btn-tiny" disabled={disabled} onClick={() => setEditor({ kind: "insert", after: id })}>在此镜后插入</button>
            </div>
            {editor && editor.kind !== "insert" && editor.id === id && form(editor, shot)}
          </article>
          {editor?.kind === "insert" && editor.after === id && form(editor)}
        </Fragment>;
      })}
    </div>
    <button type="button" className="k-btn k-btn-secondary" disabled={disabled} onClick={() => setEditor({ kind: "insert", after: ids.at(-1) ?? null })}>在末尾添加一镜</button>
  </section>;
}
