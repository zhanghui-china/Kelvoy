import { useState } from "react";
import { MUSIC_CATALOG, type Episode } from "@kelvoy/engine";
import { continueEpisode, patchEpisode } from "../api/client";
import { MutationError } from "./ShotHeader";
import type { EpisodeMutation } from "./useEpisodeMutation";

/** Settings gate between approving every clip and submitting the compose job. */
export default function ComposeSetup({ episode, mutation }: { episode: Episode; mutation: EpisodeMutation }) {
  const [title, setTitle] = useState(episode.render.title);
  const [subtitles, setSubtitles] = useState(episode.render.subtitles_enabled === true);
  const [transitions, setTransitions] = useState(episode.render.transitions_enabled === true);
  const [musicFile, setMusicFile] = useState(episode.music.file);
  const [intro, setIntro] = useState(episode.render.intro === "intro/kelvoy_open.mp4");
  const [outro, setOutro] = useState(episode.render.outro === "outro/kelvoy_close.mp4");
  const settingsChanged = title !== episode.render.title ||
    subtitles !== (episode.render.subtitles_enabled === true) ||
    transitions !== (episode.render.transitions_enabled === true) ||
    musicFile !== episode.music.file ||
    intro !== (episode.render.intro === "intro/kelvoy_open.mp4") ||
    outro !== (episode.render.outro === "outro/kelvoy_close.mp4");
  const fixed = episode.cut_policy === "fixed_1s";
  const duration = fixed ? episode.shots.length + (intro ? 1.2 : 0) + (outro ? 1 : 0) : null;
  const music = MUSIC_CATALOG.find((item) => item.file === musicFile);

  return (
    <section className="k-card k-compose-setup">
      <div className="k-eyebrow">第 5 步 · 合成与预览</div>
      <h2>合成设置</h2>
      <p className="k-card-meta">
        {episode.shots.length} 镜 · {fixed ? `${duration?.toFixed(1)} 秒成片，每镜 30 帧` : "沿用旧项目的节拍切点"}
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
      <label className="k-field">配乐
        <select value={musicFile} onChange={(event) => setMusicFile(event.target.value)}>
          <option value="">按创作语气自动选曲</option>
          {MUSIC_CATALOG.map((track) => <option key={track.file} value={track.file}>
            {track.file.split("/").pop()?.replace(".mp3", "").replaceAll("_", " ")} · {track.bpm} BPM
          </option>)}
        </select>
      </label>
      <div className="k-compose-options">
        <label><input type="checkbox" checked={intro} onChange={(event) => setIntro(event.target.checked)} /> Kelvoy 片头 · 1.2 秒</label>
        <label><input type="checkbox" checked={outro} onChange={(event) => setOutro(event.target.checked)} /> Kelvoy 片尾 · 1 秒</label>
      </div>
      <MutationError error={mutation.error} />
      <div className="k-desk-actions">
        <button type="button" className="k-btn k-btn-secondary" disabled={mutation.pending || !settingsChanged || !title.trim()}
          onClick={() => void mutation.run((rowVersion) => patchEpisode(episode.episode_id, rowVersion,
            { render: { ...episode.render, title: title.trim(), subtitles_enabled: subtitles,
                transitions_enabled: transitions, intro: intro ? "intro/kelvoy_open.mp4" : null,
                outro: outro ? "outro/kelvoy_close.mp4" : null },
              music: music ? { file: music.file, bpm: music.bpm, license: music.license }
                : { file: "", bpm: 0, license: "" } }))}>
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
