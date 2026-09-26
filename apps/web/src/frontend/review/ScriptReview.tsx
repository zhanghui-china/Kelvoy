import { useState } from "react";
import type { Destination, Episode, Shot } from "@kelvoy/engine";
import { continueEpisode, optimizeScript, regenerateScript, removeShot, reorderShots } from "../api/client";
import { SCENE_TIME_LABELS, SHOT_CAMERA_LABELS, SHOT_SIZE_LABELS } from "../labels";
import { GuideTip } from "../GuideTip";
import ShotEditor from "./ShotEditor";
import { MutationError } from "./ShotHeader";
import type { EpisodeMutation } from "./useEpisodeMutation";

// FR-02 的下限，和 engine 的 MIN_SHOTS 同一个数——这里只用来显示"当前 N
// 镜，下限 24"，真正的拦截在服务端（删镜路由 + checkScriptRules）。
const MIN_SHOTS = 24;

type ViewMode = "script" | "storyboard";

function sceneLabel(episode: Episode, shot: Shot): { name: string; time: string } {
  const scene = episode.scenes.find((s) => s.id === shot.scene);
  return {
    name: scene?.name ?? shot.scene,
    time: scene ? SCENE_TIME_LABELS[scene.time] : "—",
  };
}

function landmarkLabel(destination: Destination | null, shot: Shot): string {
  if (shot.landmark === null) return "—";
  return destination?.landmarks.find((l) => l.id === shot.landmark)?.name ?? shot.landmark;
}

/**
 * 审核 1（PRD §4）：改镜头顺序 / 动作 beat / 景别 / 机位 / 地标 / prompt，
 * 可删镜（下限 24），**不可新增镜**——所以这里没有"+ 插入一镜"。
 */
export default function ScriptReview({
  episode,
  destination,
  mutation,
}: {
  episode: Episode;
  destination: Destination | null;
  mutation: EpisodeMutation;
}) {
  const [view, setView] = useState<ViewMode>("script");
  const [editing, setEditing] = useState<number | null>(null);
  const [instruction, setInstruction] = useState("");

  const shots = episode.shots;
  const scriptBusy = Boolean(episode.script_pending_task_id);
  const actionDisabled = mutation.pending || scriptBusy;

  async function move(shotNo: number, delta: number) {
    const order = shots.map((s) => s.no);
    const index = order.indexOf(shotNo);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    // 失败（FR-02 违规）时什么都不做：顺序的真源是服务端，本地没有影子副本
    // 可以回滚，重排成功后下一次轮询自然带回新顺序。
    await mutation.run((rowVersion) => reorderShots(episode.episode_id, rowVersion, order));
  }

  async function handleRemove(shotNo: number) {
    if (!window.confirm(`确认删除第 ${shotNo} 镜？删掉的镜会留在 removed_shots 里。`)) return;
    await mutation.run((rowVersion) => removeShot(episode.episode_id, shotNo, rowVersion));
  }

  function shotActions(shot: Shot, index: number) {
    return (
      <div className="k-desk-actions">
        <button
          type="button"
          className="k-btn k-btn-secondary k-btn-tiny"
          aria-label={`第 ${shot.no} 镜上移`}
          disabled={index === 0 || actionDisabled}
          onClick={() => move(shot.no, -1)}
        >
          上移
        </button>
        <button
          type="button"
          className="k-btn k-btn-secondary k-btn-tiny"
          aria-label={`第 ${shot.no} 镜下移`}
          disabled={index === shots.length - 1 || actionDisabled}
          onClick={() => move(shot.no, 1)}
        >
          下移
        </button>
        <button
          type="button"
          className="k-btn k-btn-secondary k-btn-tiny"
          disabled={actionDisabled}
          onClick={() => setEditing(editing === shot.no ? null : shot.no)}
        >
          {editing === shot.no ? "收起" : "编辑"}
        </button>
        <button
          type="button"
          className="k-btn k-btn-secondary k-btn-tiny"
          disabled={shots.length <= MIN_SHOTS || actionDisabled}
          onClick={() => handleRemove(shot.no)}
        >
          删除
        </button>
      </div>
    );
  }

  function editor(shot: Shot) {
    return (
      <ShotEditor
        key={`editor-${shot.no}`}
        episodeId={episode.episode_id}
        shot={shot}
        destination={destination}
        mutation={mutation}
        onSaved={() => setEditing(null)}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <section className="k-desk-main">
      <div className="k-desk-toolbar">
        <div className="k-card-title">审核 1 · 脚本</div>
        <span className="k-nav-spacer" />
        <div className="k-desk-viewswitch" role="group" aria-label="查看模式">
          <button
            type="button"
            className={`k-btn k-btn-secondary k-btn-tiny ${view === "script" ? "is-active" : ""}`}
            onClick={() => setView("script")}
          >
            脚本视图
          </button>
          <button
            type="button"
            className={`k-btn k-btn-secondary k-btn-tiny ${view === "storyboard" ? "is-active" : ""}`}
            onClick={() => setView("storyboard")}
          >
            故事板视图
          </button>
        </div>
      </div>

      <GuideTip section="script">逐镜检查动作、地标与字幕。小改动可直接编辑；调整叙事可按指令优化，想重写整份再重新生成。</GuideTip>
      <p className="k-card-meta">
        当前 {shots.length} 镜，下限 {MIN_SHOTS} 镜。审核 1 只能改、删，不能新增镜（PRD §4）。
      </p>
      <div className="k-card k-desk-script-assistant">
        <div className="k-card-title">脚本助手</div>
        <p className="k-card-meta">已生成 {shots.length} 镜；可重新生成整份脚本，或描述想调整的叙事重点。处理失败会保留当前脚本。</p>
        <p className="k-card-meta">优化与重新生成可能消耗积分；这里不会显示每次操作的单独报价。</p>
        <label className="k-field">
          优化指令
          <textarea value={instruction} maxLength={500} disabled={actionDisabled}
            placeholder="例如：增加夜景镜头，让美食段落更有生活感"
            onChange={(event) => setInstruction(event.target.value)} />
        </label>
        <div className="k-desk-actions">
          <button type="button" className="k-btn k-btn-secondary" disabled={actionDisabled}
            onClick={() => mutation.run((rowVersion) => regenerateScript(episode.episode_id, rowVersion))}>
            重新生成
          </button>
          <button type="button" className="k-btn k-btn-secondary" disabled={actionDisabled || !instruction.trim()}
            onClick={() => mutation.run((rowVersion) => optimizeScript(episode.episode_id, rowVersion, instruction.trim()))}>
            按指令优化
          </button>
        </div>
        {scriptBusy && <p role="status">脚本正在处理中，请稍候…</p>}
        {episode.script_action_error && <p role="alert">{episode.script_action_error}</p>}
      </div>
      <MutationError error={mutation.error} />

      {view === "script" ? (
        <div className="k-desk-tablewrap">
          <table className="k-desk-table">
            <thead>
              <tr>
                <th>#</th>
                <th>场景</th>
                <th>时段</th>
                <th>景别</th>
                <th>动作 beat</th>
                <th>字幕</th>
                <th>机位</th>
                <th>地标</th>
                <th>关键帧 prompt</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {shots.map((shot, index) => {
                const scene = sceneLabel(episode, shot);
                return [
                  <tr key={shot.no}>
                    <td>{shot.no}</td>
                    <td>{scene.name}</td>
                    <td>{scene.time}</td>
                    <td>{SHOT_SIZE_LABELS[shot.size]}</td>
                    <td>{shot.beat}</td>
                    <td>{shot.caption || "—"}</td>
                    <td>{SHOT_CAMERA_LABELS[shot.camera]}</td>
                    <td>{landmarkLabel(destination, shot)}</td>
                    <td className="k-desk-prompt-cell">{shot.kf_prompt || "—"}</td>
                    <td>{shotActions(shot, index)}</td>
                  </tr>,
                  editing === shot.no ? (
                    <tr key={`${shot.no}-editor`}>
                      <td colSpan={10}>{editor(shot)}</td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="k-desk-board">
          {shots.map((shot, index) => {
            const scene = sceneLabel(episode, shot);
            return (
              <article key={shot.no} className="k-card k-desk-card">
                <div className="k-card-title">
                  第 {shot.no} 镜 · {SHOT_SIZE_LABELS[shot.size]}
                </div>
                <div className="k-card-meta">
                  {scene.name} · {scene.time} · {SHOT_CAMERA_LABELS[shot.camera]} · 地标{" "}
                  {landmarkLabel(destination, shot)}
                </div>
                <p>{shot.beat}</p>
                <p className="k-card-meta">字幕：{shot.caption || "—"}</p>
                <div className="k-card-meta k-desk-prompt-cell">{shot.kf_prompt || "还没有 prompt"}</div>
                {shotActions(shot, index)}
                {editing === shot.no && editor(shot)}
              </article>
            );
          })}
        </div>
      )}

      <div className="k-desk-actions">
        <button
          type="button"
          className="k-btn k-btn-primary"
          disabled={actionDisabled}
          onClick={() => mutation.run((rowVersion) => continueEpisode(episode.episode_id, rowVersion))}
        >
          继续 → 生成素材与关键帧
        </button>
      </div>
    </section>
  );
}
