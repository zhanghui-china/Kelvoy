import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Episode } from "@kelvoy/engine";
import { close, open } from "./db";
import { getEpisode, insertEpisode } from "./episodes";
import { upgradeToLongCuts } from "./legacy-cuts";
import { createUser } from "./users";

let ownerId: string;
beforeEach(async () => {
  open(":memory:");
  const user = await createUser({ username: "legacy-owner", password_hash: "hash" });
  if (!user.ok) throw new Error("fixture user failed");
  ownerId = user.user.user_id;
});
afterEach(() => close());

function legacy(policy: "beat_aligned" | "fixed_1s", shotCount = 1, id = "e_old"): Episode {
  const shot = (no: number) => ({ no, scene: "s", size: "wide", beat: "街道", camera: "static",
    landmark: null, kf_prompt: "street", motion_prompt: "walk", candidates: ["kf/old.png"],
    kf_selected: "kf/old.png", status: "approved", clip: `clip/old${no}.mp4`,
    duration_s: 1, trim_start_s: 0.3, regen_stage: null, bad_shot_reported: false, model: {} });
  return {
    episode_id: id, owner_id: ownerId, name: "旧成片", status: "done", mode: "per_shot",
    persona_id: "p", persona_version: 1, destination_id: "d", destination_version: 1,
    series_id: "s", template_id: "t", candidate_count: 2, created_at: "2026-09-26T00:00:00Z",
    estimated_credits: 0, credits_used: 0, grid_refs: [], scenes: [], removed_shots: [],
    brief: { season: "秋", aspect: "9:16", requirements: "", duration_s: 30,
      tone: "", outfit_override: null, banned: [] },
    music: { file: "", bpm: 0, license: "" },
    cut_policy: policy, share: { enabled: true, slug: "old-link" },
    render: { res: "1080x1920", fps: 30, title: "旧成片", intro: null, outro: null, ai_label: true,
      transitions_enabled: true, subtitles_enabled: true },
    shots: Array.from({ length: shotCount }, (_, i) => shot(i + 1)),
  } as unknown as Episode;
}

test.each(["beat_aligned", "fixed_1s"] as const)("%s upgrade keeps clips and requires a fresh shot review", async (policy) => {
  await insertEpisode(legacy(policy, 7));
  expect(upgradeToLongCuts({ episode_id: "e_old", owner_id: ownerId, row_version: 1, duration_s: 30 }))
    .toEqual({ ok: true, row_version: 2 });
  const loaded = await getEpisode("e_old");
  if (!loaded.ok) throw new Error("missing episode");
  expect(loaded.episode.status).toBe("clip_review");
  expect(loaded.episode.cut_policy).toBe("long_3_6");
  expect(loaded.episode.brief.duration_s).toBe(30);
  expect(loaded.episode.render.transitions_enabled).toBe(false);
  expect(loaded.episode.render.subtitles_enabled).toBe(true);
  expect(loaded.episode.shots[0]).toMatchObject({ clip: "clip/old1.mp4", status: "clip_ready",
    duration_s: 4, trim_start_s: null });
  expect(loaded.episode.share).toEqual({ enabled: true, slug: "old-link" });
  expect(upgradeToLongCuts({ episode_id: "e_old", owner_id: ownerId, row_version: 2, duration_s: 30 }))
    .toEqual({ ok: false, error: "illegal_transition" });
});

test("upgrade rejects infeasible or invalid durations without writing", async () => {
  await insertEpisode(legacy("fixed_1s", 28));
  const call = (duration_s: number) => upgradeToLongCuts({ episode_id: "e_old", owner_id: ownerId, row_version: 1, duration_s });
  expect(call(30)).toEqual({ ok: false, error: "duration_infeasible", shots: 28, min_s: 84, max_s: 168 });
  expect(call(200)).toMatchObject({ error: "duration_infeasible" });
  expect(call(Number.NaN)).toEqual({ ok: false, error: "invalid_duration" });
  expect(call(90)).toEqual({ ok: true, row_version: 2 });
});

test("upgrade enforces ownership, version and clip presence", async () => {
  const ep = legacy("fixed_1s", 2); ep.shots[1].clip = null;
  await insertEpisode(ep);
  const call = (owner = ownerId, row_version = 1) => upgradeToLongCuts({ episode_id: "e_old", owner_id: owner, row_version, duration_s: 8 });
  expect(call("someone-else")).toEqual({ ok: false, error: "not_found" });
  expect(call(ownerId, 9)).toMatchObject({ ok: false, error: "version_conflict" });
  expect(call()).toEqual({ ok: false, error: "illegal_transition" });
});
