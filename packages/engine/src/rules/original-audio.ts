import type { EpisodeRender } from "../schema/episode";

/** Opt-in: episodes without a saved choice keep composing a silent (or music-only) cut. */
export function originalAudioEnabled(render: Pick<EpisodeRender, "original_audio_enabled">): boolean {
  return render.original_audio_enabled === true;
}
