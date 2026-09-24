import type { Context } from "hono";
import type { GetEpisodeResult, PatchResult } from "@kelvoy/store";
import { getEpisode } from "@kelvoy/store";

/**
 * episodes.ts（建期/详情/产物文件）和 episode-review.ts（审片台写路由）
 * 共用的三件小工具。两个文件都挂在 /api/episodes 下、都要做 owner 校验和
 * 乐观锁错误映射，抽出来免得改一处漏一处。
 */

export async function loadOwnedEpisode(
  ownerId: string,
  episodeId: string,
): Promise<Extract<GetEpisodeResult, { ok: true }> | null> {
  const result = await getEpisode(episodeId);
  if (!result.ok || result.episode.owner_id !== ownerId) return null;
  return result;
}

// packages/store's patch/replace functions all share this ok:false shape —
// one mapping to HTTP status for every write route.
export function patchErrorResponse(c: Context, result: Extract<PatchResult, { ok: false }>) {
  switch (result.error) {
    case "not_found":
      return c.json({ ok: false, error: "not_found" }, 404);
    case "illegal_transition":
      return c.json({ ok: false, error: "illegal_transition" }, 400);
    case "version_conflict":
      return c.json(
        { ok: false, error: "version_conflict", current_row_version: result.current_row_version },
        409,
      );
  }
}

export function parseRowVersion(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const v = (body as Record<string, unknown>).row_version;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
