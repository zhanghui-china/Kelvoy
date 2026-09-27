import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Episode } from "@kelvoy/engine";
import { close, open } from "./db";
import { getEpisode, insertEpisode } from "./episodes";
import { convertLegacyCuts } from "./legacy-cuts";
import { createUser } from "./users";

let ownerId: string;
beforeEach(async () => {
  open(":memory:");
  const user = await createUser({ username: "legacy-owner", password_hash: "hash" });
  if (!user.ok) throw new Error("fixture user failed");
  ownerId = user.user.user_id;
});
afterEach(() => close());

test("old delivery conversion keeps clips and requires a fresh shot review", async () => {
  const episode = {
    episode_id: "e_old", owner_id: ownerId, name: "旧成片", status: "done", mode: "per_shot",
    persona_id: "p", persona_version: 1, destination_id: "d", destination_version: 1,
    series_id: "s", template_id: "t", candidate_count: 2, created_at: "2026-09-26T00:00:00Z",
    estimated_credits: 0, credits_used: 0, grid_refs: [], scenes: [], removed_shots: [],
    brief: { season: "秋", aspect: "9:16", requirements: "", duration_s: 30,
      tone: "", outfit_override: null, banned: [] },
    music: { file: "", bpm: 0, license: "" },
    cut_policy: "beat_aligned", share: { enabled: true, slug: "old-link" },
    render: { res: "1080x1920", fps: 30, title: "旧成片", intro: null, outro: null, ai_label: true },
    shots: [{ no: 1, scene: "s", size: "wide", beat: "街道", camera: "static",
      landmark: null, kf_prompt: "street", motion_prompt: "walk", candidates: ["kf/old.png"],
      kf_selected: "kf/old.png", status: "approved", clip: "clip/old.mp4",
      duration_s: 1.8, trim_start_s: 0.3, regen_stage: null, bad_shot_reported: false, model: {} }],
  } as Episode;
  await insertEpisode(episode);
  expect(convertLegacyCuts({ episode_id: "e_old", owner_id: ownerId, row_version: 1 }))
    .toEqual({ ok: true, row_version: 2 });
  const loaded = await getEpisode("e_old");
  if (!loaded.ok) throw new Error("missing episode");
  expect(loaded.episode.status).toBe("clip_review");
  expect(loaded.episode.cut_policy).toBe("fixed_1s");
  expect(loaded.episode.shots[0]).toMatchObject({ clip: "clip/old.mp4", status: "clip_ready",
    duration_s: 1, trim_start_s: null });
  expect(loaded.episode.share).toEqual({ enabled: true, slug: "old-link" });
  expect(convertLegacyCuts({ episode_id: "e_old", owner_id: ownerId, row_version: 2 }))
    .toEqual({ ok: false, error: "illegal_transition" });
});
