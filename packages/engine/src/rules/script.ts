import type { Destination } from "../schema/destination";
import type { Shot, ShotSize } from "../schema/episode";

/**
 * FR-02 structural rules (PRD v0.2 §5), on top of validateEpisode's field
 * shape checks. These are fixed product rules, not M0-measured numbers —
 * safe to enforce now. Applies both at script-stage output and again after
 * review-1 deletion (removeShot), per PRD v0.2 §4.
 *
 * NOT implemented here: "每镜动作 ≤1 个动词" — that's a prompt-engineering
 * concern (counting verbs needs NLP, not a structural check), left to the
 * script stage's own prompt/output parsing, not this rule layer.
 */
export interface ScriptRuleViolation {
  rule: "shot_count" | "size_run" | "landmark_coverage" | "landmark_reference";
  message: string;
}

const MIN_SHOTS = 24;
const MAX_SHOTS = 30;
const MIN_LANDMARK_SHOTS = 5;
const MAX_SAME_SIZE_RUN = 2;

export function checkScriptRules(shots: Shot[], destination: Destination): ScriptRuleViolation[] {
  const violations: ScriptRuleViolation[] = [];

  if (shots.length < MIN_SHOTS || shots.length > MAX_SHOTS) {
    violations.push({
      rule: "shot_count",
      message: `镜数必须在 ${MIN_SHOTS}–${MAX_SHOTS} 之间，实际 ${shots.length}`,
    });
  }

  let runSize: ShotSize | null = null;
  let runLength = 0;
  for (const shot of shots) {
    runLength = shot.size === runSize ? runLength + 1 : 1;
    runSize = shot.size;
    if (runLength > MAX_SAME_SIZE_RUN) {
      violations.push({
        rule: "size_run",
        message: `第 ${shot.no} 镜：景别 "${shot.size}" 已连续超过 ${MAX_SAME_SIZE_RUN} 镜`,
      });
    }
  }

  const landmarkShotCount = shots.filter((s) => s.landmark !== null).length;
  if (landmarkShotCount < MIN_LANDMARK_SHOTS) {
    violations.push({
      rule: "landmark_coverage",
      message: `地标镜头只有 ${landmarkShotCount} 镜，至少需要 ${MIN_LANDMARK_SHOTS} 镜`,
    });
  }

  const landmarkIds = new Set(destination.landmarks.map((l) => l.id));
  for (const shot of shots) {
    if (shot.landmark !== null && !landmarkIds.has(shot.landmark)) {
      violations.push({
        rule: "landmark_reference",
        message: `第 ${shot.no} 镜引用了目的地库里不存在的地标 "${shot.landmark}"`,
      });
    }
  }

  return violations;
}
