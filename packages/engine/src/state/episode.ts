import type { Episode, EpisodeStatus } from "../schema";
import { illegalTransition } from "./errors";

/**
 * Episode-level state machine (PRD v0.2 §6, FR-08). Pure — no IO, no
 * mutation of the input. Mirrors the review-gate pipeline:
 * draft → scripting → script_review → assets → keyframing → kf_review →
 * clipping → clip_review → composing → done, with any generating state
 * able to fail, and a reviewed episode able to reopen a review gate for
 * shot regeneration.
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
  | { type: "recompose" }
  | { type: "reopen_review"; into: "kf_review" | "clip_review" };

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
    case "reopen_review": {
      if (current === "done" || (current === "clip_review" && event.into === "kf_review")) {
        return event.into;
      }
      throw illegalTransition(current, event.type);
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
    { type: "reopen_review", into: "kf_review" },
    { type: "reopen_review", into: "clip_review" },
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

/**
 * Review 1 (FR-05, PRD v0.2 §4「可改镜头顺序」): reorders the whole shot
 * list into `order` (a permutation of the current `shots[].no`) and
 * renumbers `no` to 1..n.
 *
 * Renumbering is only safe at review 1, hence the status guard: before the
 * assets/keyframe stages run, no artifact key (kf/07_a.png, clip/07.mp4)
 * or queued task references a shot number yet, so changing `no` cannot
 * orphan anything. Reordering later would have to rename files and rewrite
 * in-flight tasks — out of scope, and the guard makes that explicit rather
 * than leaving it to the caller.
 *
 * Returns a new Episode; does not mutate the input. FR-02 re-validation
 * (size_run changes when shots move) is the caller's job, same as
 * removeShot.
 */
export function reorderShots(episode: Episode, order: number[]): Episode {
  if (episode.status !== "script_review") {
    throw illegalTransition(episode.status, "reorder_shots");
  }
  const byNo = new Map(episode.shots.map((s) => [s.no, s]));
  if (order.length !== episode.shots.length || new Set(order).size !== order.length) {
    throw new Error(`reorder order must be a permutation of the ${episode.shots.length} current shots`);
  }
  const shots = order.map((no, index) => {
    const shot = byNo.get(no);
    if (!shot) throw new Error(`reorder order references unknown shot ${no}`);
    return { ...shot, no: index + 1 };
  });
  return { ...episode, shots };
}
