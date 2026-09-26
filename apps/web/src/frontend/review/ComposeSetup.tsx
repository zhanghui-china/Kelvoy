import { useState } from "react";
import type { Episode } from "@kelvoy/engine";
import { continueEpisode, patchEpisode } from "../api/client";
import { MutationError } from "./ShotHeader";
import type { EpisodeMutation } from "./useEpisodeMutation";

/** Settings gate between approving every clip and submitting the compose job. */
export default function ComposeSetup({ episode, mutation }: { episode: Episode; mutation: EpisodeMutation }) {
  const [title, setTitle] = useState(episode.render.title);
  const [subtitles, setSubtitles] = useState(episode.render.subtitles_enabled === true);
  const [transitions, setTransitions] = useState(episode.render.transitions_enabled === true);
  const settingsChanged = title !== episode.render.title ||
    subtitles !== (episode.render.subtitles_enabled === true) ||
    transitions !== (episode.render.transitions_enabled === true);
  const fixed = episode.cut_policy === "fixed_1s";

  return (
    <section className="k-card k-compose-setup">
      <div className="k-eyebrow">第 5 步 · 合成与预览</div>
      <h2>合成设置</h2>
      <p className="k-card-meta">
        {episode.shots.length} 镜 · {fixed ? `${episode.shots.length} 秒正片，每镜 30 帧` : "沿用旧项目的节拍切点"}
        {` · ${episode.render.res} · ${episode.render.fps} fps`}
      </p>
      <label className="k-field">
        成片标题
        <input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
      </label>
      {fixed && <div className="k-compose-options">
        <label><input type="checkbox" checked={subtitles} onChange={(event) => setSubtitles(event.target.checked)} /> 烧录每镜字幕</label>
        <label><input type="checkbox" checked={transitions} onChange={(event) => setTransitions(event.target.checked)} /> 切点前后各 2 帧淡出淡入</label>
      </div>}
      <p className="k-card-meta">配乐：{episode.music.file || "按创作语气自动选择"}</p>
      <p className="k-card-meta">片头：{episode.render.intro || "关闭"} · 片尾：{episode.render.outro || "关闭"}</p>
      <MutationError error={mutation.error} />
      <div className="k-desk-actions">
        <button type="button" className="k-btn k-btn-secondary" disabled={mutation.pending || !settingsChanged || !title.trim()}
          onClick={() => void mutation.run((rowVersion) => patchEpisode(episode.episode_id, rowVersion,
            { render: { ...episode.render, title: title.trim(), subtitles_enabled: subtitles, transitions_enabled: transitions } }))}>
          保存设置
        </button>
        <button type="button" className="k-btn k-btn-primary" disabled={mutation.pending || settingsChanged}
          onClick={() => void mutation.run((rowVersion) => continueEpisode(episode.episode_id, rowVersion))}>
          {mutation.pending ? "提交中…" : "开始合成"}
        </button>
      </div>
    </section>
  );
}
