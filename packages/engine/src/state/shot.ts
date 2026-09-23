import type { ShotStatus } from "../schema";
import { illegalTransition } from "./errors";

/**
 * Shot-level state machine (PRD v0.2 §6, FR-08). Pure — no IO.
 * draft → generating_kf → kf_ready → kf_selected → generating_clip →
 * clip_ready → approved, with regeneration requests from kf_ready /
 * clip_ready / approved (a "坏镜" report can fire even after approval)
 * going to rejected, and generating states able to fail.
 */

export type GeneratingShotStatus = "generating_kf" | "generating_clip";

const GENERATING_STATES = new Set<ShotStatus>(["generating_kf", "generating_clip"]);
const REGEN_SOURCE_STATES = new Set<ShotStatus>(["kf_ready", "clip_ready", "approved"]);

export type ShotEvent =
  | { type: "start_keyframe" } // draft -> generating_kf
  | { type: "keyframe_ready" } // generating_kf -> kf_ready
  | { type: "select_keyframe" } // kf_ready -> kf_selected
  | { type: "start_clip" } // kf_selected -> generating_clip
  | { type: "clip_ready" } // generating_clip -> clip_ready
  | { type: "approve" } // clip_ready -> approved
  | { type: "request_regen" } // kf_ready | clip_ready | approved -> rejected
  | { type: "fail" } // generating_kf | generating_clip -> failed
  | { type: "retry"; into: GeneratingShotStatus }; // rejected | failed -> generating_*

export function transitionShot(current: ShotStatus, event: ShotEvent): ShotStatus {
  switch (event.type) {
    case "start_keyframe": {
      if (current !== "draft") throw illegalTransition(current, event.type);
      return "generating_kf";
    }
    case "keyframe_ready": {
      if (current !== "generating_kf") throw illegalTransition(current, event.type);
      return "kf_ready";
    }
    case "select_keyframe": {
      if (current !== "kf_ready") throw illegalTransition(current, event.type);
      return "kf_selected";
    }
    case "start_clip": {
      if (current !== "kf_selected") throw illegalTransition(current, event.type);
      return "generating_clip";
    }
    case "clip_ready": {
      if (current !== "generating_clip") throw illegalTransition(current, event.type);
      return "clip_ready";
    }
    case "approve": {
      if (current !== "clip_ready") throw illegalTransition(current, event.type);
      return "approved";
    }
    case "request_regen": {
      if (!REGEN_SOURCE_STATES.has(current)) throw illegalTransition(current, event.type);
      return "rejected";
    }
    case "fail": {
      if (!GENERATING_STATES.has(current)) throw illegalTransition(current, event.type);
      return "failed";
    }
    case "retry": {
      if (current !== "rejected" && current !== "failed") {
        throw illegalTransition(current, event.type);
      }
      return event.into;
    }
  }
}
