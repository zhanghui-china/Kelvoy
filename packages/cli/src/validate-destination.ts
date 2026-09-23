import type { Destination, DestinationType, Landmark } from "@kelvoy/engine";

const DESTINATION_TYPES: DestinationType[] = [
  "mountain_summit",
  "city_night",
  "theme_town",
  "scenic_area",
  "water_town",
  "island",
];

const MIN_LANDMARK_REFS = 3;

export type ValidationResult =
  | { valid: true; value: Destination }
  | { valid: false; errors: string[] };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function validateLandmark(input: unknown, index: number, errors: string[]): void {
  const path = `landmarks[${index}]`;
  if (typeof input !== "object" || input === null) {
    errors.push(`${path}: 不是对象`);
    return;
  }
  const l = input as Partial<Landmark>;

  if (!isNonEmptyString(l.id)) errors.push(`${path}.id: 缺失或为空`);
  if (!isNonEmptyString(l.name)) errors.push(`${path}.name: 缺失或为空`);
  if (!isNonEmptyString(l.best_time)) errors.push(`${path}.best_time: 缺失或为空`);

  if (!isStringArray(l.refs)) {
    errors.push(`${path}.refs: 必须是字符串数组`);
  } else if (l.refs.length < MIN_LANDMARK_REFS) {
    errors.push(`${path}.refs: 只有 ${l.refs.length} 张，至少需要 ${MIN_LANDMARK_REFS} 张实景参考图`);
  }

  if (!isStringArray(l.must_keep) || l.must_keep.length === 0) {
    errors.push(`${path}.must_keep: 必须是非空字符串数组`);
  }
}

/**
 * Validates a raw destination pack against PRD v0.2 §6 / §14 and the M0
 * handbook §1 checklist. Collects every error rather than failing fast —
 * `import-destination` reports the whole list, doesn't write on any error.
 */
export function validateDestination(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof input !== "object" || input === null) {
    return { valid: false, errors: ["输入不是一个 JSON 对象"] };
  }
  const d = input as Partial<Destination>;

  if (!isNonEmptyString(d.destination_id)) errors.push("destination_id: 缺失或为空");
  if (typeof d.version !== "number" || !Number.isInteger(d.version) || d.version < 1) {
    errors.push("version: 必须是 ≥ 1 的整数");
  }
  if (!isNonEmptyString(d.name)) errors.push("name: 缺失或为空");
  if (!isNonEmptyString(d.city)) errors.push("city: 缺失或为空");
  if (!isNonEmptyString(d.transport)) errors.push("transport: 缺失或为空");
  if (!isNonEmptyString(d.stay)) errors.push("stay: 缺失或为空");

  if (!d.type || !DESTINATION_TYPES.includes(d.type as DestinationType)) {
    errors.push(`type: 必须是 ${DESTINATION_TYPES.join(" / ")} 之一，实际是 ${JSON.stringify(d.type)}`);
  }

  if (!isStringArray(d.season_best)) errors.push("season_best: 必须是字符串数组");
  if (!isStringArray(d.route)) errors.push("route: 必须是字符串数组");
  if (!isStringArray(d.food)) errors.push("food: 必须是字符串数组");

  if (!Array.isArray(d.landmarks) || d.landmarks.length === 0) {
    errors.push("landmarks: 必须是非空数组");
  } else {
    d.landmarks.forEach((l, i) => validateLandmark(l, i, errors));
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, value: d as Destination };
}
