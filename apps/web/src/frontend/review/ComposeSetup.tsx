import { useRef, useState, type ReactNode } from "react";
import { originalAudioEnabled, subtitlesEnabled, type Episode } from "@kelvoy/engine";
import { continueEpisode, patchEpisode, retryFailedTask } from "../api/client";
import MusicSettings, { musicSettingsPatch } from "./MusicSettings";
import { GuideTip } from "../GuideTip";
import { MutationError } from "./ShotHeader";
import type { EpisodeMutation } from "./useEpisodeMutation";

/** Settings gate between approving every clip and submitting the compose job. */
export default function ComposeSetup({ episode, mutation, retryFailed = false, storyboard }: {
  episode: Episode; mutation: EpisodeMutation; retryFailed?: boolean; storyboard?: ReactNode;
}) {
  const [title, setTitle] = useState(episode.render.title);
  const [subtitles, setSubtitles] = useState(subtitlesEnabled(episode.render));
  const [transitions, setTransitions] = useState(episode.render.transitions_enabled === true);
  const submitting = useRef(false);
  const [queuedEpisode, setQueuedEpisode] = useState<Episode | null>(null);
  const retryQueued = queuedEpisode === episode;
  const [musicEnabled, setMusicEnabled] = useState(episode.music.enabled !== false);
  const [musicFile, setMusicFile] = useState(episode.music.file);
  const [originalAudio, setOriginalAudio] = useState(originalAudioEnabled(episode.render));
  const [intro, setIntro] = useState(episode.render.intro);
  const [outro, setOutro] = useState(episode.render.outro);
  const settingsChanged = title !== episode.render.title ||
    subtitles !== subtitlesEnabled(episode.render) ||
    transitions !== (episode.render.transitions_enabled === true) ||
    musicFile !== episode.music.file ||
    musicEnabled !== (episode.music.enabled !== false) ||
    originalAudio !== originalAudioEnabled(episode.render) ||
    intro !== episode.render.intro ||
    outro !== episode.render.outro;
  const fixed = episode.cut_policy === "fixed_1s";
  const long = episode.cut_policy === "long_3_6";
  const standardBookends = (!intro || intro === "intro/kelvoy_open.mp4") && (!outro || outro === "outro/kelvoy_close.mp4");
  const duration = fixed && standardBookends ? episode.shots.length + (intro ? 1.2 : 0) + (outro ? 1 : 0) : null;
  async function save() {
    if (submitting.current || mutation.pending || !settingsChanged || retryQueued || !title.trim()) return;
    submitting.current = true;
    try {
      const result = await mutation.run(rowVersion => patchEpisode(episode.episode_id, rowVersion,
        { render: { ...episode.render, title: title.trim(), subtitles_enabled: subtitles,
            transitions_enabled: transitions, original_audio_enabled: originalAudio, intro, outro },
          ...((musicFile !== episode.music.file || musicEnabled !== (episode.music.enabled !== false))
            ? { music: musicSettingsPatch(episode.music, musicEnabled, musicFile) } : {}) }));
      if (result?.ok) setTitle(title.trim());
    } finally {
      submitting.current = false;
    }
  }
  async function submit() {
    if (submitting.current || mutation.pending || settingsChanged || retryQueued) return;
    submitting.current = true;
    try {
      const result = await mutation.run(rowVersion => retryFailed
        ? retryFailedTask(episode.episode_id, rowVersion)
        : continueEpisode(episode.episode_id, rowVersion));
      if (result?.ok) setQueuedEpisode(episode);
    } finally {
      submitting.current = false;
    }
  }

  return (
    <section className="k-card k-compose-setup">
      <div className="k-eyebrow">第 5 步 · 合成与预览</div>
      <h2>合成设置</h2>
      <GuideTip section="compose">{fixed
        ? "调整标题、字幕、配乐与片头片尾后，先保存设置，再开始合成。下方时长按当前镜头数和首尾设置计算。"
        : long ? `每镜 3–6 秒，目标约 ${episode.brief.duration_s} 秒，片头片尾计入；实际分配由素材探测决定。调整后先保存设置，再开始合成。`
        : "旧版作品沿用原有节拍切点；调整标题、字幕、配乐与片头片尾后，先保存设置，再开始合成。"}</GuideTip>
      <p className="k-card-meta">
        {episode.shots.length} 镜 · {fixed ? `${duration === null ? "原有首尾素材时长合成时计算" : `${duration.toFixed(1)} 秒成片`}，每镜 ${episode.render.fps} 帧` : long ? `每镜 3–6 秒，目标约 ${episode.brief.duration_s} 秒，片头片尾计入` : "沿用旧项目的节拍切点"}
        {` · ${episode.render.res} · ${episode.render.fps} fps`}
      </p>
      <label className="k-field">
        成片标题
        <input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <div className="k-compose-options">
        <label><input type="checkbox" checked={subtitles} onChange={(event) => setSubtitles(event.target.checked)} /> 烧录每镜字幕</label>
        {fixed && <label><input type="checkbox" checked={transitions} onChange={(event) => setTransitions(event.target.checked)} /> 切点前后各 2 帧淡出淡入</label>}
      </div>
      <p className="k-card-meta">已填写字幕 {episode.shots.filter(shot => shot.caption?.trim()).length} / {episode.shots.length} 镜 · 空字幕不显示。{!subtitles && "本次成片不显示每镜字幕。"}</p>
      <MusicSettings enabled={musicEnabled} file={musicFile} originalAudio={originalAudio} disabled={mutation.pending || retryQueued}
        onEnabledChange={setMusicEnabled} onFileChange={setMusicFile} onOriginalAudioChange={setOriginalAudio} />
      <div className="k-compose-options">
        <label><input type="checkbox" checked={intro !== null} onChange={(event) => setIntro(event.target.checked ? "intro/kelvoy_open.mp4" : null)} /> {intro && intro !== "intro/kelvoy_open.mp4" ? `原有片头 · ${intro}` : "Kelvoy 片头 · 1.2 秒"}</label>
        <label><input type="checkbox" checked={outro !== null} onChange={(event) => setOutro(event.target.checked ? "outro/kelvoy_close.mp4" : null)} /> {outro && outro !== "outro/kelvoy_close.mp4" ? `原有片尾 · ${outro}` : "Kelvoy 片尾 · 1 秒"}</label>
      </div>
      <MutationError error={mutation.error} />
      {settingsChanged && <p role="status">合成设置尚未保存，请先保存设置，再{retryFailed ? "重试" : "开始合成"}。</p>}
      {retryQueued && <p role="status">合成任务已提交，等待后台处理。</p>}
      <div className="k-desk-actions">
        <button type="button" className="k-btn k-btn-secondary" disabled={mutation.pending || retryQueued || !settingsChanged || !title.trim()}
          onClick={() => void save()}>
          保存设置
        </button>
        <button type="button" className="k-btn k-btn-primary" disabled={mutation.pending || settingsChanged || retryQueued}
          onClick={() => void submit()}>
          {mutation.pending ? "提交中…" : retryFailed ? "重新执行失败任务" : "开始合成"}
        </button>
      </div>
      {storyboard}
    </section>
  );
}
