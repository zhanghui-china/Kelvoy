import { useState } from "react";
import type { Episode } from "@kelvoy/engine";
import { upgradeToLongCuts } from "../api/client";
import type { EpisodeMutation } from "./useEpisodeMutation";

/** Legacy (fixed_1s / beat_aligned) films only. Long shots need 3–6 s each, so the target length is chosen here. */
export function canUpgradeToLongCuts(episode: Episode): boolean {
  return episode.cut_policy !== "long_3_6" && episode.mode === "per_shot" &&
    episode.shots.length > 0 && episode.shots.every((shot) => !!shot.clip);
}

export default function UpgradeLongCutsCard({ episode, mutation, title, hint }: {
  episode: Episode; mutation: EpisodeMutation; title: string; hint: string;
}) {
  const shots = episode.shots.length;
  const [duration, setDuration] = useState(String(Math.min(shots * 6, Math.max(shots * 3, Math.round(shots * 4)))));
  const value = Number(duration);
  const feasible = Number.isFinite(value) && value >= shots * 3 && value <= shots * 6;
  function submit() {
    if (!window.confirm("升级后需要逐镜重新确认起点并重新合成，现有成片在完成新合成前暂停交付。确认升级？")) return;
    void mutation.run((rowVersion) => upgradeToLongCuts(episode.episode_id, rowVersion, value));
  }
  return <div className="k-card">
    <div className="k-card-title">{title}</div>
    <p className="k-card-meta">{hint}</p>
    <label className="k-field">目标总时长（秒，含片头片尾）
      <input type="number" min={shots * 3} max={shots * 6} step={1} value={duration}
        onChange={(e) => setDuration(e.target.value)} aria-invalid={!feasible} />
    </label>
    <p className="k-card-meta" role={feasible ? undefined : "alert"}>
      当前 {shots} 镜，每镜 3–6 秒，可选 {shots * 3}–{shots * 6} 秒。{feasible ? "" : "超出范围，请调整时长或先在分镜编辑里删减镜头。"}
    </p>
    <button type="button" className="k-btn k-btn-secondary" disabled={mutation.pending || !feasible} onClick={submit}>
      升级为 3–6 秒长镜头
    </button>
  </div>;
}
