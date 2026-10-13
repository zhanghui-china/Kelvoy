import type { PersonReference } from "@kelvoy/engine";

/** 审片台"角色参考"标题：三视图设定图是单张拼图，不显示"第 n 张 / 共 m 张"。 */
export function personaReferenceLabel(
  personaName: string, ref: Pick<PersonReference, "kind" | "index" | "total">, outfit: { name: string } | null,
): string {
  const outfitPart = outfit ? ` · 穿搭「${outfit.name}」` : "";
  if (ref.kind === "sheet") return `角色参考 · 三视图设定图 · ${personaName}${outfitPart}`;
  return `角色参考 · ${personaName}${outfitPart} · 第 ${ref.index + 1} 张 / 共 ${ref.total} 张`;
}
