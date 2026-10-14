import { MUSIC_CATALOG, type Episode } from "@kelvoy/engine";

/** Both settings screens retain the selected track when music is switched off. */
export default function MusicSettings({ enabled, file, originalAudio, disabled, onEnabledChange, onFileChange, onOriginalAudioChange }: {
  enabled: boolean;
  originalAudio: boolean;
  file: string;
  disabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onFileChange: (file: string) => void;
  onOriginalAudioChange: (originalAudio: boolean) => void;
}) {
  const selected = MUSIC_CATALOG.find(track => track.file === file);
  return <>
    <div className="k-compose-options">
      <label><input type="checkbox" aria-label="启用配乐" checked={enabled} disabled={disabled}
        onChange={event => onEnabledChange(event.target.checked)} /> 启用配乐</label>
      <label><input type="checkbox" aria-label="保留视频原声" checked={originalAudio} disabled={disabled}
        onChange={event => onOriginalAudioChange(event.target.checked)} /> 保留视频原声（脚步声、环境音）</label>
    </div>
    <label className="k-field">配乐
      <select aria-label="配乐曲目" disabled={disabled || !enabled} value={file}
        onChange={event => onFileChange(event.target.value)}>
        <option value="">按创作语气自动选曲</option>
        {file && !selected && <option value={file}>原有配乐 · {file}</option>}
        {MUSIC_CATALOG.map(track => <option key={track.file} value={track.file}>
          {track.file.split("/").pop()?.replace(".mp3", "").replaceAll("_", " ")} · {track.bpm} BPM
        </option>)}
      </select>
    </label>
    {!enabled && <p className="k-card-meta">
      {originalAudio ? "成片只保留视频原声，不含配乐" : "成片不包含音轨"}；已选配乐会保留，重新开启后可继续使用。
    </p>}
  </>;
}

export function musicSettingsPatch(current: Episode["music"], enabled: boolean, file: string): Episode["music"] {
  if (file === current.file) return { ...current, enabled };
  const selected = MUSIC_CATALOG.find(track => track.file === file);
  return { ...current, enabled, file, bpm: selected?.bpm ?? 0, license: selected?.license ?? "" };
}
