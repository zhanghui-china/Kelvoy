import type { Episode, EpisodeStatus, Shot } from '../schema';

export function hasUsableClip(shot: Shot): boolean {
  return !!shot.clip && (shot.status === 'approved' || shot.status === 'clip_ready');
}
export function hasSelectedFrame(shot: Shot): boolean {
  return !!shot.kf_selected && shot.candidates.includes(shot.kf_selected);
}
/** Only missing work is planned; a reordered shot keeps its existing references. */
export function planStoryboardGeneration(episode: Episode): {
  next_status: EpisodeStatus; keyframes: Shot[]; videos: Shot[];
} {
  const missing = episode.shots.filter(shot => !hasUsableClip(shot));
  if (episode.video_source === 'references') {
    return { next_status: missing.length ? 'assets' :
      episode.shots.every(shot => shot.status === 'approved') ? 'compose_ready' : 'clip_review',
      keyframes: [], videos: missing };
  }
  const keyframes = missing.filter(shot => !hasSelectedFrame(shot) && !(shot.candidates?.length));
  if (keyframes.length) return { next_status: 'assets', keyframes, videos: [] };
  if (missing.some(shot => !hasSelectedFrame(shot))) {
    return { next_status: 'kf_review', keyframes: [], videos: [] };
  }
  return { next_status: missing.length ? 'assets' :
    episode.shots.every(shot => shot.status === 'approved') ? 'compose_ready' : 'clip_review',
    keyframes: [], videos: missing };
}
