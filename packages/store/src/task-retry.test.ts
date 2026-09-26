import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Episode } from "@kelvoy/engine";
import { getCreditBalance, grantCredits } from "./credits";
import { close, getDb, open } from "./db";
import { getEpisode, insertEpisode, replaceEpisode } from "./episodes";
import { completeTaskWithEpisode, failTaskWithCredits } from "./charged-tasks";
import { submitFailedTaskRetry } from "./task-retry";
import { dequeueTask, enqueueTask, failTask, getLatestFailedTask } from "./tasks";
import { createUser } from "./users";

let ownerId: string;
beforeEach(async () => {
  open(":memory:");
  const user = await createUser({ username: "retry-owner", password_hash: "hash" });
  if (!user.ok) throw new Error("fixture user failed");
  ownerId = user.user.user_id;
});
afterEach(() => close());

function episode(): Episode {
  return {
    episode_id: "e_retry", owner_id: ownerId, name: "重试", status: "keyframing",
    persona_id: "p", persona_version: 1, destination_id: "d", destination_version: 1,
    series_id: "s", template_id: "t", mode: "per_shot", candidate_count: 3,
    created_at: "2026-09-26T00:00:00Z", estimated_credits: 0, credits_used: 0,
    share: { enabled: false, slug: "" },
    brief: { season: "秋", aspect: "9:16", requirements: "", duration_s: 30,
      tone: "", outfit_override: null, banned: [] },
    grid_refs: [], scenes: [], removed_shots: [],
    shots: [{ no: 1, scene: "s", size: "wide", beat: "街道", camera: "static",
      landmark: null, kf_prompt: "street", motion_prompt: "walk", duration_s: 1,
      candidates: [], kf_selected: null, clip: null, trim_start_s: null,
      status: "failed", regen_stage: null, bad_shot_reported: false, model: {} }],
    music: { file: "", bpm: 0, license: "" },
    render: { res: "1080x1920", fps: 30, title: "", intro: null, outro: null, ai_label: true },
  };
}

test("retry requeues failed image with original generation identity and one fresh reservation", async () => {
  await insertEpisode(episode());
  const old = await enqueueTask({ episode_id: "e_retry", stage: "keyframe", shot_no: 1 });
  const claimed = await dequeueTask();
  expect(failTaskWithCredits(claimed!, false)).toBe(true);
  expect(await getLatestFailedTask(episode())).toEqual({ stage: "keyframe", shot_no: 1 });
  grantCredits(ownerId, 3, "retry-test");
  expect(submitFailedTaskRetry({ episode_id: "e_retry", owner_id: ownerId, row_version: 2 }))
    .toEqual({ ok: false, error: "version_conflict", current_row_version: 1 });
  expect(submitFailedTaskRetry({ episode_id: "e_retry", owner_id: ownerId, row_version: 1 }))
    .toEqual({ ok: true, row_version: 2, stage: "keyframe", shot_no: 1 });
  const afterRetry = await getEpisode("e_retry");
  expect(afterRetry.ok && await getLatestFailedTask(afterRetry.episode)).toBeNull();
  expect(getCreditBalance(ownerId)).toEqual({ available: 0, reserved: 3 });
  const retry = await dequeueTask();
  expect(retry?.task_id).not.toBe(old.task_id);
  expect(retry?.generation_id).toBe(old.task_id);
  expect(retry?.shot_no).toBe(1);
  expect((await getEpisode("e_retry")).ok).toBe(true);
  expect(submitFailedTaskRetry({ episode_id: "e_retry", owner_id: ownerId, row_version: 2 }))
    .toEqual({ ok: false, error: "no_failed_task" });
});

test("failed compose retries only after reserving the action price", async () => {
  await insertEpisode({ ...episode(), status: "failed", shots: [] });
  await enqueueTask({ episode_id: "e_retry", stage: "compose" });
  const claimed = await dequeueTask();
  failTaskWithCredits(claimed!, false);
  expect(submitFailedTaskRetry({ episode_id: "e_retry", owner_id: ownerId, row_version: 1 }))
    .toEqual({ ok: false, error: "insufficient_credits" });
  expect(getDb().query<{ status: string }, []>("select status from tasks where stage = 'compose'").get()?.status).toBe("failed");
  grantCredits(ownerId, 1, "compose-test");
  expect(submitFailedTaskRetry({ episode_id: "e_retry", owner_id: ownerId, row_version: 1 }))
    .toEqual({ ok: true, row_version: 2, stage: "compose", shot_no: null });
  const retry = await dequeueTask();
  expect(retry?.stage).toBe("compose");
  const loaded = await getEpisode("e_retry");
  expect(loaded.ok && loaded.episode.status).toBe("composing");
});

test("retired keyframe failure cannot reactivate after later video failure", async () => {
  await insertEpisode(episode());
  const oldKeyframe = await enqueueTask({ episode_id: "e_retry", stage: "keyframe", shot_no: 1 });
  await failTask(oldKeyframe.task_id, { requeue: false });
  grantCredits(ownerId, 20, "two-stage-retry");
  expect(submitFailedTaskRetry({ episode_id: "e_retry", owner_id: ownerId, row_version: 1 }).ok).toBe(true);
  const imageRetry = await dequeueTask();
  const ready = { ...episode(), status: "kf_review" as const,
    shots: [{ ...episode().shots[0]!, status: "kf_ready" as const }] };
  expect(completeTaskWithEpisode(imageRetry!, 2, ready).ok).toBe(true);
  const videoStage = { ...ready, status: "clipping" as const,
    shots: [{ ...ready.shots[0]!, status: "failed" as const }] };
  expect((await replaceEpisode("e_retry", 3, videoStage)).ok).toBe(true);
  const oldVideo = await enqueueTask({ episode_id: "e_retry", stage: "video", shot_no: 1 });
  await failTask(oldVideo.task_id, { requeue: false });
  expect(submitFailedTaskRetry({ episode_id: "e_retry", owner_id: ownerId, row_version: 4 }))
    .toEqual({ ok: true, row_version: 5, stage: "video", shot_no: 1 });
  const balance = getCreditBalance(ownerId);
  const loaded = await getEpisode("e_retry");
  expect(loaded.ok && await getLatestFailedTask(loaded.episode)).toBeNull();
  expect(submitFailedTaskRetry({ episode_id: "e_retry", owner_id: ownerId, row_version: 5 }))
    .toEqual({ ok: false, error: "no_failed_task" });
  expect(getCreditBalance(ownerId)).toEqual(balance);
  expect(getDb().query<{ status: string }, [string]>("select status from tasks where task_id = ?")
    .get(oldKeyframe.task_id)?.status).toBe("retried");
});
