import type { ChangePasswordRequest, CreateEpisodeRequest, CreatePersonaRequest, CreateTemplateRequest, LoginRequest, PersonaPatch } from "./api";
import type { DestinationType } from "./destination";
import type { Persona, PersonaStyle } from "./persona";
import type { Template } from "./template";
import { SETTINGS_CANDIDATES_MAX, SETTINGS_CANDIDATES_MIN, type UserSettings } from "./user";
import type { ValidationResult } from "./validate";
import { isFiniteNumber, isNonEmptyString, isPlainObject, isStringArray } from "./validation-primitives";

const DESTINATION_TYPES: DestinationType[] = ["mountain_summit", "city_night", "theme_town", "scenic_area", "water_town", "island"];

/** Validates a LoginRequest (apps/web's POST /api/auth/login). */
export function validateLoginRequest(input: unknown): ValidationResult<LoginRequest> {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["不是一个 JSON 对象"] };
  }
  const r = input as Partial<LoginRequest>;

  if (!isNonEmptyString(r.username)) errors.push("username: 缺失或为空");
  if (!isNonEmptyString(r.password)) errors.push("password: 缺失或为空");

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: r as LoginRequest };
}

function validatePersonaStyle(input: unknown, errors: string[]): void {
  if (!isPlainObject(input)) {
    errors.push("style: 不是对象");
    return;
  }
  const s = input as Partial<PersonaStyle>;
  if (!isNonEmptyString(s.lut)) errors.push("style.lut: 缺失或为空");
  if (!isNonEmptyString(s.title_style)) errors.push("style.title_style: 缺失或为空");
}

/** Validates a whole persona document (used by future import/create paths). */
export function validatePersona(input: unknown): ValidationResult<Persona> {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["不是一个 JSON 对象"] };
  }
  const p = input as Partial<Persona>;

  if (!isNonEmptyString(p.persona_id)) errors.push("persona_id: 缺失或为空");
  if (!isNonEmptyString(p.owner_id)) errors.push("owner_id: 缺失或为空");
  if (!isFiniteNumber(p.version) || !Number.isInteger(p.version) || p.version < 1) {
    errors.push("version: 必须是 ≥1 的整数");
  }
  if (!isNonEmptyString(p.name)) errors.push("name: 缺失或为空");
  if (typeof p.desc !== "string") errors.push("desc: 必须是字符串");
  if (!isStringArray(p.locked)) errors.push("locked: 必须是字符串数组");
  if (!isNonEmptyString(p.default_outfit)) errors.push("default_outfit: 缺失或为空");
  if (!isStringArray(p.refs) || p.refs.length < 3 || p.refs.length > 7) {
    errors.push("refs: 必须是 3–7 张参考图路径的数组（FR-03）");
  }
  if (p.style !== undefined) validatePersonaStyle(p.style, errors);
  else errors.push("style: 缺失");

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: p as Persona };
}

/**
 * Validates apps/web's POST /api/personas request body. Deliberately
 * excludes refs — a persona can be created with zero reference images and
 * filled in afterwards via POST /api/personas/:id/refs, which is where the
 * FR-03 3–7 张 count is actually enforced (see M2-4 commit for why: forcing
 * the count at creation would make the two-step "create, then upload"
 * flow impossible).
 */
export function validateCreatePersonaRequest(input: unknown): ValidationResult<CreatePersonaRequest> {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["不是一个 JSON 对象"] };
  }
  const r = input as Partial<CreatePersonaRequest>;

  if (!isNonEmptyString(r.name)) errors.push("name: 缺失或为空");
  if (!isNonEmptyString(r.desc)) errors.push("desc: 缺失或为空");
  if (!isStringArray(r.locked)) errors.push("locked: 必须是字符串数组");
  if (!isNonEmptyString(r.default_outfit)) errors.push("default_outfit: 缺失或为空");
  if (r.style !== undefined) validatePersonaStyle(r.style, errors);
  else errors.push("style: 缺失");

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: r as CreatePersonaRequest };
}

/**
 * Validates apps/web's PATCH /api/personas/:id request body. refs isn't
 * patchable here on purpose — only through POST /api/personas/:id/refs, so
 * the 3–7 张 count check lives in exactly one place.
 */
export function validatePersonaPatchRequest(input: unknown): ValidationResult<PersonaPatch> {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["不是一个 JSON 对象"] };
  }
  const p = input as PersonaPatch & { refs?: unknown };

  if ("name" in p && !isNonEmptyString(p.name)) errors.push("name: 必须是非空字符串");
  if ("desc" in p && typeof p.desc !== "string") errors.push("desc: 必须是字符串");
  if ("locked" in p && !isStringArray(p.locked)) errors.push("locked: 必须是字符串数组");
  if ("default_outfit" in p && !isNonEmptyString(p.default_outfit)) {
    errors.push("default_outfit: 必须是非空字符串");
  }
  if ("style" in p) validatePersonaStyle(p.style, errors);
  if ("refs" in p) errors.push("refs: 不支持通过 PATCH 修改，走 POST /api/personas/:id/refs");

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: p as PersonaPatch };
}

// Shared by validateTemplate (whole document) and validateCreateTemplateRequest
// (POST /api/templates body) — both need the same name/skeleton/lut/intro/
// outro/title_style checks, they only differ on template_id/owner_id.
function validateTemplateFields(t: Partial<Template>, errors: string[]): void {
  if (!isNonEmptyString(t.name)) errors.push("name: 缺失或为空");
  if (!t.skeleton || !DESTINATION_TYPES.includes(t.skeleton as DestinationType)) {
    errors.push(
      `skeleton: 必须是 ${DESTINATION_TYPES.join(" / ")} 之一，实际是 ${JSON.stringify(t.skeleton)}`,
    );
  }
  if (!isNonEmptyString(t.lut)) errors.push("lut: 缺失或为空");
  if (t.intro !== null && !isNonEmptyString(t.intro)) errors.push("intro: 必须是字符串或 null");
  if (t.outro !== null && !isNonEmptyString(t.outro)) errors.push("outro: 必须是字符串或 null");
  if (!isNonEmptyString(t.title_style)) errors.push("title_style: 缺失或为空");
}

/** Validates a whole template document (used by `import-template`). */
export function validateTemplate(input: unknown): ValidationResult<Template> {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["不是一个 JSON 对象"] };
  }
  const t = input as Partial<Template>;

  if (!isNonEmptyString(t.template_id)) errors.push("template_id: 缺失或为空");
  if (t.owner_id !== null && !isNonEmptyString(t.owner_id)) {
    errors.push("owner_id: 必须是字符串或 null（null = 官方模板）");
  }
  validateTemplateFields(t, errors);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: t as Template };
}

/**
 * Validates apps/web's POST /api/templates request body (M2-10, FR-10).
 * template_id/owner_id 都不在请求体里——服务端生成 template_id、owner_id
 * 从会话取，和 validateCreatePersonaRequest 排除 persona_id/owner_id 同理。
 */
export function validateCreateTemplateRequest(input: unknown): ValidationResult<CreateTemplateRequest> {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["不是一个 JSON 对象"] };
  }
  const t = input as Partial<Template>;
  validateTemplateFields(t, errors);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: t as CreateTemplateRequest };
}

/**
 * Validates apps/web's POST /api/episodes request body (M2-5). Only the
 * three foreign keys are required — season/tone/banned/mode/series_id are
 * all optional here, the route fills defaults for whichever are missing
 * (FR-01"缺字段给默认值"), so validation only rejects fields that are
 * *present but the wrong shape*, never a merely-absent optional field.
 */
export function validateCreateEpisodeRequest(input: unknown): ValidationResult<CreateEpisodeRequest> {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["不是一个 JSON 对象"] };
  }
  const r = input as Partial<CreateEpisodeRequest>;

  if (!isNonEmptyString(r.persona_id)) errors.push("persona_id: 缺失或为空");
  if (!isNonEmptyString(r.destination_id)) errors.push("destination_id: 缺失或为空");
  if (!isNonEmptyString(r.template_id)) errors.push("template_id: 缺失或为空");
  if ("name" in r && !isNonEmptyString(r.name)) errors.push("name: 必须是非空字符串");
  if ("requirements" in r && typeof r.requirements !== "string") errors.push("requirements: 必须是字符串");
  if ("aspect" in r && r.aspect !== "9:16" && r.aspect !== "16:9") errors.push("aspect: 必须是 9:16 / 16:9 之一");
  if ("candidate_count" in r && (!Number.isInteger(r.candidate_count) || r.candidate_count! < SETTINGS_CANDIDATES_MIN || r.candidate_count! > SETTINGS_CANDIDATES_MAX)) errors.push("candidate_count: 必须是 1–3 的整数");
  if ("series_id" in r && !isNonEmptyString(r.series_id)) errors.push("series_id: 必须是非空字符串");
  if ("season" in r && !isNonEmptyString(r.season)) errors.push("season: 必须是非空字符串");
  if ("tone" in r && !isNonEmptyString(r.tone)) errors.push("tone: 必须是非空字符串");
  if ("banned" in r && !isStringArray(r.banned)) errors.push("banned: 必须是字符串数组");
  if ("mode" in r && r.mode !== "per_shot") {
    errors.push("mode: 新建期只支持 per_shot");
  }
  if ("outfit_override" in r && !isNonEmptyString(r.outfit_override)) {
    errors.push("outfit_override: 必须是非空字符串");
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: r as CreateEpisodeRequest };
}

/**
 * Validates apps/web's POST /api/me/password request body (M2-15). 新密码
 * 的强度要求跟 `packages/cli create-user` 保持一致——那条命令只要求非空，
 * 这里不自己多发明一条长度下限，否则同一个账号体系会有两套口径。
 */
export function validateChangePasswordRequest(input: unknown): ValidationResult<ChangePasswordRequest> {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["不是一个 JSON 对象"] };
  }
  const r = input as Partial<ChangePasswordRequest>;

  if (!isNonEmptyString(r.current_password)) errors.push("current_password: 缺失或为空");
  if (!isNonEmptyString(r.new_password)) errors.push("new_password: 缺失或为空");

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: r as ChangePasswordRequest };
}

/**
 * Validates apps/web's PATCH /api/me/settings request body (M2-15). 是个
 * patch：只校验出现了的字段，没出现的字段保持原值（合并在
 * packages/store 的 updateUserSettings 里做）。default_tone 允许空字符串
 * ——那是"清空默认语气"的表达方式，不是缺失。
 */
export function validateUserSettingsPatch(input: unknown): ValidationResult<UserSettings> {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["不是一个 JSON 对象"] };
  }
  const s = input as UserSettings;

  if ("default_tone" in s && typeof s.default_tone !== "string") {
    errors.push("default_tone: 必须是字符串");
  }
  if (
    "default_candidates" in s &&
    (!isFiniteNumber(s.default_candidates) ||
      !Number.isInteger(s.default_candidates) ||
      s.default_candidates < SETTINGS_CANDIDATES_MIN ||
      s.default_candidates > SETTINGS_CANDIDATES_MAX)
  ) {
    errors.push(
      `default_candidates: 必须是 ${SETTINGS_CANDIDATES_MIN}–${SETTINGS_CANDIDATES_MAX} 的整数`,
    );
  }
  if ("default_mode" in s && s.default_mode !== "per_shot") {
    errors.push("default_mode: 只支持 per_shot");
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: s };
}
