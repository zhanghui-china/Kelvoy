import type { Destination } from "../schema/destination";
import type { Shot } from "../schema/episode";

// Script creation has no shot, landmark-coverage or shot-size quotas.
// Referenced landmarks must still belong to the frozen destination.
export interface ScriptRuleViolation {
  rule: "landmark_reference" | "camera_motion_consistency";
  message: string;
}

type CameraKind = Shot["camera"];

// Conservative lexicon: only words that describe the *camera* move, so a
// character's action ("人物向右走") is never mistaken for the camera. There is
// no tilt in the camera enum; 仰拍/俯拍 are deliberately classed as pan.
const CAMERA_MOTION_PATTERNS: ReadonlyArray<readonly [CameraKind, RegExp, string]> = [
  ["push", /镜头[^，。；,.]{0,8}(推进|推近|拉近|靠近|推)|推镜|缓慢推进/, "推进"],
  ["pan", /镜头[^，。；,.]{0,8}(平移|横移|摇|仰拍|俯拍|上摇|下摇|环绕|旋转|扫)|摇镜|仰拍|俯拍|平移/, "平移／摇镜（含仰拍俯拍）"],
  ["follow", /镜头[^，。；,.]{0,8}(跟随|跟拍|追随|跟)|跟拍/, "跟随"],
  ["static", /固定镜头|镜头固定|镜头静止|静止镜头|机位固定|镜头不动/, "固定"],
];

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

    // Exactly one inferred category that differs from shot.camera is a
    // contradiction; none (unstated) or several (ambiguous) are not judged.
    const hits = CAMERA_MOTION_PATTERNS.filter(([, re]) => re.test(shot.motion_prompt));
    if (hits.length === 1 && hits[0]![0] !== shot.camera) {
      violations.push({
        rule: "camera_motion_consistency",
        message: `第 ${shot.no} 镜机位为 "${shot.camera}"，但运动描述表现为"${hits[0]![2]}"，请让 camera 与 motion_prompt 一致（仰拍／俯拍属于 pan）`,
      });
    }
  }

  return violations;
}
