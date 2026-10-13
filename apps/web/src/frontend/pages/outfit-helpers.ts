import type { PersonaOutfit } from "@kelvoy/engine";

/** 输入框里的季节：逗号/顿号/空白分隔，去空去重。 */
export function parseSeasons(input: string): string[] {
  return [...new Set(input.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * 季节是自由文本（目的地 season_best、用户自定义"早春"），所以按包含关系匹配：
 * 穿搭写"春"，本期是"早春"也算适合。只用于推荐排序，不做硬限制。
 */
export function outfitFitsSeason(outfit: Pick<PersonaOutfit, "seasons">, season: string): boolean {
  const target = season.trim();
  if (!target) return false;
  return outfit.seasons.some((s) => s === target || target.includes(s) || s.includes(target));
}

/** 适合本季的排前面，其余保持原顺序（稳定排序）。 */
export function sortOutfitsForSeason(outfits: PersonaOutfit[], season: string): PersonaOutfit[] {
  return [...outfits].sort((a, b) => Number(outfitFitsSeason(b, season)) - Number(outfitFitsSeason(a, season)));
}

/** 默认选中的穿搭：第一个适合本季且可选的；没有就用默认穿搭（空串）。 */
export function suggestedOutfitId(outfits: PersonaOutfit[], season: string): string {
  return sortOutfitsForSeason(outfits, season)
    .find((o) => outfitFitsSeason(o, season) && outfitPickState(o).selectable)?.outfit_id ?? "";
}

/** 旧式穿搭：没有全身照（source）、也没有三视图，沿用 refs[0]。 */
export function isLegacyOutfit(outfit: PersonaOutfit): boolean {
  return !outfit.source && (outfit.views_status ?? "none") === "none";
}

const NOT_READY_NOTE: Record<string, string> = {
  none: "三视图未生成", pending: "三视图生成中", failed: "三视图生成失败",
};

/**
 * 新建作品能不能选这套穿搭（ADR-0017）：三视图 ready 才可选；老穿搭（无 source）仍可选，
 * 生成时走 refs[0] 兜底，但标注"未生成三视图"。有全身照却还没 ready 的不可选。
 */
export function outfitPickState(outfit: PersonaOutfit): { selectable: boolean; note: string | null } {
  const status = outfit.views_status ?? "none";
  if (status === "ready") return { selectable: true, note: null };
  if (isLegacyOutfit(outfit)) return { selectable: true, note: "未生成三视图" };
  return { selectable: false, note: NOT_READY_NOTE[status] ?? "三视图未就绪" };
}

/** 选择器缩略图：ready 用正面，其次全身照，最后 refs[0]。 */
export function outfitThumbKey(outfit: PersonaOutfit): string | undefined {
  return outfit.views?.front ?? outfit.source ?? outfit.refs[0];
}
