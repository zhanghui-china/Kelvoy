import type { CreateOutfitRequest, OutfitPatch } from "./api";
import { OUTFIT_REFS_MAX, OUTFIT_REFS_MIN, PERSONA_OUTFITS_MAX, type PersonaOutfit } from "./persona";
import type { ValidationResult } from "./validate";
import { isNonEmptyString, isPlainObject, isStringArray } from "./validation-primitives";

const NAME_MAX = 30;
const DESC_MAX = 200;
const SEASONS_MAX = 8;

function validateTextFields(o: Record<string, unknown>, errors: string[], prefix: string, required: boolean): void {
  if (required || "name" in o) {
    if (!isNonEmptyString(o.name)) errors.push(`${prefix}name: 缺失或为空`);
    else if ((o.name as string).length > NAME_MAX) errors.push(`${prefix}name: 不能超过 ${NAME_MAX} 个字`);
  }
  if (required || "desc" in o) {
    if (typeof o.desc !== "string") errors.push(`${prefix}desc: 必须是字符串`);
    else if (o.desc.length > DESC_MAX) errors.push(`${prefix}desc: 不能超过 ${DESC_MAX} 个字`);
  }
  if (required || "seasons" in o) {
    if (!isStringArray(o.seasons) || o.seasons.some((s) => s.trim() === "")) {
      errors.push(`${prefix}seasons: 必须是非空字符串数组`);
    } else if (o.seasons.length > SEASONS_MAX) errors.push(`${prefix}seasons: 最多 ${SEASONS_MAX} 项`);
  }
}

/** POST /api/personas/:id/outfits 的文字字段（multipart 里 desc/seasons 缺省时路由先补成 ""/[]）。 */
export function validateCreateOutfitRequest(input: unknown): ValidationResult<CreateOutfitRequest> {
  if (!isPlainObject(input)) return { valid: false, errors: ["不是一个 JSON 对象"] };
  const errors: string[] = [];
  validateTextFields(input, errors, "", true);
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: { name: (input.name as string).trim(), desc: input.desc as string,
    seasons: [...new Set((input.seasons as string[]).map((s) => s.trim()))] } };
}

/** PATCH /api/personas/:id/outfits/:outfit_id：outfit_id 与 refs 不可经此修改（refs 只追加）。 */
export function validateOutfitPatchRequest(input: unknown): ValidationResult<OutfitPatch> {
  if (!isPlainObject(input)) return { valid: false, errors: ["不是一个 JSON 对象"] };
  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!["name", "desc", "seasons"].includes(key)) errors.push(`${key}: 不允许的字段`);
  }
  validateTextFields(input, errors, "", false);
  if (Object.keys(input).length === 0) errors.push("至少要改一个字段");
  if (errors.length > 0) return { valid: false, errors };
  const patch: OutfitPatch = {};
  if ("name" in input) patch.name = (input.name as string).trim();
  if ("desc" in input) patch.desc = input.desc as string;
  if ("seasons" in input) patch.seasons = [...new Set((input.seasons as string[]).map((s) => s.trim()))];
  return { valid: true, value: patch };
}

/** Persona 文档里的 `outfits` 字段；缺省合法（= 只有默认穿搭）。 */
export function validatePersonaOutfits(input: unknown, errors: string[]): void {
  if (input === undefined) return;
  if (!Array.isArray(input)) {
    errors.push("outfits: 必须是数组");
    return;
  }
  if (input.length > PERSONA_OUTFITS_MAX) errors.push(`outfits: 最多 ${PERSONA_OUTFITS_MAX} 套`);
  const seen = new Set<string>();
  input.forEach((item: unknown, i) => {
    const prefix = `outfits[${i}].`;
    if (!isPlainObject(item)) {
      errors.push(`outfits[${i}]: 不是对象`);
      return;
    }
    const o = item as Partial<PersonaOutfit> & Record<string, unknown>;
    if (!isNonEmptyString(o.outfit_id)) errors.push(`${prefix}outfit_id: 缺失或为空`);
    else if (seen.has(o.outfit_id)) errors.push(`${prefix}outfit_id: 重复 ${o.outfit_id}`);
    else seen.add(o.outfit_id);
    validateTextFields(o, errors, prefix, true);
    if (!isStringArray(o.refs) || o.refs.length < OUTFIT_REFS_MIN || o.refs.length > OUTFIT_REFS_MAX) {
      errors.push(`${prefix}refs: 必须是 ${OUTFIT_REFS_MIN}–${OUTFIT_REFS_MAX} 张参考图路径的数组`);
    }
  });
}
