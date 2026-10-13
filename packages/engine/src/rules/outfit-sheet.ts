import type { Persona, ThreeViews } from "../schema/persona";

function readySheet(owner: { views?: ThreeViews; views_status?: string }): string | null {
  return owner.views_status === "ready" && owner.views ? owner.views.sheet : null;
}

/**
 * 选中穿搭的三视图设定图 key（ADR-0017）。`outfitId` 缺省/null = 默认穿搭，读 Persona 自身的 views；
 * 否则读对应穿搭。三视图未 ready、穿搭 id 找不到，或老数据没有 views 时返回 null，由消费端兜底到 `refs[0]`。
 * 纯函数，不做 IO，也不改变 keyframe-references 的消费逻辑。
 */
export function outfitSheetKey(persona: Persona | null | undefined, outfitId?: string | null): string | null {
  if (!persona) return null;
  if (!outfitId) return readySheet(persona);
  const outfit = persona.outfits?.find((item) => item.outfit_id === outfitId);
  return outfit ? readySheet(outfit) : null;
}
