/**
 * What the image model is actually told for one keyframe (ADR-0016).
 *
 * Qwen-Image edits from the reference images and inherits their pose and framing, so a bare
 * `kf_prompt` gets a front-facing selfie with a tiny landmark behind it. Naming the roles of the
 * images ("图1 is the person, 图2 is the landmark") and then stating the composition made the
 * orientation hold in 24/24 GX10 trials; without the naming it did not (spike/orientation).
 * `kf_prompt` itself (written by the script stage, editable in review) carries the composition,
 * position and facing; this only prepends the image roles.
 */
export function buildKeyframePrompt(input: {
  kf_prompt: string;
  /** Name of the landmark whose image is sent; null when the shot sends no landmark image. */
  landmarkName: string | null;
  /** True when the person reference is not sent (empty shot). */
  personOmitted: boolean;
}): string {
  const { kf_prompt, landmarkName, personOmitted } = input;
  if (personOmitted) {
    // Only reachable with a landmark image: the persona image is dropped so "无人物" is not
    // contradicted by a face in the references (a selfie appeared in 1 of 3 trials otherwise).
    return `图1是「${landmarkName ?? "场景"}」的实景参考图，画面中没有人物。${kf_prompt}`;
  }
  if (landmarkName) {
    return `图1是出镜人物的参考图，图2是「${landmarkName}」的实景参考图。把图1的人物放进图2的实景中，`
      + `保持人物的脸、发型和服装不变，保持地标的形状与比例、清晰可辨。${kf_prompt}`;
  }
  return `图1是出镜人物的参考图。保持人物的脸、发型和服装不变。${kf_prompt}`;
}
