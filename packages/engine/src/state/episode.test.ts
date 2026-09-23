import { describe, expect, test } from "bun:test";
import type { Episode, EpisodeStatus, Shot } from "../schema";
import {
  type GeneratingEpisodeStatus,
  MIN_SHOTS,
  isLegalEpisodeStatusChange,
  removeShot,
  transitionEpisode,
} from "./episode";

function makeShot(no: number): Shot {
  return {
    no,
    scene: "s1",
    size: "wide",
    beat: "test",
    camera: "static",
    landmark: null,
    kf_prompt: "",
    motion_prompt: "",
    duration_s: 1,
    candidates: [],
    kf_selected: null,
    clip: null,
    trim_start_s: null,
    status: "draft",
    regen_stage: null,
    bad_shot_reported: false,
    model: {},
  };
}

function makeEpisode(shotCount: number): Episode {
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
    shots: Array.from({ length: shotCount }, (_, i) => makeShot(i + 1)),
    removed_shots: [],
    music: { file: "", bpm: 0, license: "" },
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

describe("transitionEpisode: legal transitions", () => {
  const advancePairs: [EpisodeStatus, EpisodeStatus][] = [
    ["draft", "scripting"],
    ["scripting", "script_review"],
    ["script_review", "assets"],
    ["assets", "keyframing"],
    ["keyframing", "kf_review"],
    ["kf_review", "clipping"],
    ["clipping", "clip_review"],
    ["clip_review", "composing"],
    ["composing", "done"],
  ];

  for (const [from, to] of advancePairs) {
    test(`${from} --advance--> ${to}`, () => {
      expect(transitionEpisode(from, { type: "advance" })).toBe(to);
    });
  }

  const generatingStates: GeneratingEpisodeStatus[] = [
    "scripting",
    "assets",
    "keyframing",
    "clipping",
    "composing",
  ];

  for (const state of generatingStates) {
    test(`${state} --fail--> failed`, () => {
      expect(transitionEpisode(state, { type: "fail" })).toBe("failed");
    });

    test(`failed --retry(${state})--> ${state}`, () => {
      expect(transitionEpisode("failed", { type: "retry", into: state })).toBe(state);
    });
  }

  test("done --recompose--> composing", () => {
    expect(transitionEpisode("done", { type: "recompose" })).toBe("composing");
  });
});

describe("transitionEpisode: illegal transitions", () => {
  test("done --advance--> throws", () => {
    expect(() => transitionEpisode("done", { type: "advance" })).toThrow();
  });

  test("failed --advance--> throws", () => {
    expect(() => transitionEpisode("failed", { type: "advance" })).toThrow();
  });

  test("draft --fail--> throws (not a generating state)", () => {
    expect(() => transitionEpisode("draft", { type: "fail" })).toThrow();
  });

  test("script_review --fail--> throws (review state, not generating)", () => {
    expect(() => transitionEpisode("script_review", { type: "fail" })).toThrow();
  });

  test("draft --retry--> throws (only failed can retry)", () => {
    expect(() => transitionEpisode("draft", { type: "retry", into: "scripting" })).toThrow();
  });

  test("composing --recompose--> throws (only done can recompose)", () => {
    expect(() => transitionEpisode("composing", { type: "recompose" })).toThrow();
  });
});

describe("removeShot", () => {
  test("removes a shot into removed_shots without mutating the input", () => {
    const episode = makeEpisode(MIN_SHOTS + 1);
    const result = removeShot(episode, 1);

    expect(result.shots.length).toBe(MIN_SHOTS);
    expect(result.shots.find((s) => s.no === 1)).toBeUndefined();
    expect(result.removed_shots.map((s) => s.no)).toEqual([1]);

    // input untouched
    expect(episode.shots.length).toBe(MIN_SHOTS + 1);
    expect(episode.removed_shots.length).toBe(0);
  });

  test("throws when removal would drop below the MIN_SHOTS floor", () => {
    const episode = makeEpisode(MIN_SHOTS);
    expect(() => removeShot(episode, 1)).toThrow();
  });

  test("throws when the shot doesn't exist", () => {
    const episode = makeEpisode(MIN_SHOTS + 1);
    expect(() => removeShot(episode, 999)).toThrow();
  });
});

describe("isLegalEpisodeStatusChange", () => {
  test("accepts an advance", () => {
    expect(isLegalEpisodeStatusChange("draft", "scripting")).toBe(true);
  });

  test("accepts a fail from a generating state", () => {
    expect(isLegalEpisodeStatusChange("scripting", "failed")).toBe(true);
  });

  test("accepts a retry from failed into a generating state", () => {
    expect(isLegalEpisodeStatusChange("failed", "keyframing")).toBe(true);
  });

  test("accepts recompose from done", () => {
    expect(isLegalEpisodeStatusChange("done", "composing")).toBe(true);
  });

  test("rejects skipping straight from draft to done", () => {
    expect(isLegalEpisodeStatusChange("draft", "done")).toBe(false);
  });

  test("rejects recompose from a non-done state", () => {
    expect(isLegalEpisodeStatusChange("composing", "composing")).toBe(false);
  });
});
