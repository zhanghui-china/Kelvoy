import type { Episode } from "../schema";
import { stepfunScriptProvider } from "../providers/stepfun-llm";
import { checkContent, ContentBlockedError } from "../rules/content";
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

  // MVP 内容审核（PRD §8/§11，#29）：生成前先过一遍用户可控的输入，命中
  // 直接拦截，不浪费一次 LLM 调用。生成后的拦截在 provider 里（对 LLM 产出
  // 的分镜文案做同样检查）。
  const preGenViolations = checkContent([
    { field: "brief.requirements", text: episode.brief.requirements ?? "" },
    { field: "brief.tone", text: episode.brief.tone },
    ...episode.brief.banned.map((term, i) => ({ field: `brief.banned[${i}]`, text: term })),
    ...(episode.brief.outfit_override !== null
      ? [{ field: "brief.outfit_override", text: episode.brief.outfit_override }]
      : []),
  ]);
  if (preGenViolations.length > 0) {
    throw new ContentBlockedError(preGenViolations);
  }

  const { shots, scenes } = await stepfunScriptProvider.generateShots({
    brief: episode.brief,
    destination: context.destination,
  });
  const nextStatus = transitionEpisode(episode.status, { type: "advance" });
  return {
    ...episode,
    status: nextStatus,
    shots: episode.cut_policy === "fixed_1s" ? shots.map((shot) => ({ ...shot, duration_s: 1 })) : shots,
    scenes,
  };
}
