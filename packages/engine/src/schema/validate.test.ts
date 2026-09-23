import { describe, expect, test } from "bun:test";
import type { Episode, Shot } from "./episode";
import {
  validateEpisode,
  validatePatchEpisodeRequest,
  validatePatchShotRequest,
  validateShot,
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
    episode_id: "e_test",
    owner_id: "u_test",
    persona_id: "c_test",
    persona_version: 1,
    destination_id: "d_test",
    destination_version: 1,
    series_id: "s_test",
    template_id: "t_test",
    status: "draft",
    mode: "per_shot",
    created_at: "2026-09-23T00:00:00+08:00",
    estimated_credits: 0,
    credits_used: 0,
    share: { enabled: false, slug: "" },
    brief: {
      season: "秋",
      aspect: "9:16",
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
