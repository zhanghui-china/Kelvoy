import type { Episode } from "../schema";

/** Preconditions shared by the public review route and the transactional command. */
export function reviewAdvanceError(episode: Episode):
  "keyframes_not_selected" | "clips_not_approved" | null {
  if (episode.status === "kf_review" &&
      (!episode.shots.some((shot) => shot.status === "kf_selected") ||
       episode.shots.some((shot) =>
         !(shot.status === "approved" && !!shot.clip) &&
         (shot.status !== "kf_selected" || !shot.kf_selected ||
          !shot.candidates.includes(shot.kf_selected))))) return "keyframes_not_selected";
  if ((episode.status === "clip_review" || episode.status === "compose_ready") &&
      (episode.shots.length === 0 || episode.shots.some((shot) =>
        shot.status !== "approved" || !shot.clip))) return "clips_not_approved";
  return null;
}
