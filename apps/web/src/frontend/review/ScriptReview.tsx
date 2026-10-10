import { useState } from "react";
import type { Destination, Episode } from "@kelvoy/engine";
import { continueEpisode, optimizeScript, regenerateScript, type StoryboardPrices } from "../api/client";
import { SHOT_CAMERA_LABELS, SHOT_SIZE_LABELS } from "../labels";
import { GuideTip } from "../GuideTip";
import StoryboardEditor from "./StoryboardEditor";
import { downloadScriptCsv } from "./scriptExport";
import type { EpisodeMutation } from "./useEpisodeMutation";

export default function ScriptReview({ episode, destination, mutation, busy = false, warnings, prices, showEditor = true }: {
  episode: Episode; destination: Destination | null; mutation: EpisodeMutation;
  busy?: boolean; warnings?: string[]; prices?: StoryboardPrices; showEditor?: boolean;
}) {
  const [view, setView] = useState<"script" | "storyboard">("script");
  const [instruction, setInstruction] = useState("");
  const scriptBusy = Boolean(episode.script_pending_task_id);
  const disabled = mutation.pending || scriptBusy || busy;
  return <section className="k-desk-main">
    <div className="k-desk-toolbar">
      <div className="k-card-title">审核 1 · 脚本</div><span className="k-nav-spacer" />
      <button type="button" className="k-btn k-btn-secondary k-btn-tiny" onClick={() => downloadScriptCsv(episode, destination)}>导出脚本 CSV</button>
      <div className="k-desk-viewswitch" role="group" aria-label="查看模式">
        <button type="button" className="k-btn k-btn-secondary k-btn-tiny" aria-pressed={view === "script"} onClick={() => setView("script")}>脚本视图</button>
        <button type="button" className="k-btn k-btn-secondary k-btn-tiny" aria-pressed={view === "storyboard"} onClick={() => setView("storyboard")}>故事板视图</button>
      </div>
    </div>
    <GuideTip section="script">逐镜检查画面与字幕。{episode.cut_policy === "long_3_6" ? `每镜建议 3–6 秒，目标约 ${episode.brief.duration_s} 秒，片头片尾计入。` : episode.cut_policy === "fixed_1s" ? "每镜成片 1 秒。" : "沿用旧项目的节拍剪辑。"}镜头数量自由；可新增、删除、调整顺序，也可用 AI 补充建议。</GuideTip>
    <div className="k-desk-script-layout">
      <div className="k-desk-script-content">
        {view === "script" && <>
          <p className="k-card-meta k-desk-scroll-hint">表格可横向滚动查看全部字段。</p>
          <div className="k-desk-tablewrap"><table className="k-desk-table">
            <thead><tr><th>#</th><th>场景</th><th>景别</th><th>动作 beat</th><th>字幕</th>{episode.cut_policy === "long_3_6" && <th>建议时长</th>}<th>机位</th><th>关键帧描述</th></tr></thead>
            <tbody>{episode.shots.map((shot) => <tr key={(shot as typeof shot & { shot_id?: string }).shot_id ?? shot.no}>
              <td>{shot.no}</td><td>{episode.scenes.find((scene) => scene.id === shot.scene)?.name ?? shot.scene}</td>
              <td>{SHOT_SIZE_LABELS[shot.size]}</td><td>{shot.beat}</td><td>{shot.caption || "—"}</td>{episode.cut_policy === "long_3_6" && <td>{shot.duration_s} 秒</td>}<td>{SHOT_CAMERA_LABELS[shot.camera]}</td><td>{shot.kf_prompt || "—"}</td>
            </tr>)}</tbody>
          </table></div>
        </>}
        {showEditor && <StoryboardEditor episode={episode} destination={destination} mutation={mutation} busy={busy} warnings={warnings} prices={prices} />}
      </div>
      <div className="k-card k-desk-script-assistant">
        <div className="k-card-title">脚本助手</div>
        <p className="k-card-meta">已生成 {episode.shots.length} 镜。整份重新生成或优化会调整现有脚本，失败保留当前内容。</p>
        <p className="k-card-meta">{prices ? `每次重新生成或优化消耗 ${prices.script} 积分。` : "AI 操作报价加载中…"}</p>
        <label className="k-field">优化指令<textarea value={instruction} maxLength={500} disabled={disabled} onChange={(event) => setInstruction(event.target.value)} /></label>
        <div className="k-desk-actions">
          <button type="button" className="k-btn k-btn-secondary" disabled={disabled || !prices}
            onClick={() => mutation.run((version) => regenerateScript(episode.episode_id, version))}>重新生成</button>
          <button type="button" className="k-btn k-btn-secondary" disabled={disabled || !prices || !instruction.trim()}
            onClick={() => mutation.run((version) => optimizeScript(episode.episode_id, version, instruction.trim()))}>按指令优化</button>
        </div>
        {scriptBusy && <p role="status">脚本正在处理中，请稍候…</p>}
        {episode.script_action_error && <p role="alert">{episode.script_action_error}</p>}
      </div>
    </div>
    <div className="k-desk-actions"><button type="button" className="k-btn k-btn-primary" disabled={disabled || !episode.shots.length}
      onClick={() => mutation.run((version) => continueEpisode(episode.episode_id, version))}>
      {episode.video_source === "references" ? "继续 → 用人物与场景生成视频" : "继续 → 生成素材与关键帧"}
    </button></div>
  </section>;
}
