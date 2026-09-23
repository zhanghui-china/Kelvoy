import { afterEach, beforeEach, expect, test } from "bun:test";
import { close, getEpisode, open } from "@kelvoy/store";
import { importEpisode } from "./import-episode";

function validEpisode(id: string) {
  return {
    episode_id: id,
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
    shots: [
      {
        no: 1,
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
      },
    ],
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

beforeEach(() => {
  open(":memory:");
});

afterEach(() => {
  close();
});

test("rejects an invalid episode without writing", async () => {
  const result = await importEpisode({ episode_id: "e_bad" });
  expect(result.ok).toBe(false);
  expect(result.errors?.length).toBeGreaterThan(0);
  const stored = await getEpisode("e_bad");
  expect(stored.ok).toBe(false);
});

test("validates then inserts, readable via getEpisode afterwards", async () => {
  const result = await importEpisode(validEpisode("e_1"));
  expect(result).toEqual({ ok: true, episode_id: "e_1" });

  const stored = await getEpisode("e_1");
  expect(stored.ok).toBe(true);
  expect(stored.ok && stored.row_version).toBe(1);
});

test("reports a clean error instead of crashing on a duplicate episode_id", async () => {
  await importEpisode(validEpisode("e_2"));
  const second = await importEpisode(validEpisode("e_2"));
  expect(second.ok).toBe(false);
  expect(second.errors?.[0]).toContain("已存在");
});
