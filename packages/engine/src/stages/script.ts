import type { Episode } from "../schema";
import { stepfunScriptProvider } from "../providers/stepfun-llm";
import { transitionEpisode } from "../state";
import type { StageContext } from "./types";

/**
 * Stage B — 脚本/分镜表 (PRD §4, FR-02, M1-10). LLM picks a narrative-skeleton
 * template by destination.type (see ../templates/skeletons.ts) and produces
 * shots as JSON; landmark shots must reference destination.landmarks
 * entries, never invent one — enforced by rules/script.ts's checkScriptRules
 * inside the provider itself (up to 3 self-correction rounds).
 *
 * Runs from "scripting" (the "brief" stage's job is the draft -> scripting
 * handoff, see brief.ts) straight through to "script_review" in one call —
 * @kelvoy/store's replaceEpisode only allows a single state-machine hop per
 * write, so this must not also perform the draft -> scripting half.
 */
export async function runScript(episode: Episode, _shotNo?: number, context?: StageContext): Promise<Episode> {
  if (!context?.destination) {
    throw new Error("script 阶段需要 destination（由调用方从 @kelvoy/store 读取，见 StageContext）");
  }
  const { shots, scenes } = await stepfunScriptProvider.generateShots({
    brief: episode.brief,
    destination: context.destination,
  });
  const nextStatus = transitionEpisode(episode.status, { type: "advance" });
  return { ...episode, status: nextStatus, shots, scenes };
}
