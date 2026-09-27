import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Episode } from "@kelvoy/engine";
import { createEpisodeWithScriptTask, completeTaskWithEpisode, failTaskWithCredits,
  requeueTaskAfterCommitConflict,
  submitReviewAdvance, submitShotRegeneration } from "./charged-tasks";
import { getCreditBalance, grantCredits, listCreditLedger, reserveCredits } from "./credits";
import { close, getDb, open } from "./db";
import { getEpisode, insertEpisode, patchShot } from "./episodes";
import { upsertDestination } from "./destinations";
import { dequeueTask, enqueueTask } from "./tasks";
import { createUser } from "./users";
import { submitScriptAction } from "./script-actions";

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

function reviewShots(count = 24): Episode["shots"] {
  return Array.from({ length: count }, (_, index) => ({
    no: index + 1, status: "draft", size: index % 2 ? "medium" : "wide",
    landmark: index < 5 ? "l1" : null,
  })) as Episode["shots"];
}

async function reviewDestination(): Promise<void> {
  await upsertDestination({ destination_id: "d", version: 1, name: "目的地", city: "无锡",
    type: "scenic_area", season_best: ["春"], landmarks: [{ id: "l1", name: "景点",
      refs: ["a.jpg", "b.jpg", "c.jpg"], best_time: "上午", must_keep: [] }],
    route: [], food: [], transport: "", stay: "" });
}

test("review advance rejects an edited script that breaks structural rules", async () => {
  await reviewDestination();
  const draft = { ...episode(), status: "script_review" as const, shots: reviewShots() };
  draft.shots[2] = { ...draft.shots[2]!, size: "medium" };
  await insertEpisode(draft);
  grantCredits(ownerId, 100, "review-grant");
  expect(submitReviewAdvance({ episode_id: draft.episode_id, owner_id: ownerId,
    row_version: 1, next_status: "assets" })).toEqual({ ok: false, error: "script_rule_violation" });
  expect((await getEpisode(draft.episode_id)).ok).toBe(true);
  expect(await dequeueTask()).toBeNull();
  expect(getCreditBalance(ownerId).reserved).toBe(0);
});

test("review advance cannot bypass keyframe selection or clip approval through the store", async () => {
  const kf = { ...episode(), status: "kf_review" as const,
    shots: [{ no: 1, status: "kf_ready", candidates: ["kf/1.png"], kf_selected: null }] } as Episode;
  await insertEpisode(kf);
  expect(submitReviewAdvance({ episode_id: kf.episode_id, owner_id: ownerId,
    row_version: 1, next_status: "clipping" })).toEqual({ ok: false, error: "illegal_transition" });
  const clip = { ...episode(), episode_id: "e_clip_review", status: "clip_review" as const,
    shots: [{ no: 1, status: "clip_ready", clip: "clip/1.mp4" }] } as Episode;
  await insertEpisode(clip);
  expect(submitReviewAdvance({ episode_id: clip.episode_id, owner_id: ownerId,
    row_version: 1, next_status: "composing" })).toEqual({ ok: false, error: "illegal_transition" });
});

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

test("shot completion keeps a selection made on another shot during generation", async () => {
  const started = { ...episode(), status: "keyframing" as const, shots: [
    { no: 1, status: "generating_kf", candidates: [], kf_selected: null },
    { no: 2, status: "kf_ready", candidates: ["kf/2.png"], kf_selected: null },
  ] } as Episode;
  await insertEpisode(started);
  await enqueueTask({ episode_id: started.episode_id, stage: "keyframe", shot_no: 1 });
  const task = await dequeueTask();
  expect(task).not.toBeNull();

  const selection = await patchShot(started.episode_id, 2, 1,
    { status: "kf_selected", kf_selected: "kf/2.png" });
  expect(selection.ok).toBe(true);
  const generated = { ...started, status: "kf_review" as const, shots: [
    { ...started.shots[0], status: "kf_ready" as const, candidates: ["kf/1.png"] },
    started.shots[1],
  ] };
  expect(completeTaskWithEpisode(task!, 1, generated, started).ok).toBe(true);
  const saved = await getEpisode(started.episode_id);
  expect(saved.ok && saved.episode.status).toBe("kf_review");
  expect(saved.ok && saved.episode.shots[0]?.status).toBe("kf_ready");
  expect(saved.ok && saved.episode.shots[1]?.status).toBe("kf_selected");
  expect(saved.ok && saved.episode.shots[1]?.kf_selected).toBe("kf/2.png");
  expect(getDb().query<{ status: string }, [string]>("select status from tasks where task_id = ?")
    .get(task!.task_id)?.status).toBe("done");
});

test("an obsolete result cannot restore a shot changed by another command", async () => {
  const started = { ...episode(), status: "keyframing" as const,
    shots: [{ no: 1, status: "generating_kf", candidates: [], kf_selected: null }] } as unknown as Episode;
  await insertEpisode(started);
  await enqueueTask({ episode_id: started.episode_id, stage: "keyframe", shot_no: 1 });
  const task = await dequeueTask();
  const changed = { ...started, shots: [{ ...started.shots[0]!, status: "failed" as const }] };
  getDb().query("update episodes set doc = ?, row_version = 2 where episode_id = ?")
    .run(JSON.stringify(changed), started.episode_id);
  const generated = { ...started, status: "kf_review" as const,
    shots: [{ ...started.shots[0]!, status: "kf_ready" as const, candidates: ["kf/obsolete.png"] }] };
  expect(completeTaskWithEpisode(task!, 1, generated, started))
    .toEqual({ ok: false, error: "illegal_transition" });
  const loaded = await getEpisode(started.episode_id);
  expect(loaded.ok && loaded.episode.shots[0]?.status).toBe("failed");
});

test("shot commit uses the same defaults for a legacy episode row as the worker", async () => {
  const legacy = { ...episode(), status: "keyframing" as const,
    shots: [{ no: 1, status: "generating_kf", candidates: [], kf_selected: null }] } as unknown as Episode;
  const raw = JSON.parse(JSON.stringify(legacy)) as Record<string, unknown>;
  delete raw.candidate_count;
  const brief = raw.brief as Record<string, unknown>;
  delete brief.aspect;
  delete brief.requirements;
  getDb().query("insert into episodes (episode_id, owner_id, row_version, doc) values (?, ?, 1, ?)")
    .run(legacy.episode_id, ownerId, JSON.stringify(raw));
  await enqueueTask({ episode_id: legacy.episode_id, stage: "keyframe", shot_no: 1 });
  const task = await dequeueTask();
  const read = await getEpisode(legacy.episode_id);
  if (!read.ok) throw new Error("missing episode");
  const generated = { ...read.episode, status: "kf_review" as const,
    shots: [{ ...read.episode.shots[0]!, status: "kf_ready" as const, candidates: ["kf/legacy.png"] }] };
  expect(completeTaskWithEpisode(task!, read.row_version, generated, read.episode).ok).toBe(true);
  const saved = await getEpisode(legacy.episode_id);
  expect(saved.ok && saved.episode.shots[0]?.status).toBe("kf_ready");
});

test("a terminal brief failure releases the script reservation", async () => {
  grantCredits(ownerId, 1, "test-grant");
  createEpisodeWithScriptTask(episode());
  const brief = await dequeueTask();
  expect(failTaskWithCredits(brief!, false)).toBe(true);
  expect(getCreditBalance(ownerId)).toEqual({ available: 1, reserved: 0 });
  expect(await dequeueTask()).toBeNull();
});

test("terminal shot failure commits task, refund, shot state and reason together", async () => {
  const started = { ...episode(), status: "keyframing" as const,
    shots: [{ no: 1, status: "generating_kf" as const, candidates: [], kf_selected: null }] } as unknown as Episode;
  await insertEpisode(started);
  grantCredits(ownerId, 3, "failure-grant");
  const task = await enqueueTask({ episode_id: started.episode_id, stage: "keyframe", shot_no: 1 });
  expect(reserveCredits({ action_id: task.task_id, user_id: ownerId,
    episode_id: started.episode_id, task_id: task.task_id, kind: "image", units: 3 }).ok).toBe(true);
  const claimed = await dequeueTask();
  expect(failTaskWithCredits(claimed!, false, "模型无响应")).toBe(true);
  const loaded = await getEpisode(started.episode_id);
  expect(loaded.ok && loaded.episode.shots[0]?.status).toBe("failed");
  expect(loaded.ok && loaded.episode.failure_reason).toBe("模型无响应");
  expect(loaded.ok && loaded.row_version).toBe(2);
  expect(getDb().query<{ status: string }, [string]>("select status from tasks where task_id = ?")
    .get(task.task_id)?.status).toBe("failed");
  expect(getCreditBalance(ownerId).reserved).toBe(0);
});

test("terminal script action failure clears its marker and refunds in one transaction", async () => {
  await insertEpisode({ ...episode(), status: "script_review" });
  grantCredits(ownerId, 1, "script-action-grant");
  const queued = submitScriptAction({ episode_id: "e_charge", owner_id: ownerId,
    row_version: 1, operation: "script_optimize", instruction: "突出夜景" });
  expect(queued.ok).toBe(true);
  const task = await dequeueTask();
  expect(task?.operation).toBe("script_optimize");
  getDb().exec(`create trigger reject_failure before update on tasks
    when new.status = 'failed' begin select raise(abort, 'injected failure'); end`);
  expect(() => failTaskWithCredits(task!, false)).toThrow("injected failure");
  const during = await getEpisode("e_charge");
  expect(during.ok && during.episode.script_pending_task_id).toBe(task?.task_id);
  expect(getCreditBalance(ownerId).reserved).toBe(1);
  expect(getDb().query<{ status: string }, [string]>("select status from tasks where task_id = ?")
    .get(task!.task_id)?.status).toBe("processing");
  getDb().exec("drop trigger reject_failure");
  expect(failTaskWithCredits(task!, false)).toBe(true);
  const saved = await getEpisode("e_charge");
  expect(saved.ok && saved.episode.status).toBe("script_review");
  expect(saved.ok && saved.episode.script_pending_task_id).toBeNull();
  expect(saved.ok && saved.episode.script_action_error).toContain("原稿已保留");
  expect(getCreditBalance(ownerId).reserved).toBe(0);
  expect(getDb().query<{ status: string }, [string]>("select status from tasks where task_id = ?")
    .get(task!.task_id)?.status).toBe("failed");
});

test("write conflict requeues without consuming the model failure budget", async () => {
  await insertEpisode(episode());
  const queued = await enqueueTask({ episode_id: "e_charge", stage: "brief" });
  const claimed = await dequeueTask();
  expect(requeueTaskAfterCommitConflict(claimed!)).toBe(true);
  const again = await dequeueTask();
  expect(again?.task_id).toBe(queued.task_id);
  expect(again?.attempt).toBe(claimed?.attempt);
});

test("an expired lease cannot settle credits or publish a result before recovery", async () => {
  await insertEpisode(episode());
  await enqueueTask({ episode_id: "e_charge", stage: "brief" });
  const old = await dequeueTask();
  getDb().query("update tasks set lease_until = 1 where task_id = ?").run(old!.task_id);
  expect(completeTaskWithEpisode(old!, 1, { ...episode(), status: "scripting" }))
    .toEqual({ ok: false, error: "lease_lost" });
  expect(failTaskWithCredits(old!, false)).toBe(false);
  const stored = await getEpisode("e_charge");
  expect(stored.ok && stored.episode.status).toBe("draft");
  expect((await dequeueTask())?.lease_token).not.toBe(old?.lease_token);
});

test("review gate reserves every image candidate before moving to assets", async () => {
  await reviewDestination();
  const draft = { ...episode(), status: "script_review" as const, candidate_count: 3,
    shots: reviewShots() } as Episode;
  await insertEpisode(draft);
  grantCredits(ownerId, 5, "short-grant");
  expect(submitReviewAdvance({ episode_id: draft.episode_id, owner_id: ownerId,
    row_version: 1, next_status: "assets" })).toEqual({ ok: false, error: "insufficient_credits" });
  const unchanged = await getEpisode(draft.episode_id);
  expect(unchanged.ok && unchanged.episode.status).toBe("script_review");
  expect(await dequeueTask()).toBeNull();
  grantCredits(ownerId, 70, "second-grant");
  expect(submitReviewAdvance({ episode_id: draft.episode_id, owner_id: ownerId,
    row_version: 1, next_status: "assets" })).toEqual({ ok: true, row_version: 2 });
  expect(getCreditBalance(ownerId)).toEqual({ available: 3, reserved: 72 });
  const assets = await dequeueTask();
  expect(assets?.stage).toBe("assets");
  expect(await dequeueTask()).toBeNull();
  completeTaskWithEpisode(assets!, 2, { ...draft, status: "keyframing" });
  const children = await Promise.all(Array.from({ length: 24 }, () => dequeueTask()));
  expect(children.every((child) => child?.stage === "keyframe")).toBe(true);
  expect(await dequeueTask()).toBeNull();
});

test("direct reference review reserves videos and skips image tasks", async () => {
  await reviewDestination();
  const draft = { ...episode(), video_source: "references" as const,
    status: "script_review" as const, shots: reviewShots() } as Episode;
  await insertEpisode(draft);
  grantCredits(ownerId, 240, "direct-grant");
  expect(submitReviewAdvance({ episode_id: draft.episode_id, owner_id: ownerId,
    row_version: 1, next_status: "assets" })).toEqual({ ok: true, row_version: 2 });
  expect(getCreditBalance(ownerId)).toEqual({ available: 0, reserved: 240 });
  const assets = await dequeueTask();
  expect(assets?.stage).toBe("assets");
  expect(await dequeueTask()).toBeNull();
  expect(completeTaskWithEpisode(assets!, 2, { ...draft, status: "clipping" }).ok).toBe(true);
  const videos = await Promise.all(Array.from({ length: 24 }, () => dequeueTask()));
  expect(videos.every((video) => video?.stage === "video")).toBe(true);
  expect(await dequeueTask()).toBeNull();
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

test("direct reference shots can regenerate video without a keyframe, not images", async () => {
  const done = { ...episode(), video_source: "references" as const,
    status: "done" as const, shots: [{ no: 1, status: "approved", candidates: [],
      kf_selected: null, bad_shot_reported: false }] } as unknown as Episode;
  await insertEpisode(done);
  expect(submitShotRegeneration({ episode_id: done.episode_id, owner_id: ownerId,
    row_version: 1, shot_no: 1, stage: "keyframe", report_bad: false }))
    .toEqual({ ok: false, error: "illegal_transition" });
  grantCredits(ownerId, 10, "direct-regen-grant");
  expect(submitShotRegeneration({ episode_id: done.episode_id, owner_id: ownerId,
    row_version: 1, shot_no: 1, stage: "video", report_bad: false }))
    .toEqual({ ok: true, row_version: 2, free: false });
});
