import type { Episode } from "../schema";
import { transitionEpisode } from "../state";

/**
 * Stage A — Brief (PRD §4, FR-01, M1-10). Field defaulting already happens
 * at episode-creation time (apps/web's POST /api/episodes fills season/
 * tone/etc. from the destination and template before insertEpisode) — the
 * only production path that creates episodes. So this stage's actual job
 * is just the draft -> scripting handoff that lets "script" run next; no
 * model calls, no StageContext needed.
 */
export async function runBrief(episode: Episode, _shotNo?: number): Promise<Episode> {
  const nextStatus = transitionEpisode(episode.status, { type: "advance" });
  return { ...episode, status: nextStatus };
}
