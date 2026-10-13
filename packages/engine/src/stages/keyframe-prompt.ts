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
  /**
   * What image 1 is: a three-view character sheet (ADR-0017) or a plain photo. Defaults to photo.
   * The sheet wording is the T0-validated prefix (spike/three-views/README.md, 12/12 single person).
   */
  personKind?: "sheet" | "photo";
}): string {
  const { kf_prompt, landmarkName, personOmitted, personKind = "photo" } = input;
  if (personOmitted) {
    // Only reachable with a landmark image: the persona image is dropped so "无人物" is not
    // contradicted by a face in the references (a selfie appeared in 1 of 3 trials otherwise).
    return `图1是「${landmarkName ?? "场景"}」的实景参考图，画面中没有人物。${kf_prompt}`;
  }
  if (personKind === "sheet") {
    const sheet = "图1是出镜人物的三视图设定图（从左到右依次是正面、侧面、背面，是同一个人）";
    const keep = "画面里只出现一个人，不要画出设定图的拼图或多个人物，保持人物的脸、发型和服装不变";
    if (landmarkName) {
      return `${sheet}，图2是「${landmarkName}」的实景参考图。把图1中的这一个人物放进图2的实景中，`
        + `${keep}，保持地标的形状与比例、清晰可辨。${kf_prompt}`;
    }
    return `${sheet}。${keep}。${kf_prompt}`;
  }
  if (landmarkName) {
    return `图1是出镜人物的参考图，图2是「${landmarkName}」的实景参考图。把图1的人物放进图2的实景中，`
      + `保持人物的脸、发型和服装不变，保持地标的形状与比例、清晰可辨。${kf_prompt}`;
  }
  return `图1是出镜人物的参考图。保持人物的脸、发型和服装不变。${kf_prompt}`;
}
