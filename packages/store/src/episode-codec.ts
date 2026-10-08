import type { Episode } from "@kelvoy/engine";

/** Decode historical rows consistently across read and transactional commands. */
export function decodeEpisode(doc: string): Episode {
  const episode = JSON.parse(doc) as Episode;
  return {
    ...episode,
    shots: (episode.shots ?? []).map((shot, i) => ({ ...shot, shot_id: shot.shot_id ?? `sh_${episode.episode_id}_active_${i}_${shot.no}` })),
    removed_shots: (episode.removed_shots ?? []).map((shot, i) => ({ ...shot, shot_id: shot.shot_id ?? `sh_${episode.episode_id}_removed_${i}_${shot.no}` })),
    name: episode.name ?? (episode.render.title || episode.destination_id),
    candidate_count: episode.candidate_count ?? 2,
    cut_policy: episode.cut_policy ?? "beat_aligned",
    brief: { ...episode.brief, aspect: episode.brief.aspect ?? "9:16",
      requirements: episode.brief.requirements ?? "" },
  };
}
