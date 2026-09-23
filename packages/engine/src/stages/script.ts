import type { Episode } from "../schema";

/**
 * Stage B — 脚本/分镜表 (PRD §4, FR-02). LLM picks a narrative-skeleton
 * template by destination.type and produces 30 shots as JSON; landmark
 * shots must reference destination.landmarks entries, never invent one.
 * Calls providers.script (ScriptProvider). Not implemented at skeleton stage.
 */
export async function runScript(_episode: Episode): Promise<Episode> {
  throw new Error("not implemented");
}
