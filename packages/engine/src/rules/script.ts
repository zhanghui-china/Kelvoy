import type { Destination } from "../schema/destination";
import type { Shot } from "../schema/episode";

// Script creation has no shot, landmark-coverage or shot-size quotas.
// Referenced landmarks must still belong to the frozen destination.
export interface ScriptRuleViolation {
  rule: "landmark_reference";
  message: string;
}

export function checkScriptRules(shots: Shot[], destination: Destination): ScriptRuleViolation[] {
  const violations: ScriptRuleViolation[] = [];

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
