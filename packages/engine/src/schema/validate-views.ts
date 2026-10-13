import type { ThreeViews } from "./persona";
import { isFiniteNumber, isNonEmptyString, isOneOf, isPlainObject } from "./validation-primitives";

const VIEWS_STATUSES = ["none", "pending", "ready", "failed"] as const;
const VIEW_KEYS: (keyof ThreeViews)[] = ["front", "side", "back", "sheet"];
const GEN_TEXT_KEYS = ["provider", "model", "version"] as const;

/**
 * 校验一个拥有三视图字段的对象（Persona 默认穿搭，或 PersonaOutfit）。三个字段都可缺省；
 * 一致性规则：`views` 与 `views_gen` 只在 `views_status === "ready"` 时存在，且 ready 时两者必须齐全。
 * 缺省的状态等同 "none"，所以老数据（只有 refs）原样通过。
 */
export function validateViewsFields(o: Record<string, unknown>, errors: string[], prefix: string): void {
  const { views, views_status: status, views_gen: gen } = o;
  if (status !== undefined && !isOneOf(status, VIEWS_STATUSES)) {
    errors.push(`${prefix}views_status: 必须是 ${VIEWS_STATUSES.join(" / ")}`);
    return;
  }
  const ready = status === "ready";
  if (!ready) {
    if (views !== undefined) errors.push(`${prefix}views: 仅 views_status 为 ready 时允许存在`);
    if (gen !== undefined) errors.push(`${prefix}views_gen: 仅 views_status 为 ready 时允许存在`);
    return;
  }
  if (views === undefined) errors.push(`${prefix}views: views_status 为 ready 时必须有四张图`);
  else if (!isPlainObject(views)) errors.push(`${prefix}views: 不是对象`);
  else {
    for (const key of VIEW_KEYS) {
      if (!isNonEmptyString(views[key])) errors.push(`${prefix}views.${key}: 缺失或为空`);
    }
    for (const key of Object.keys(views)) {
      if (!(VIEW_KEYS as string[]).includes(key)) errors.push(`${prefix}views.${key}: 不允许的字段`);
    }
  }
  if (gen === undefined) errors.push(`${prefix}views_gen: views_status 为 ready 时必须有生成记录`);
  else if (!isPlainObject(gen)) errors.push(`${prefix}views_gen: 不是对象`);
  else {
    for (const key of GEN_TEXT_KEYS) {
      if (!isNonEmptyString(gen[key])) errors.push(`${prefix}views_gen.${key}: 缺失或为空`);
    }
    if (!isFiniteNumber(gen.seed) || !Number.isInteger(gen.seed)) errors.push(`${prefix}views_gen.seed: 必须是整数`);
  }
}
