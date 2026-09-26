import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Episode } from "@kelvoy/engine";
import { createEpisodeWithScriptTask, completeTaskWithEpisode, failTaskWithCredits,
  submitReviewAdvance, submitShotRegeneration } from "./charged-tasks";
import { getCreditBalance, grantCredits, listCreditLedger } from "./credits";
import { close, getDb, open } from "./db";
import { getEpisode, insertEpisode } from "./episodes";
import { dequeueTask } from "./tasks";
import { createUser } from "./users";

let ownerId = "";
beforeEach(async () => {
  open(":memory:");
  const user = await createUser({ username: "owner", password_hash: "hash" });
  if (!user.ok) throw new Error("fixture user failed");
  ownerId = user.user.user_id;
});
afterEach(() => close());

function episode(): Episode {
  return {
    episode_id: "e_charge", owner_id: ownerId, name: "测试", status: "draft",
    persona_id: "p", persona_version: 1, destination_id: "d", destination_version: 1,
    series_id: "s", template_id: "t", mode: "per_shot", candidate_count: 3,
    created_at: "2026-09-26T00:00:00Z", estimated_credits: 392, credits_used: 0,
    share: { enabled: false, slug: "" },
    brief: { season: "秋", aspect: "9:16", requirements: "", duration_s: 30,
      tone: "", outfit_override: null, banned: [] },
    grid_refs: [], scenes: [], shots: [], removed_shots: [],
    music: { file: "", bpm: 0, license: "" },
    render: { res: "1080x1920", fps: 30, title: "", intro: null, outro: null, ai_label: true },
  };
}

test("creation blocks zero balance without leaving a project or task", async () => {
  expect(createEpisodeWithScriptTask(episode())).toEqual({ ok: false, error: "insufficient_credits" });
  expect((await getEpisode("e_charge")).ok).toBe(false);
  expect(await dequeueTask()).toBeNull();
});

test("brief handoff preserves script reservation; script success settles it exactly once", async () => {
  grantCredits(ownerId, 2, "test-grant");
  expect(createEpisodeWithScriptTask(episode()).ok).toBe(true);
  expect(getCreditBalance(ownerId)).toEqual({ available: 1, reserved: 1 });
  const brief = await dequeueTask();
  expect(brief?.stage).toBe("brief");
  expect(completeTaskWithEpisode(brief!, 1, { ...episode(), status: "scripting" }).ok).toBe(true);
  expect(getCreditBalance(ownerId)).toEqual({ available: 1, reserved: 1 });
  const script = await dequeueTask();
  expect(script?.stage).toBe("script");
  expect(script?.task_id).toBe("tk_script_e_charge");
  expect(completeTaskWithEpisode(script!, 2, { ...episode(), status: "script_review" }).ok).toBe(true);
  expect(getCreditBalance(ownerId)).toEqual({ available: 1, reserved: 0 });
  expect(listCreditLedger(ownerId).map((entry) => entry.kind)).toEqual(["settled", "reserve", "grant"]);
  expect(await dequeueTask()).toBeNull();
});

test("a terminal brief failure releases the script reservation", async () => {
  grantCredits(ownerId, 1, "test-grant");
  createEpisodeWithScriptTask(episode());
  const brief = await dequeueTask();
  expect(failTaskWithCredits(brief!, false)).toBe(true);
  expect(getCreditBalance(ownerId)).toEqual({ available: 1, reserved: 0 });
  expect(await dequeueTask()).toBeNull();
});

test("review gate reserves every image candidate before moving to assets", async () => {
  const draft = { ...episode(), status: "script_review" as const, candidate_count: 3,
    shots: [{ no: 1, status: "draft" }, { no: 2, status: "draft" }] } as Episode;
  await insertEpisode(draft);
  grantCredits(ownerId, 5, "short-grant");
  expect(submitReviewAdvance({ episode_id: draft.episode_id, owner_id: ownerId,
    row_version: 1, next_status: "assets" })).toEqual({ ok: false, error: "insufficient_credits" });
  const unchanged = await getEpisode(draft.episode_id);
  expect(unchanged.ok && unchanged.episode.status).toBe("script_review");
  expect(await dequeueTask()).toBeNull();
  grantCredits(ownerId, 5, "second-grant");
  expect(submitReviewAdvance({ episode_id: draft.episode_id, owner_id: ownerId,
    row_version: 1, next_status: "assets" })).toEqual({ ok: true, row_version: 2 });
  expect(getCreditBalance(ownerId)).toEqual({ available: 4, reserved: 6 });
  const assets = await dequeueTask();
  expect(assets?.stage).toBe("assets");
  expect(await dequeueTask()).toBeNull();
  completeTaskWithEpisode(assets!, 2, { ...draft, status: "keyframing" });
  const one = await dequeueTask();
  const two = await dequeueTask();
  expect([one?.stage, two?.stage]).toEqual(["keyframe", "keyframe"]);
});

test("only the first reported bad video for a shot is free", async () => {
  const shot = { no: 1, status: "approved", kf_selected: "kf/1.png",
    candidates: ["kf/1.png"], bad_shot_reported: false };
  const done = { ...episode(), status: "done" as const, candidate_count: 3,
    shots: [shot] } as Episode;
  await insertEpisode(done);
  const first = submitShotRegeneration({ episode_id: done.episode_id, owner_id: ownerId,
    row_version: 1, shot_no: 1, stage: "video", report_bad: true });
  expect(first).toEqual({ ok: true, row_version: 2, free: true });
  expect(getCreditBalance(ownerId)).toEqual({ available: 0, reserved: 0 });
  const current = await getEpisode(done.episode_id);
  if (!current.ok) throw new Error("missing episode");
  const retryable = { ...current.episode, shots: [{ ...current.episode.shots[0], status: "clip_ready" }] };
  getDb().query("update episodes set doc = ?, row_version = 3 where episode_id = ?")
    .run(JSON.stringify(retryable), done.episode_id);
  expect(submitShotRegeneration({ episode_id: done.episode_id, owner_id: ownerId,
    row_version: 3, shot_no: 1, stage: "video", report_bad: true }))
    .toEqual({ ok: false, error: "insufficient_credits" });
  grantCredits(ownerId, 10, "regen-grant");
  expect(submitShotRegeneration({ episode_id: done.episode_id, owner_id: ownerId,
    row_version: 3, shot_no: 1, stage: "video", report_bad: true }))
    .toEqual({ ok: true, row_version: 4, free: false });
  expect(getCreditBalance(ownerId)).toEqual({ available: 0, reserved: 10 });
});
