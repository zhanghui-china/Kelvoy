/** A stable seed per task and candidate makes retries reproducible. */
export function generationSeed(generationId: string, shotNo: number, kind: "image" | "video"): number {
  const text = `${generationId}:${shotNo}:${kind}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}
