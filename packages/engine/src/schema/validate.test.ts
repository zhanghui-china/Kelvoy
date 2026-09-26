import { describe, expect, test } from "bun:test";
import type { Episode, Shot } from "./episode";
import type { Persona } from "./persona";
import type { Template } from "./template";
import {
  validateChangePasswordRequest,
  validateCreateEpisodeRequest,
  validateCreateTemplateRequest,
  validateEpisode,
  validatePatchEpisodeRequest,
  validatePatchShotRequest,
  validatePersona,
  validateShot,
  validateTemplate,
  validateUserSettingsPatch,
} from "./validate";

function validShot(no = 1): Shot {
  return {
    no,
    scene: "s1",
    size: "wide",
    beat: "仰望大佛",
    camera: "push",
    landmark: "l1",
    kf_prompt: "...",
    motion_prompt: "...",
    duration_s: 1,
    candidates: ["kf/01_a.png"],
    kf_selected: "kf/01_a.png",
    clip: "clip/01.mp4",
    trim_start_s: 0.4,
    status: "approved",
    regen_stage: null,
    bad_shot_reported: false,
    model: {
      image: {
        provider: "local",
        model: "qwen-image",
        version: "2.1",
        seed: 1,
        prompt: "...",
        ref_hashes: ["sha256:abc"],
        attempts: 1,
        cost_usd: 0.1,
      },
    },
  };
}

function validEpisode(): Episode {
  return {
    name: "测试期", episode_id: "e_test",
    owner_id: "u_test",
    persona_id: "c_test",
    persona_version: 1,
    destination_id: "d_test",
    destination_version: 1,
    series_id: "s_test",
    template_id: "t_test",
    status: "draft",
    mode: "per_shot", candidate_count: 2,
    created_at: "2026-09-23T00:00:00+08:00",
    estimated_credits: 0,
    credits_used: 0,
    share: { enabled: false, slug: "" },
    brief: {
      season: "秋",
      aspect: "9:16",
      requirements: "",
      duration_s: 30,
      tone: "松弛",
      outfit_override: null,
      banned: [],
    },
    grid_refs: [],
    scenes: [{ id: "s1", name: "到达", time: "morning", landmarks: [] }],
    shots: [validShot(1)],
    removed_shots: [],
    music: { file: "music/track.mp3", bpm: 60, license: "cc" },
    render: {
      res: "1080x1920",
      fps: 30,
      title: "",
      intro: null,
      outro: null,
      ai_label: true,
    },
  };
}

describe("validateShot", () => {
  test("accepts a well-formed shot", () => {
    expect(validateShot(validShot()).valid).toBe(true);
  });

  test("rejects an invalid size enum value", () => {
    const shot = { ...validShot(), size: "extreme-wide" };
    const result = validateShot(shot);
    expect(result.valid).toBe(false);
  });

  test("rejects a negative duration_s", () => {
    const shot = { ...validShot(), duration_s: -1 };
    const result = validateShot(shot);
    expect(result.valid).toBe(false);
  });

  test("accepts landmark: null", () => {
    const shot = { ...validShot(), landmark: null };
    expect(validateShot(shot).valid).toBe(true);
  });
});

describe("validateEpisode", () => {
  test("accepts a well-formed episode", () => {
    const result = validateEpisode(validEpisode());
    expect(result.valid).toBe(true);
  });

  test("rejects an invalid episode status", () => {
    const episode = { ...validEpisode(), status: "not-a-status" };
    expect(validateEpisode(episode).valid).toBe(false);
  });

  test("reports errors from nested shots with an indexed path", () => {
    const episode = validEpisode();
    episode.shots = [{ ...validShot(), size: "extreme-wide" } as unknown as Shot];
    const result = validateEpisode(episode);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.startsWith("shots[0]."))).toBe(true);
    }
  });

  test("reports every error at once", () => {
    const episode = { ...validEpisode(), status: "bad", mode: "bad" };
    const result = validateEpisode(episode);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("validatePatchEpisodeRequest", () => {
  test("rejects fields outside the Episode patch contract", () => {
    for (const patch of [{ candidate_count: 1_000_000 }, { name: "forged" }, { brief: {} }]) {
      const result = validatePatchEpisodeRequest({ row_version: 1, patch });
      expect(result.valid).toBe(false);
    }
  });
  test("accepts an empty patch (all fields optional)", () => {
    const result = validatePatchEpisodeRequest({ row_version: 3, patch: {} });
    expect(result.valid).toBe(true);
  });

  test("accepts a partial patch touching only status", () => {
    const result = validatePatchEpisodeRequest({ row_version: 3, patch: { status: "done" } });
    expect(result.valid).toBe(true);
  });

  test("rejects an invalid status in the patch", () => {
    const result = validatePatchEpisodeRequest({ row_version: 3, patch: { status: "bogus" } });
    expect(result.valid).toBe(false);
  });

  test("rejects a missing row_version", () => {
    const result = validatePatchEpisodeRequest({ patch: {} });
    expect(result.valid).toBe(false);
  });
});

describe("validatePatchShotRequest", () => {
  test("accepts a patch touching only kf_selected and status", () => {
    const result = validatePatchShotRequest({
      row_version: 1,
      patch: { status: "kf_selected", kf_selected: "kf/07_a.png" },
    });
    expect(result.valid).toBe(true);
  });

  test("accepts the review-1/2 editable fields (#31)", () => {
    const result = validatePatchShotRequest({
      row_version: 1,
      patch: {
        beat: "抬头看大佛",
        caption: "山风吹过佛前",
        size: "close",
        camera: "push",
        landmark: null,
        kf_prompt: "",
        motion_prompt: "缓慢上摇",
      },
    });
    expect(result.valid).toBe(true);
  });

  test("rejects an invalid size / camera / empty beat", () => {
    expect(validatePatchShotRequest({ row_version: 1, patch: { size: "macro" } }).valid).toBe(false);
    expect(validatePatchShotRequest({ row_version: 1, patch: { camera: "zoom" } }).valid).toBe(false);
    expect(validatePatchShotRequest({ row_version: 1, patch: { beat: "" } }).valid).toBe(false);
    expect(validatePatchShotRequest({ row_version: 1, patch: { caption: "字".repeat(121) } }).valid).toBe(false);
    expect(validatePatchShotRequest({ row_version: 1, patch: { kf_prompt: 7 } }).valid).toBe(false);
    expect(validatePatchShotRequest({ row_version: 1, patch: { landmark: 7 } }).valid).toBe(false);
  });

  test("rejects an invalid regen_stage", () => {
    const result = validatePatchShotRequest({
      row_version: 1,
      patch: { regen_stage: "audio" },
    });
    expect(result.valid).toBe(false);
  });

  test("rejects a non-object patch", () => {
    const result = validatePatchShotRequest({ row_version: 1, patch: "nope" });
    expect(result.valid).toBe(false);
  });
});

function validPersona(): Persona {
  return {
    persona_id: "c_001",
    owner_id: "u_123",
    version: 1,
    name: "小岛",
    desc: "30 岁男性，短发，中等身材，温和表情",
    locked: ["脸型", "发型", "体态"],
    default_outfit: "浅灰亚麻衬衫，卡其长裤",
    refs: ["persona/c_001/front.png", "persona/c_001/side.png", "persona/c_001/full.png"],
    style: { lut: "lut/warm_film.cube", title_style: "serif-center" },
  };
}

describe("validatePersona", () => {
  test("accepts a well-formed persona", () => {
    expect(validatePersona(validPersona()).valid).toBe(true);
  });

  test("rejects fewer than 3 reference images", () => {
    const p = { ...validPersona(), refs: ["a.png", "b.png"] };
    const result = validatePersona(p);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.startsWith("refs:"))).toBe(true);
  });

  test("rejects more than 7 reference images", () => {
    const p = { ...validPersona(), refs: Array(8).fill("a.png") };
    expect(validatePersona(p).valid).toBe(false);
  });

  test("rejects a missing style object", () => {
    const p = { ...validPersona(), style: undefined };
    expect(validatePersona(p).valid).toBe(false);
  });
});

function validTemplate(): Template {
  return {
    template_id: "t_scenic_area_day",
    owner_id: null,
    name: "大型景区 · 一日",
    skeleton: "scenic_area",
    lut: "lut/warm_film.cube",
    intro: "intro/default.mp4",
    outro: null,
    title_style: "serif-center",
  };
}

describe("validateTemplate", () => {
  test("accepts a well-formed official template (owner_id null)", () => {
    expect(validateTemplate(validTemplate()).valid).toBe(true);
  });

  test("accepts a well-formed private template (owner_id set)", () => {
    const t = { ...validTemplate(), owner_id: "u_123" };
    expect(validateTemplate(t).valid).toBe(true);
  });

  test("rejects an invalid skeleton enum value", () => {
    const t = { ...validTemplate(), skeleton: "beach" };
    const result = validateTemplate(t);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.startsWith("skeleton:"))).toBe(true);
  });

  test("rejects a missing lut", () => {
    const t = { ...validTemplate(), lut: "" };
    expect(validateTemplate(t).valid).toBe(false);
  });
});

function validCreateTemplateRequest() {
  const { template_id: _template_id, owner_id: _owner_id, ...rest } = validTemplate();
  return rest;
}

describe("validateCreateTemplateRequest", () => {
  test("accepts a well-formed body", () => {
    expect(validateCreateTemplateRequest(validCreateTemplateRequest()).valid).toBe(true);
  });

  test("accepts null intro/outro", () => {
    const body = { ...validCreateTemplateRequest(), intro: null, outro: null };
    expect(validateCreateTemplateRequest(body).valid).toBe(true);
  });

  test("rejects an invalid skeleton enum value", () => {
    const body = { ...validCreateTemplateRequest(), skeleton: "beach" };
    const result = validateCreateTemplateRequest(body);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.startsWith("skeleton:"))).toBe(true);
  });

  test("rejects a missing name", () => {
    const body = { ...validCreateTemplateRequest(), name: "" };
    expect(validateCreateTemplateRequest(body).valid).toBe(false);
  });

  test("collects every error at once", () => {
    const result = validateCreateTemplateRequest({});
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.length).toBeGreaterThan(1);
  });
});

function validCreateEpisodeRequest() {
  return { persona_id: "c_1", destination_id: "d_1", template_id: "t_1" };
}

describe("validateCreateEpisodeRequest", () => {
  test("rejects grid for a newly created episode", () => {
    expect(validateCreateEpisodeRequest({ ...validCreateEpisodeRequest(), mode: "grid" }).valid).toBe(false);
  });
  test("validates new creation fields at the request boundary", () => {
    const base = validCreateEpisodeRequest();
    expect(validateCreateEpisodeRequest({ ...base, name: "旅途", requirements: "拍全景",
      aspect: "16:9", candidate_count: 3 }).valid).toBe(true);
    for (const patch of [{ name: "  " }, { requirements: null }, { aspect: "1:1" },
      { candidate_count: 0 }, { candidate_count: 2.5 }, { candidate_count: 4 }]) {
      expect(validateCreateEpisodeRequest({ ...base, ...patch }).valid).toBe(false);
    }
  });
  test("accepts the three required foreign keys with nothing else", () => {
    expect(validateCreateEpisodeRequest(validCreateEpisodeRequest()).valid).toBe(true);
  });

  test("rejects a missing persona_id", () => {
    const { persona_id: _persona_id, ...rest } = validCreateEpisodeRequest();
    const result = validateCreateEpisodeRequest(rest);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.startsWith("persona_id:"))).toBe(true);
  });

  test("accepts a non-empty outfit_override", () => {
    const body = { ...validCreateEpisodeRequest(), outfit_override: "冲锋衣" };
    expect(validateCreateEpisodeRequest(body).valid).toBe(true);
  });

  test("rejects an empty outfit_override", () => {
    const body = { ...validCreateEpisodeRequest(), outfit_override: "" };
    const result = validateCreateEpisodeRequest(body);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.startsWith("outfit_override:"))).toBe(true);
  });

  test("rejects an invalid mode enum value", () => {
    const body = { ...validCreateEpisodeRequest(), mode: "square" };
    expect(validateCreateEpisodeRequest(body).valid).toBe(false);
  });
});

describe("validateChangePasswordRequest", () => {
  test("accepts both passwords", () => {
    const result = validateChangePasswordRequest({
      current_password: "hunter2",
      new_password: "hunter3",
    });
    expect(result.valid).toBe(true);
  });

  test("rejects a missing or empty field", () => {
    expect(validateChangePasswordRequest({ new_password: "hunter3" }).valid).toBe(false);
    expect(
      validateChangePasswordRequest({ current_password: "hunter2", new_password: "  " }).valid,
    ).toBe(false);
  });
});

describe("validateUserSettingsPatch", () => {
  test("accepts versioned onboarding dismissal and reopening", () => {
    expect(validateUserSettingsPatch({ onboarding_dismissed_version: 1 })).toEqual({ valid: true, value: { onboarding_dismissed_version: 1 } });
    expect(validateUserSettingsPatch({ onboarding_dismissed_version: 0 }).valid).toBe(true);
  });
  test("rejects invalid onboarding dismissal versions", () => {
    for (const version of [-1, 2, 0.5, "1", null]) {
      expect(validateUserSettingsPatch({ onboarding_dismissed_version: version }).valid).toBe(false);
    }
  });
  test("rejects grid as a new account default", () => {
    expect(validateUserSettingsPatch({ default_mode: "grid" }).valid).toBe(false);
  });
  test("accepts an empty patch and a full one", () => {
    expect(validateUserSettingsPatch({}).valid).toBe(true);
    expect(
      validateUserSettingsPatch({
        default_tone: "松弛",
        default_candidates: 3,
        default_mode: "per_shot",
      }).valid,
    ).toBe(true);
  });

  test("accepts an empty default_tone — that's how the page clears it", () => {
    expect(validateUserSettingsPatch({ default_tone: "" }).valid).toBe(true);
  });

  test("rejects a candidate count outside 1–3 or non-integer", () => {
    expect(validateUserSettingsPatch({ default_candidates: 0 }).valid).toBe(false);
    expect(validateUserSettingsPatch({ default_candidates: 4 }).valid).toBe(false);
    expect(validateUserSettingsPatch({ default_candidates: 2.5 }).valid).toBe(false);
  });

  test("rejects an unknown mode", () => {
    const result = validateUserSettingsPatch({ default_mode: "square" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.startsWith("default_mode:"))).toBe(true);
  });
});
