import { isBoolean, isFiniteNumber, isNonEmptyString, isOneOf, isPlainObject, isStringArray } from "./validation-primitives";
import type { PatchEpisodeRequest, PatchShotRequest } from "./api";
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
  if (b.aspect !== "9:16" && b.aspect !== "16:9") errors.push("brief.aspect: 必须是 9:16 / 16:9 之一");
  if (b.requirements !== undefined && typeof b.requirements !== "string") errors.push("brief.requirements: 必须是字符串");
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
  if (e.name !== undefined && !isNonEmptyString(e.name)) errors.push("name: 必须是非空字符串");
  if (e.candidate_count !== undefined && (!Number.isInteger(e.candidate_count) || e.candidate_count < 1 || e.candidate_count > 3)) errors.push("candidate_count: 必须是 1–3 的整数");
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
  const allowedFields = new Set(["status", "credits_used", "grid_refs", "render", "music"]);
  for (const field of Object.keys(patch)) {
    if (!allowedFields.has(field)) errors.push(`patch.${field}: 不支持修改`);
  }

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

  // 审核 1/2 人工可改字段（PRD v0.2 §4）。landmark 只在这里查"是不是字符串
  // 或 null"，"这个 id 在不在目的地库里"要拿到目的地才能判断，由调用方
  // （apps/web 的 PATCH shot 路由）用 rules/script.ts 同一条规则去查。
  if ("beat" in patch && !isNonEmptyString(patch.beat)) {
    errors.push("patch.beat: 必须是非空字符串");
  }
  if ("size" in patch && !isOneOf(patch.size, SHOT_SIZES)) {
    errors.push(`patch.size: 必须是 ${SHOT_SIZES.join(" / ")} 之一`);
  }
  if ("camera" in patch && !isOneOf(patch.camera, SHOT_CAMERAS)) {
    errors.push(`patch.camera: 必须是 ${SHOT_CAMERAS.join(" / ")} 之一`);
  }
  if ("landmark" in patch && patch.landmark !== null && !isNonEmptyString(patch.landmark)) {
    errors.push("patch.landmark: 必须是字符串或 null");
  }
  // prompt 允许清空（还没生成过的镜本来就是空字符串），所以不是 isNonEmptyString。
  if ("kf_prompt" in patch && typeof patch.kf_prompt !== "string") {
    errors.push("patch.kf_prompt: 必须是字符串");
  }
  if ("motion_prompt" in patch && typeof patch.motion_prompt !== "string") {
    errors.push("patch.motion_prompt: 必须是字符串");
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: input as unknown as PatchShotRequest };
}


export { validateLoginRequest, validatePersona, validateCreatePersonaRequest, validatePersonaPatchRequest, validateTemplate, validateCreateTemplateRequest, validateCreateEpisodeRequest, validateChangePasswordRequest, validateUserSettingsPatch } from "./validate-catalog";
