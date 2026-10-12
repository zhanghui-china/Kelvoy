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

/** 默认选中的穿搭：第一个适合本季的；没有就用默认穿搭（空串）。 */
export function suggestedOutfitId(outfits: PersonaOutfit[], season: string): string {
  return sortOutfitsForSeason(outfits, season).find((o) => outfitFitsSeason(o, season))?.outfit_id ?? "";
}
