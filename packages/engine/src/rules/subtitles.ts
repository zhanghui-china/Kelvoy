import type { EpisodeRender } from "../schema/episode";

/** Legacy episodes without a saved choice burn captions on the next compose. */
export function subtitlesEnabled(render: Pick<EpisodeRender, "subtitles_enabled">): boolean {
  return render.subtitles_enabled !== false;
}
