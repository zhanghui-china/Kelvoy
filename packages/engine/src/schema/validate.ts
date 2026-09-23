import type {
  CreatePersonaRequest,
  LoginRequest,
  PatchEpisodeRequest,
  PatchShotRequest,
  PersonaPatch,
  RegisterRequest,
} from "./api";
import type { DestinationType } from "./destination";
import type {
  Episode,
  EpisodeBrief,
  EpisodeMusic,
  EpisodeRender,
  EpisodeShare,
  EpisodeStatus,
  RegenStage,
  Scene,
  SceneTime,
  Shot,
  ShotCamera,
  ShotModelRef,
  ShotSize,
  ShotStatus,
} from "./episode";
import type { Persona, PersonaStyle } from "./persona";
import type { Template } from "./template";

/**
 * Runtime type guards for the request boundary — used by apps/web's
 * `/api/*` routes and packages/cli's `import-episode`/`import-template`
 * (whole documents on import, patches on write-back via packages/store).
 * Same collect-every-error style as packages/cli/src/validate-destination.ts:
 * report the whole list, never fail fast, never mutate the input.
 */
export type ValidationResult<T> = { valid: true; value: T } | { valid: false; errors: string[] };

const SHOT_SIZES: ShotSize[] = ["wide", "medium", "close", "detail", "pov"];
const SHOT_CAMERAS: ShotCamera[] = ["static", "pan", "push", "follow"];
const SCENE_TIMES: SceneTime[] = ["morning", "noon", "afternoon", "evening", "night"];
const EPISODE_STATUSES: EpisodeStatus[] = [
  "draft",
  "scripting",
  "script_review",
  "assets",
  "keyframing",
  "kf_review",
  "clipping",
  "clip_review",
  "composing",
  "done",
  "failed",
];
const SHOT_STATUSES: ShotStatus[] = [
  "draft",
  "generating_kf",
  "kf_ready",
  "kf_selected",
  "generating_clip",
  "clip_ready",
  "approved",
  "rejected",
  "failed",
];
const REGEN_STAGES: RegenStage[] = ["keyframe", "video"];
// Also duplicated in packages/cli/src/validate-destination.ts — that one
// validates the full Destination pack (M0 recon-and-import path), this one
// only needs the enum for Template.skeleton. Not worth a shared package for
// six string literals; keep both in sync by hand if the enum ever changes.
const DESTINATION_TYPES: DestinationType[] = [
  "mountain_summit",
  "city_night",
  "theme_town",
  "scenic_area",
  "water_town",
  "island",
];

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isOneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v);
}

// ---- nested object validators (append to `errors`, return void) ----

function validateShotModelRecord(input: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(input)) {
    errors.push(`${path}: 不是对象`);
    return;
  }
  if (!isNonEmptyString(input.provider)) errors.push(`${path}.provider: 缺失或为空`);
  if (!isNonEmptyString(input.model)) errors.push(`${path}.model: 缺失或为空`);
  if (!isNonEmptyString(input.version)) errors.push(`${path}.version: 缺失或为空`);
  if (!isFiniteNumber(input.seed)) errors.push(`${path}.seed: 必须是数字`);
  if (typeof input.prompt !== "string") errors.push(`${path}.prompt: 必须是字符串`);
  if (!isStringArray(input.ref_hashes)) errors.push(`${path}.ref_hashes: 必须是字符串数组`);
  if (!isFiniteNumber(input.attempts) || input.attempts < 0) {
    errors.push(`${path}.attempts: 必须是 ≥0 的数字`);
  }
  if (!isFiniteNumber(input.cost_usd) || input.cost_usd < 0) {
    errors.push(`${path}.cost_usd: 必须是 ≥0 的数字`);
  }
}

function validateShotModelRef(input: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(input)) {
    errors.push(`${path}: 不是对象`);
    return;
  }
  const ref = input as Partial<ShotModelRef>;
  if (ref.image !== undefined) validateShotModelRecord(ref.image, `${path}.image`, errors);
  if (ref.video !== undefined) validateShotModelRecord(ref.video, `${path}.video`, errors);
}

function validateScene(input: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(input)) {
    errors.push(`${path}: 不是对象`);
    return;
  }
  const s = input as Partial<Scene>;
  if (!isNonEmptyString(s.id)) errors.push(`${path}.id: 缺失或为空`);
  if (!isNonEmptyString(s.name)) errors.push(`${path}.name: 缺失或为空`);
  if (!isOneOf(s.time, SCENE_TIMES)) {
    errors.push(`${path}.time: 必须是 ${SCENE_TIMES.join(" / ")} 之一`);
  }
  if (!isStringArray(s.landmarks)) errors.push(`${path}.landmarks: 必须是字符串数组`);
}

/** Validates a single shot object. Exported for FR-02 structural rules to reuse. */
export function validateShot(input: unknown): ValidationResult<Shot> {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["不是一个 JSON 对象"] };
  }
  const s = input as Partial<Shot>;

  if (!isFiniteNumber(s.no) || !Number.isInteger(s.no)) errors.push("no: 必须是整数");
  if (!isNonEmptyString(s.scene)) errors.push("scene: 缺失或为空");
  if (!isOneOf(s.size, SHOT_SIZES)) errors.push(`size: 必须是 ${SHOT_SIZES.join(" / ")} 之一`);
  if (typeof s.beat !== "string") errors.push("beat: 必须是字符串");
  if (!isOneOf(s.camera, SHOT_CAMERAS)) {
    errors.push(`camera: 必须是 ${SHOT_CAMERAS.join(" / ")} 之一`);
  }
  if (s.landmark !== null && !isNonEmptyString(s.landmark)) {
    errors.push("landmark: 必须是字符串或 null");
  }
  if (typeof s.kf_prompt !== "string") errors.push("kf_prompt: 必须是字符串");
  if (typeof s.motion_prompt !== "string") errors.push("motion_prompt: 必须是字符串");
  if (!isFiniteNumber(s.duration_s) || s.duration_s <= 0) {
    errors.push("duration_s: 必须是正数");
  }
  if (!isStringArray(s.candidates)) errors.push("candidates: 必须是字符串数组");
  if (s.kf_selected !== null && !isNonEmptyString(s.kf_selected)) {
    errors.push("kf_selected: 必须是字符串或 null");
  }
  if (s.clip !== null && !isNonEmptyString(s.clip)) errors.push("clip: 必须是字符串或 null");
  if (s.trim_start_s !== null && !isFiniteNumber(s.trim_start_s)) {
    errors.push("trim_start_s: 必须是数字或 null");
  }
  if (!isOneOf(s.status, SHOT_STATUSES)) {
    errors.push(`status: 必须是 ${SHOT_STATUSES.join(" / ")} 之一`);
  }
  if (s.regen_stage !== null && !isOneOf(s.regen_stage, REGEN_STAGES)) {
    errors.push(`regen_stage: 必须是 ${REGEN_STAGES.join(" / ")} 之一或 null`);
  }
  if (!isBoolean(s.bad_shot_reported)) errors.push("bad_shot_reported: 必须是布尔值");
  if (s.model !== undefined) validateShotModelRef(s.model, "model", errors);
  else errors.push("model: 缺失");

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: s as Shot };
}

function validateBrief(input: unknown, errors: string[]): void {
  if (!isPlainObject(input)) {
    errors.push("brief: 不是对象");
    return;
  }
  const b = input as Partial<EpisodeBrief>;
  if (!isNonEmptyString(b.season)) errors.push("brief.season: 缺失或为空");
  if (!isNonEmptyString(b.aspect)) errors.push("brief.aspect: 缺失或为空");
  if (!isFiniteNumber(b.duration_s) || b.duration_s <= 0) {
    errors.push("brief.duration_s: 必须是正数");
  }
  if (!isNonEmptyString(b.tone)) errors.push("brief.tone: 缺失或为空");
  if (b.outfit_override !== null && typeof b.outfit_override !== "string") {
    errors.push("brief.outfit_override: 必须是字符串或 null");
  }
  if (!isStringArray(b.banned)) errors.push("brief.banned: 必须是字符串数组");
}

function validateShare(input: unknown, errors: string[]): void {
  if (!isPlainObject(input)) {
    errors.push("share: 不是对象");
    return;
  }
  const s = input as Partial<EpisodeShare>;
  if (!isBoolean(s.enabled)) errors.push("share.enabled: 必须是布尔值");
  if (typeof s.slug !== "string") errors.push("share.slug: 必须是字符串");
}

/** Validates EpisodeMusic. Exported so PatchEpisodeRequest can reuse it. */
export function validateMusic(input: unknown, path = "music"): string[] {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    errors.push(`${path}: 不是对象`);
    return errors;
  }
  const m = input as Partial<EpisodeMusic>;
  if (!isNonEmptyString(m.file)) errors.push(`${path}.file: 缺失或为空`);
  if (!isFiniteNumber(m.bpm) || m.bpm < 0) errors.push(`${path}.bpm: 必须是 ≥0 的数字`);
  if (typeof m.license !== "string") errors.push(`${path}.license: 必须是字符串`);
  return errors;
}

/** Validates EpisodeRender. Exported so PatchEpisodeRequest can reuse it. */
export function validateRender(input: unknown, path = "render"): string[] {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    errors.push(`${path}: 不是对象`);
    return errors;
  }
  const r = input as Partial<EpisodeRender>;
  if (!isNonEmptyString(r.res)) errors.push(`${path}.res: 缺失或为空`);
  if (!isFiniteNumber(r.fps) || r.fps <= 0) errors.push(`${path}.fps: 必须是正数`);
  if (typeof r.title !== "string") errors.push(`${path}.title: 必须是字符串`);
  if (r.intro !== null && !isNonEmptyString(r.intro)) {
    errors.push(`${path}.intro: 必须是字符串或 null`);
  }
  if (r.outro !== null && !isNonEmptyString(r.outro)) {
    errors.push(`${path}.outro: 必须是字符串或 null`);
  }
  if (!isBoolean(r.ai_label)) errors.push(`${path}.ai_label: 必须是布尔值`);
  return errors;
}

/**
 * Validates a whole episode document (used by `import-episode`). Does NOT
 * enforce the FR-02 structural rules (shot count, size runs, landmark
 * coverage) — that's rules/script.ts's job, layered on top of a
 * structurally-valid episode.
 */
export function validateEpisode(input: unknown): ValidationResult<Episode> {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["不是一个 JSON 对象"] };
  }
  const e = input as Partial<Episode>;

  if (!isNonEmptyString(e.episode_id)) errors.push("episode_id: 缺失或为空");
  if (!isNonEmptyString(e.owner_id)) errors.push("owner_id: 缺失或为空");
  if (!isNonEmptyString(e.persona_id)) errors.push("persona_id: 缺失或为空");
  if (!isFiniteNumber(e.persona_version)) errors.push("persona_version: 必须是数字");
  if (!isNonEmptyString(e.destination_id)) errors.push("destination_id: 缺失或为空");
  if (!isFiniteNumber(e.destination_version)) errors.push("destination_version: 必须是数字");
  if (!isNonEmptyString(e.series_id)) errors.push("series_id: 缺失或为空");
  if (!isNonEmptyString(e.template_id)) errors.push("template_id: 缺失或为空");
  if (!isOneOf(e.status, EPISODE_STATUSES)) {
    errors.push(`status: 必须是 ${EPISODE_STATUSES.join(" / ")} 之一`);
  }
  if (e.mode !== "per_shot" && e.mode !== "grid") errors.push("mode: 必须是 per_shot / grid 之一");
  if (!isNonEmptyString(e.created_at)) errors.push("created_at: 缺失或为空");
  if (!isFiniteNumber(e.estimated_credits) || e.estimated_credits < 0) {
    errors.push("estimated_credits: 必须是 ≥0 的数字");
  }
  if (!isFiniteNumber(e.credits_used) || e.credits_used < 0) {
    errors.push("credits_used: 必须是 ≥0 的数字");
  }
  if (e.share !== undefined) validateShare(e.share, errors);
  else errors.push("share: 缺失");
  if (e.brief !== undefined) validateBrief(e.brief, errors);
  else errors.push("brief: 缺失");
  if (!isStringArray(e.grid_refs)) errors.push("grid_refs: 必须是字符串数组");

  if (!Array.isArray(e.scenes)) {
    errors.push("scenes: 必须是数组");
  } else {
    e.scenes.forEach((s, i) => validateScene(s, `scenes[${i}]`, errors));
  }

  if (!Array.isArray(e.shots)) {
    errors.push("shots: 必须是数组");
  } else {
    e.shots.forEach((s, i) => {
      const result = validateShot(s);
      if (!result.valid) {
        for (const err of result.errors) errors.push(`shots[${i}].${err}`);
      }
    });
  }

  if (!Array.isArray(e.removed_shots)) {
    errors.push("removed_shots: 必须是数组");
  } else {
    e.removed_shots.forEach((s, i) => {
      const result = validateShot(s);
      if (!result.valid) {
        for (const err of result.errors) errors.push(`removed_shots[${i}].${err}`);
      }
    });
  }

  if (e.music !== undefined) errors.push(...validateMusic(e.music));
  else errors.push("music: 缺失");
  if (e.render !== undefined) errors.push(...validateRender(e.render));
  else errors.push("render: 缺失");

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: e as Episode };
}

/**
 * Validates a PatchEpisodeRequest (PRD v0.2 §9 internal API). Every field
 * in `patch` is optional — only present fields are checked.
 */
export function validatePatchEpisodeRequest(input: unknown): ValidationResult<PatchEpisodeRequest> {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["不是一个 JSON 对象"] };
  }
  if (!isFiniteNumber(input.row_version)) errors.push("row_version: 必须是数字");
  if (!isPlainObject(input.patch)) {
    errors.push("patch: 不是对象");
    return { valid: false, errors };
  }
  const patch = input.patch;

  if ("status" in patch && !isOneOf(patch.status, EPISODE_STATUSES)) {
    errors.push(`patch.status: 必须是 ${EPISODE_STATUSES.join(" / ")} 之一`);
  }
  if ("credits_used" in patch && (!isFiniteNumber(patch.credits_used) || patch.credits_used < 0)) {
    errors.push("patch.credits_used: 必须是 ≥0 的数字");
  }
  if ("grid_refs" in patch && !isStringArray(patch.grid_refs)) {
    errors.push("patch.grid_refs: 必须是字符串数组");
  }
  if ("render" in patch) errors.push(...validateRender(patch.render, "patch.render"));
  if ("music" in patch) errors.push(...validateMusic(patch.music, "patch.music"));

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: input as unknown as PatchEpisodeRequest };
}

/**
 * Validates a PatchShotRequest (PRD v0.2 §9 internal API). Every field in
 * `patch` is optional — only present fields are checked.
 */
export function validatePatchShotRequest(input: unknown): ValidationResult<PatchShotRequest> {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["不是一个 JSON 对象"] };
  }
  if (!isFiniteNumber(input.row_version)) errors.push("row_version: 必须是数字");
  if (!isPlainObject(input.patch)) {
    errors.push("patch: 不是对象");
    return { valid: false, errors };
  }
  const patch = input.patch;

  if ("status" in patch && !isOneOf(patch.status, SHOT_STATUSES)) {
    errors.push(`patch.status: 必须是 ${SHOT_STATUSES.join(" / ")} 之一`);
  }
  if ("candidates" in patch && !isStringArray(patch.candidates)) {
    errors.push("patch.candidates: 必须是字符串数组");
  }
  if ("kf_selected" in patch && patch.kf_selected !== null && !isNonEmptyString(patch.kf_selected)) {
    errors.push("patch.kf_selected: 必须是字符串或 null");
  }
  if ("clip" in patch && patch.clip !== null && !isNonEmptyString(patch.clip)) {
    errors.push("patch.clip: 必须是字符串或 null");
  }
  if ("trim_start_s" in patch && patch.trim_start_s !== null && !isFiniteNumber(patch.trim_start_s)) {
    errors.push("patch.trim_start_s: 必须是数字或 null");
  }
  if (
    "regen_stage" in patch &&
    patch.regen_stage !== null &&
    !isOneOf(patch.regen_stage, REGEN_STAGES)
  ) {
    errors.push(`patch.regen_stage: 必须是 ${REGEN_STAGES.join(" / ")} 之一或 null`);
  }
  if ("bad_shot_reported" in patch && !isBoolean(patch.bad_shot_reported)) {
    errors.push("patch.bad_shot_reported: 必须是布尔值");
  }
  if ("model" in patch) validateShotModelRef(patch.model, "patch.model", errors);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: input as unknown as PatchShotRequest };
}

/** Validates a RegisterRequest (apps/web's POST /api/auth/register). */
export function validateRegisterRequest(input: unknown): ValidationResult<RegisterRequest> {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["不是一个 JSON 对象"] };
  }
  const r = input as Partial<RegisterRequest>;

  if (!isNonEmptyString(r.username)) errors.push("username: 缺失或为空");
  if (!isNonEmptyString(r.password)) errors.push("password: 缺失或为空");

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: r as RegisterRequest };
}

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

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: t as Template };
}
