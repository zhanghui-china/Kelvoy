export interface MutationVersion {
  episodeId: string;
  rowVersion: number;
}

/** A version from another episode cannot be reused for this episode's write. */
export function updateMutationVersion(current: MutationVersion, episodeId: string, rowVersion: number): MutationVersion {
  return { episodeId, rowVersion: current.episodeId === episodeId
    ? Math.max(current.rowVersion, rowVersion) : rowVersion };
}

export function versionForEpisode(episodeId: string | undefined,
  detail: { episode: { episode_id: string }; row_version: number } | null): number {
  return detail && detail.episode.episode_id === episodeId ? detail.row_version : 0;
}
