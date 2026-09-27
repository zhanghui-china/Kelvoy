import { expect, test } from "bun:test";
import type { Episode, Shot, ShotModelRecord } from "@kelvoy/engine";
import { tally } from "./tally";

function fixtureRecord(overrides: Partial<ShotModelRecord> = {}): ShotModelRecord {
  return {
    provider: "kling",
    model: "kling-v1",
    version: "1.0",
    seed: 1,
    prompt: "test",
    ref_hashes: [],
    attempts: 1,
    cost_usd: 0.1,
    ...overrides,
  };
}

function fixtureShot(no: number, overrides: Partial<Shot> = {}): Shot {
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
    ...overrides,
  };
}

function fixtureEpisode(shots: Shot[]): Episode {
  return {
    name: "测试期", episode_id: "e_test",
    owner_id: "u_test",
    persona_id: "c_test",
    persona_version: 1,
    destination_id: "d_test",
    destination_version: 1,
    series_id: "s_test",
    template_id: "t_test",
    status: "done",
    mode: "per_shot", candidate_count: 2,
    created_at: "2026-09-23T00:00:00+08:00",
    estimated_credits: 0,
    credits_used: 12,
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
    shots,
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

test("returns an empty list when no shot has a model record", () => {
  const episode = fixtureEpisode([fixtureShot(1), fixtureShot(2)]);
  expect(tally(episode)).toEqual([]);
});

test("sums shots/attempts/cost per provider+model, image and video counted separately", () => {
  const episode = fixtureEpisode([
    fixtureShot(1, {
      model: {
        image: fixtureRecord({ provider: "kling", model: "kling-v1", attempts: 2, cost_usd: 0.1 }),
        video: fixtureRecord({ provider: "jimeng", model: "jimeng-v2", attempts: 1, cost_usd: 0.3 }),
      },
    }),
    fixtureShot(2, {
      model: {
        image: fixtureRecord({ provider: "kling", model: "kling-v1", attempts: 1, cost_usd: 0.05 }),
      },
    }),
  ]);

  const rows = tally(episode);
  expect(rows).toHaveLength(2);

  const kling = rows.find((r) => r.provider === "kling");
  expect(kling?.shots).toBe(2);
  expect(kling?.attempts).toBe(3);
  expect(kling?.costUsd).toBeCloseTo(0.15);

  const jimeng = rows.find((r) => r.provider === "jimeng");
  expect(jimeng?.shots).toBe(1);
  expect(jimeng?.attempts).toBe(1);
  expect(jimeng?.costUsd).toBeCloseTo(0.3);
});

test("keeps different models under the same provider as separate rows", () => {
  const episode = fixtureEpisode([
    fixtureShot(1, { model: { image: fixtureRecord({ provider: "kling", model: "kling-v1" }) } }),
    fixtureShot(2, { model: { image: fixtureRecord({ provider: "kling", model: "kling-v2" }) } }),
  ]);

  const rows = tally(episode);
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.model).sort()).toEqual(["kling-v1", "kling-v2"]);
});
