import { useState } from "react";
import type { Episode, Landmark, Shot } from "@kelvoy/engine";
import { assetUrl, patchShot, regenShot } from "../api/client";
import { describeWriteError } from "./errors";
import { canRegen } from "./shot-rules";
import type { EpisodeMutation } from "./useEpisodeMutation";

type Choice = number | "none";

/**
 * kf_review: pick which picture of the shot's landmark the keyframe is generated from, or none.
 * The choice is applied together with a regeneration of this shot only (patch, then regen), so the
 * reviewer pays for one regeneration, not one per click. Hidden for direct-video episodes, whose video
 * stage always uses the landmark's first picture (so a different keyframe reference would disagree).
 */
export function LandmarkRefPicker({ episode, shot, landmark, current, personOmitted, locked, mutation, onError }: {
  episode: Episode;
  shot: Shot;
  landmark: Landmark;
  current: Choice;
  personOmitted: boolean;
  locked: string | null;
  mutation: EpisodeMutation;
  onError: (message: string | null) => void;
}) {
  const [choice, setChoice] = useState<Choice>(current);
  if (episode.video_source === "references" || episode.status !== "kf_review") return null;
  // An empty shot with no landmark picture would have no reference at all.
  const noneBlocked = shot.person_visible === false;
  const unchanged = choice === current;
  const disabled = locked !== null || mutation.pending || !canRegen(shot) || unchanged;

  async function apply() {
    onError(null);
    const patched = await mutation.run((rowVersion) =>
      patchShot(episode.episode_id, shot.no, rowVersion, { landmark_ref: choice }));
    if (!patched) return;
    if (!patched.ok) { onError(describeWriteError(patched)); return; }
    const regen = await mutation.run((rowVersion) => regenShot(episode.episode_id, shot.no, rowVersion, "keyframe"));
    if (regen && !regen.ok) onError(describeWriteError(regen));
  }

  return (
    <fieldset className="k-landmark-ref" disabled={mutation.pending}>
      <legend className="k-card-meta">换地标参考图（只重生成本镜）</legend>
      <div className="k-landmark-ref-list" role="group" aria-label={`${landmark.name} 的参考图`}>
        {landmark.refs.map((key, index) => (
          <button key={key} type="button" className={`k-landmark-ref-item ${choice === index ? "is-selected" : ""}`}
            aria-pressed={choice === index} onClick={() => setChoice(index)}>
            <img src={assetUrl(key)} alt={`${landmark.name} 第 ${index + 1} 张`} loading="lazy" />
            <span>第 {index + 1} 张</span>
          </button>
        ))}
        <button type="button" className={`k-landmark-ref-item k-landmark-ref-none ${choice === "none" ? "is-selected" : ""}`}
          aria-pressed={choice === "none"} disabled={noneBlocked} onClick={() => setChoice("none")}
          title={noneBlocked ? "空镜需要地标图，不能选不使用" : undefined}>
          不使用地标图
        </button>
      </div>
      {choice === "none" && <p className="k-card-meta">不带地标图时，画面描述里的地标场景可能画得不准，可先修改画面描述。</p>}
      {personOmitted && <p className="k-card-meta">本镜是空镜，地标图是唯一的参考图。</p>}
      <button type="button" className="k-btn k-btn-secondary k-btn-tiny" disabled={disabled} onClick={apply}>
        用所选参考图重生成
      </button>
    </fieldset>
  );
}
