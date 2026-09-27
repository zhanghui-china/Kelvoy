import type { Episode, Shot } from "../schema";
import { transitionEpisode } from "../state";
import type { StageName } from "./index";

/** Apply one generation result to the latest episode without replacing other review edits. */
export function mergeGeneratedShotResult(
  stage: StageName,
  shotNo: number,
  started: Episode,
  latest: Episode,
  generated: Episode,
): Episode | null {
  if (stage !== "keyframe" && stage !== "video") return null;
  if (started.episode_id !== latest.episode_id || generated.episode_id !== latest.episode_id ||
      latest.status !== started.status || latest.persona_version !== started.persona_version ||
      latest.destination_version !== started.destination_version ||
      latest.candidate_count !== started.candidate_count ||
      JSON.stringify(latest.brief) !== JSON.stringify(started.brief)) return null;

  const prior = started.shots.find((shot) => shot.no === shotNo);
  const current = latest.shots.find((shot) => shot.no === shotNo);
  const result = generated.shots.find((shot) => shot.no === shotNo);
  const expected = stage === "keyframe" ? "generating_kf" : "generating_clip";
  const ready = stage === "keyframe" ? "kf_ready" : "clip_ready";
  if (!prior || !current || !result || prior.status !== expected || result.status !== ready ||
      JSON.stringify(prior) !== JSON.stringify(current)) return null;

  const shots: Shot[] = latest.shots.map((shot) => shot.no === shotNo ? result : shot);
  const allReady = shots.every((shot) => stage === "keyframe"
    ? shot.status === "kf_ready" || shot.status === "kf_selected"
    : shot.status === "clip_ready" || shot.status === "approved");
  const generating = stage === "keyframe" ? "keyframing" : "clipping";
  const status = latest.status === generating && allReady
    ? transitionEpisode(latest.status, { type: "advance" }) : latest.status;
  return { ...latest, shots, status };
}
