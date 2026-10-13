/**
 * Seconds of source video generated for a shot (H3 clips are always 4–5 s). `duration_s` is only the
 * composer's suggested cut length (3–6 s), so only crossing the 4 s boundary changes what the video
 * model is asked for. Shared by the video stage and the storyboard editor's invalidation rule.
 */
export function h3ClipSeconds(durationS: number): 4 | 5 {
  return Math.max(4, Math.min(5, Math.ceil(durationS))) as 4 | 5;
}
