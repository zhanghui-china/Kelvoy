import type { Episode } from "@kelvoy/engine";

/** List-page wire model. Prompt text, media keys and model history stay in detail. */
export type EpisodeOverview = Pick<Episode,
  "episode_id" | "name" | "status" | "persona_id" | "destination_id" | "created_at" | "credits_used"
> & {
  render: Pick<Episode["render"], "title">;
  season: string;
  shot_count: number;
  approved_shot_count: number;
  any_shot_started: boolean;
  all_keyframes_selected: boolean;
  all_shots_approved: boolean;
};
