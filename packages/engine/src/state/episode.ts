import type { Episode, EpisodeStatus } from "../schema";
import { illegalTransition } from "./errors";

/**
 * Episode-level state machine (PRD v0.2 §6, FR-08). Pure — no IO, no
 * mutation of the input. Mirrors the review-gate pipeline:
 * draft → scripting → script_review → assets → keyframing → kf_review →
 * clipping → clip_review → composing → done, with any generating state
 * able to fail, and done able to re-enter composing (重新合成).
 */

export type GeneratingEpisodeStatus = "scripting" | "assets" | "keyframing" | "clipping" | "composing";

const GENERATING_STATES = new Set<EpisodeStatus>([
  "scripting",
  "assets",
  "keyframing",
  "clipping",
  "composing",
]);

// current -> next when the user/worker advances the pipeline one step.
const ADVANCE: Partial<Record<EpisodeStatus, EpisodeStatus>> = {
  draft: "scripting",
  scripting: "script_review",
  script_review: "assets",
  assets: "keyframing",
  keyframing: "kf_review",
  kf_review: "clipping",
  clipping: "clip_review",
  clip_review: "composing",
  composing: "done",
};

export type EpisodeEvent =
  | { type: "advance" }
  | { type: "fail" }
  | { type: "retry"; into: GeneratingEpisodeStatus }
  | { type: "recompose" };

export function transitionEpisode(current: EpisodeStatus, event: EpisodeEvent): EpisodeStatus {
  switch (event.type) {
    case "advance": {
      const next = ADVANCE[current];
      if (!next) throw illegalTransition(current, event.type);
      return next;
    }
    case "fail": {
      if (!GENERATING_STATES.has(current)) throw illegalTransition(current, event.type);
      return "failed";
    }
    case "retry": {
      if (current !== "failed") throw illegalTransition(current, event.type);
      return event.into;
    }
    case "recompose": {
      if (current !== "done") throw illegalTransition(current, event.type);
      return "composing";
    }
  }
}

const RETRY_TARGETS: GeneratingEpisodeStatus[] = [
  "scripting",
  "assets",
  "keyframing",
  "clipping",
  "composing",
];

/**
 * Internal-API write-back (docs/contracts/internal-api.md) carries a target
 * `status` value, not an event — the caller doesn't know this module's event
 * vocabulary. This checks whether *any* legal event would produce `to` from
 * `from`, so a PATCH handler can validate an arbitrary status write without
 * re-deriving the event itself.
 */
export function isLegalEpisodeStatusChange(from: EpisodeStatus, to: EpisodeStatus): boolean {
  const events: EpisodeEvent[] = [
    { type: "advance" },
    { type: "fail" },
    { type: "recompose" },
    ...RETRY_TARGETS.map((into): EpisodeEvent => ({ type: "retry", into })),
  ];
  return events.some((event) => {
    try {
      return transitionEpisode(from, event) === to;
    } catch {
      return false;
    }
  });
}

/** Review 1 (FR-02): the floor below which a script may not be cut. */
export const MIN_SHOTS = 24;

/**
 * Deletes a shot at review 1 — moves it from `shots` into `removed_shots`
 * rather than discarding it, and enforces the MIN_SHOTS floor (PRD v0.2 §4).
 * Returns a new Episode; does not mutate the input.
 */
export function removeShot(episode: Episode, shotNo: number): Episode {
  const shot = episode.shots.find((s) => s.no === shotNo);
  if (!shot) {
    throw new Error(`shot ${shotNo} not found in episode ${episode.episode_id}`);
  }
  if (episode.shots.length - 1 < MIN_SHOTS) {
    throw new Error(
      `cannot remove shot ${shotNo}: episode would drop below the ${MIN_SHOTS}-shot floor`,
    );
  }
  return {
    ...episode,
    shots: episode.shots.filter((s) => s.no !== shotNo),
    removed_shots: [...episode.removed_shots, shot],
  };
}
