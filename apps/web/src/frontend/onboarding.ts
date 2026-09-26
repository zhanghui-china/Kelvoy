import type { Episode } from "@kelvoy/engine";

export interface OnboardingState {
  completed: [boolean, boolean, boolean, boolean, boolean];
  href: string;
  failed: boolean;
  targetDone: boolean;
}

/** Account progress is recomputed from owned episodes, never stored as a second checklist. */
export function deriveOnboarding(episodes: Episode[]): OnboardingState {
  const byNewest = [...episodes].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const next = byNewest.find((episode) => episode.status !== "done") ?? byNewest[0];
  const scriptPassed = new Set<Episode["status"]>([
    "assets", "keyframing", "kf_review", "clipping", "clip_review", "compose_ready", "composing", "done",
  ]);
  const keyframesPassed = new Set<Episode["status"]>([
    "clipping", "clip_review", "compose_ready", "composing", "done",
  ]);
  const clipsPassed = new Set<Episode["status"]>(["compose_ready", "composing", "done"]);
  const completed: OnboardingState["completed"] = [
    episodes.length > 0,
    episodes.some((episode) => scriptPassed.has(episode.status) ||
      episode.shots.some((shot) => shot.status !== "draft")),
    episodes.some((episode) => keyframesPassed.has(episode.status) ||
      (episode.shots.length > 0 && episode.shots.every((shot) => !!shot.kf_selected))),
    episodes.some((episode) => clipsPassed.has(episode.status) ||
      (episode.shots.length > 0 && episode.shots.every((shot) => shot.status === "approved"))),
    episodes.some((episode) => episode.status === "done"),
  ];
  return {
    completed,
    href: next ? `/episodes/${next.episode_id}` : "/episodes/new",
    failed: next?.status === "failed",
    targetDone: next?.status === "done",
  };
}
