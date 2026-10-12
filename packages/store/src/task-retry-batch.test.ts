import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Episode, Shot } from "@kelvoy/engine";
import { getCreditBalance, getCreditPrice, grantCredits } from "./credits";
import { close, getDb, open } from "./db";
import { getEpisode, insertEpisode } from "./episodes";
import { submitFailedTaskRetry } from "./task-retry";
import { enqueueTask, failTask, findRetryableFailedTask, listRetryableFailedTasks } from "./tasks";
import { createUser } from "./users";

let ownerId: string;
beforeEach(async () => {
  open(":memory:");
  const user = await createUser({ username: "batch-owner", password_hash: "hash" });
  if (!user.ok) throw new Error("fixture user failed");
  ownerId = user.user.user_id;
});
afterEach(() => close());

const IMAGE = () => getCreditPrice("image") * 3; // candidate_count 3
const VIDEO = () => getCreditPrice("video");

function shot(no: number, patch: Partial<Shot> = {}): Shot {
  return { no, scene: "s", size: "wide", beat: `b${no}`, camera: "static", landmark: null,
    kf_prompt: "k", motion_prompt: "m", duration_s: 4, candidates: [], kf_selected: null,
    clip: null, trim_start_s: null, status: "failed", regen_stage: null,
    bad_shot_reported: false, model: {}, ...patch };
}

function episode(shots: Shot[], patch: Partial<Episode> = {}): Episode {
  return {
    episode_id: "e_batch", owner_id: ownerId, name: "批量", status: "keyframing",
    persona_id: "p", persona_version: 1, destination_id: "d", destination_version: 1,
    series_id: "s", template_id: "t", mode: "per_shot", candidate_count: 3,
    created_at: "2026-09-26T00:00:00Z", estimated_credits: 0, credits_used: 0,
    share: { enabled: false, slug: "" },
    brief: { season: "秋", aspect: "9:16", requirements: "", duration_s: 30,
      tone: "", outfit_override: null, banned: [] },
    grid_refs: [], scenes: [], removed_shots: [], shots,
    music: { file: "", bpm: 0, license: "" },
    render: { res: "1080x1920", fps: 30, title: "", intro: null, outro: null, ai_label: true },
    ...patch,
  };
}

async function failedTask(stage: "keyframe" | "video", shotNo: number) {
  const task = await enqueueTask({ episode_id: "e_batch", stage, shot_no: shotNo });
  await failTask(task.task_id, { requeue: false });
  return task.task_id;
}

const tasksOf = (status: string) => getDb().query<{ stage: string; shot_no: number | null;
  generation_id: string | null; task_id: string }, [string]>(
  "select stage, shot_no, generation_id, task_id from tasks where status = ? order by shot_no").all(status);

async function loaded() {
  const r = await getEpisode("e_batch");
  if (!r.ok) throw new Error("missing episode");
  return r.episode;
}

test("listRetryableFailedTasks returns every failure and find keeps the latest", async () => {
  await insertEpisode(episode([shot(1), shot(2)]));
  await failedTask("keyframe", 1);
  await failedTask("keyframe", 2);
  const list = listRetryableFailedTasks(await loaded());
  expect(list.map((f) => f.shot_no)).toEqual([2, 1]);
  expect(findRetryableFailedTask(await loaded())).toEqual(list[0]!);
});

test("shot_no retries only that shot's failed task", async () => {
  await insertEpisode(episode([shot(1), shot(2)]));
  const first = await failedTask("keyframe", 1);
  await failedTask("keyframe", 2);
  grantCredits(ownerId, 100, "t");
  const res = submitFailedTaskRetry({ episode_id: "e_batch", owner_id: ownerId, row_version: 1, shot_no: 1 });
  expect(res).toEqual({ ok: true, row_version: 2, stage: "keyframe", shot_no: 1,
    queued: [{ stage: "keyframe", shot_no: 1, resynthesized: false }], skipped: [] });
  expect(tasksOf("pending").map((t) => [t.shot_no, t.generation_id])).toEqual([[1, first]]);
  expect(tasksOf("failed").map((t) => t.shot_no)).toEqual([2]);
  expect(getCreditBalance(ownerId).reserved).toBe(IMAGE());
});

test("shot_no together with all is an invalid target", async () => {
  await insertEpisode(episode([shot(1)]));
  expect(submitFailedTaskRetry({ episode_id: "e_batch", owner_id: ownerId, row_version: 1,
    shot_no: 1, all: true })).toEqual({ ok: false, error: "invalid_target" });
});

test("shot without a task record is re-issued by video_source and kf_selected", async () => {
  grantCredits(ownerId, 100, "t");
  const cases: [Partial<Episode>, Partial<Shot>, "keyframe" | "video"][] = [
    [{ video_source: "references" }, {}, "video"],
    [{ video_source: "keyframe" }, {}, "keyframe"],
    [{ video_source: "keyframe" }, { candidates: ["a.png"], kf_selected: "a.png" }, "video"],
    [{}, { candidates: ["a.png"], kf_selected: "zz.png" }, "keyframe"],
  ];
  for (const [ep, sh, stage] of cases) {
    getDb().query("delete from tasks").run();
    getDb().query("delete from episodes").run();
    await insertEpisode(episode([shot(1, sh)], { status: stage === "video" ? "clip_review" : "kf_review", ...ep }));
    const res = submitFailedTaskRetry({ episode_id: "e_batch", owner_id: ownerId, row_version: 1, shot_no: 1 });
    expect(res).toMatchObject({ ok: true, stage, shot_no: 1,
      queued: [{ stage, shot_no: 1, resynthesized: true }], skipped: [] });
    const [pending] = tasksOf("pending");
    expect(pending!.generation_id).toBe(pending!.task_id);
    expect(tasksOf("held")).toEqual([]);
  }
});

test("shot_no with neither failed task nor failed status is no_failed_task", async () => {
  await insertEpisode(episode([shot(1, { status: "kf_ready" })]));
  for (const no of [1, 9]) {
    expect(submitFailedTaskRetry({ episode_id: "e_batch", owner_id: ownerId, row_version: 1, shot_no: no }))
      .toEqual({ ok: false, error: "no_failed_task" });
  }
});

test("all queues failed shots and re-issues task-less ones in one transaction", async () => {
  await insertEpisode(episode([shot(1), shot(2), shot(3), shot(4, { status: "kf_ready" })], { status: "kf_review" }));
  const t1 = await failedTask("keyframe", 1);
  const t2 = await failedTask("keyframe", 2);
  grantCredits(ownerId, 100, "t");
  const res = submitFailedTaskRetry({ episode_id: "e_batch", owner_id: ownerId, row_version: 1, all: true });
  expect(res.ok && res.queued.map((q) => [q.shot_no, q.resynthesized]).sort()).toEqual([[1, false], [2, false], [3, true]]);
  expect(res.ok && res.skipped).toEqual([]);
  expect(tasksOf("pending").length).toBe(3);
  expect(getCreditBalance(ownerId).reserved).toBe(IMAGE() * 3);
  for (const id of [t1, t2]) {
    expect(getDb().query<{ status: string }, [string]>("select status from tasks where task_id = ?").get(id)?.status).toBe("retried");
  }
  const ep = await getEpisode("e_batch");
  expect(ep.ok && ep.episode.status).toBe("kf_review");
});

test("all with insufficient balance writes nothing", async () => {
  await insertEpisode(episode([shot(1), shot(2)]));
  await failedTask("keyframe", 1);
  await failedTask("keyframe", 2);
  grantCredits(ownerId, IMAGE() * 2 - 1, "t");
  expect(submitFailedTaskRetry({ episode_id: "e_batch", owner_id: ownerId, row_version: 1, all: true }))
    .toEqual({ ok: false, error: "insufficient_credits" });
  expect(tasksOf("pending")).toEqual([]);
  expect(tasksOf("failed").length).toBe(2);
  expect(getCreditBalance(ownerId).reserved).toBe(0);
  expect(submitFailedTaskRetry({ episode_id: "e_batch", owner_id: ownerId, row_version: 7, all: true }))
    .toEqual({ ok: false, error: "version_conflict", current_row_version: 1 });
});

test("all skips shots with active tasks and stages outside the current phase", async () => {
  await insertEpisode(episode([shot(1), shot(2), shot(3)], { status: "clip_review", video_source: "keyframe" }));
  await failedTask("video", 1);
  await failedTask("keyframe", 3);
  await enqueueTask({ episode_id: "e_batch", stage: "video", shot_no: 2 }); // already running
  grantCredits(ownerId, 100, "t");
  const res = submitFailedTaskRetry({ episode_id: "e_batch", owner_id: ownerId, row_version: 1, all: true });
  expect(res.ok && res.queued).toEqual([{ stage: "video", shot_no: 1, resynthesized: false }]);
  expect(res.ok && res.skipped.map((s) => s.shot_no).sort()).toEqual([2, 3]);
  expect(res.ok && res.skipped.every((s) => s.reason.length > 0)).toBe(true);
  expect(getCreditBalance(ownerId).reserved).toBe(VIDEO());
  expect(tasksOf("pending").filter((t) => t.shot_no === 2).length).toBe(1);
});

test("all with nothing retryable returns no_failed_task", async () => {
  await insertEpisode(episode([shot(1, { status: "kf_ready" })], { status: "kf_review" }));
  expect(submitFailedTaskRetry({ episode_id: "e_batch", owner_id: ownerId, row_version: 1, all: true }))
    .toEqual({ ok: false, error: "no_failed_task" });
});
