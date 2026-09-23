import type { Episode } from "../schema";

/**
 * Stage A — Brief (PRD §4, FR-01). Persona + destination (from the
 * destination library) + season/time/tone/banned-list. Missing fields get
 * defaults, annotated on the project. Not implemented at skeleton stage.
 */
export async function runBrief(_episode: Episode, _shotNo?: number): Promise<Episode> {
  throw new Error("not implemented");
}
