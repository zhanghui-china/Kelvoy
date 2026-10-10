import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Episode } from "@kelvoy/engine";
import { close, getDb, open } from "./db";
import { createUser } from "./users";
import { insertEpisode, getEpisode, getUsageSummary } from "./episodes";
import { grantCredits, reserveCredits, finalizeCredits, getCreditBalance } from "./credits";
import { enqueueTask, dequeueTask, completeTask, failTask } from "./tasks";
import { insertPersona, getPersona } from "./personas";
import { upsertDestination, getDestination } from "./destinations";
import { upsertTemplate, getTemplate } from "./templates";
import {
  deleteEpisode,
  listPendingEpisodeDeletions,
  acknowledgeDeletedTaskExecution,
  finishEpisodeDeletionCleanup,
  requestEpisodeDeletionCleanup,
  failEpisodeDeletionCleanup,
} from "./episode-deletion";
import {
  completeTaskWithEpisode,
  failTaskWithCredits,
  requeueTaskAfterCommitConflict,
} from "./charged-tasks";
import { completeStoryboardSuggestion } from "./storyboard-suggestions";
import { submitFailedTaskRetry } from "./task-retry";

function fixture(id: string, ownerId: string): Episode {
  return {
    episode_id: id,
    owner_id: ownerId,
    name: "测试",
    status: "draft",
    persona_id: "p",
    persona_version: 1,
    destination_id: "d",
    destination_version: 1,
    series_id: "s",
    template_id: "t",
    mode: "per_shot",
    candidate_count: 2,
    created_at: "2026-10-01",
    estimated_credits: 0,
    credits_used: 0,
    share: { enabled: true, slug: "slug" },
    brief: {
      season: "秋", aspect: "9:16", requirements: "", duration_s: 30,
      tone: "", outfit_override: null, banned: [],
    },
    grid_refs: [],
    scenes: [],
    shots: [],
    removed_shots: [],
    music: { file: "", bpm: 0, license: "" },
    render: {
      res: "1080x1920", fps: 30, title: "标题",
      intro: null, outro: null, ai_label: true,
    },
  };
}

let owner: string;
beforeEach(async () => {
  open(":memory:");
  const result = await createUser({ username: "delete-owner", password_hash: "x" });
  if (!result.ok) throw new Error("fixture user creation failed");
  owner = result.user.user_id;
  grantCredits(owner, 100, "grant");
  await insertEpisode({ ...fixture("e_delete", owner), credits_used: 10 });
});
afterEach(close);

test("late writer invalidates a cleanup snapshot before its completion commit", async () => {
  await deleteEpisode("e_delete", owner);
  const snapshot = (await listPendingEpisodeDeletions())[0]!;
  requestEpisodeDeletionCleanup("e_delete");

  expect(await finishEpisodeDeletionCleanup("e_delete", snapshot.cleanup_revision)).toBe(false);
  expect((await listPendingEpisodeDeletions()).length).toBe(1);
});

test("ownership, permanent absence, all reservations refunded once and settled usage retained", async () => {
  reserveCredits({
    action_id: "script-only", user_id: owner, episode_id: "e_delete", kind: "script", units: 1,
  });
  reserveCredits({
    action_id: "spent", user_id: owner, episode_id: "e_delete", kind: "video", units: 1,
  });
  finalizeCredits("spent", "settled");
  const task = await enqueueTask({ episode_id: "e_delete", stage: "video" });
  reserveCredits({
    action_id: task.task_id, user_id: owner, episode_id: "e_delete",
    task_id: task.task_id, kind: "video", units: 1,
  });

  expect(await deleteEpisode("e_delete", "other")).toEqual({ ok: false, error: "not_found" });
  expect(await deleteEpisode("missing", owner)).toEqual({ ok: false, error: "not_found" });
  expect(await deleteEpisode("e_delete", owner)).toEqual({
    ok: true, cleanup_status: "pending", refunded_credits: 11,
  });
  expect(await deleteEpisode("e_delete", owner)).toEqual({
    ok: true, cleanup_status: "pending", refunded_credits: 0,
  });
  expect((await getEpisode("e_delete")).ok).toBe(false);
  expect(getCreditBalance(owner)).toEqual({ available: 90, reserved: 0 });
  expect((await getUsageSummary(owner)).totals.credits_used).toBe(10);
  expect(await dequeueTask()).toBeNull();

  await completeTask(task.task_id);
  await failTask(task.task_id, { requeue: true });
  const row = getDb().query<{ status: string }, [string]>(
    "select status from tasks where task_id = ?",
  ).get(task.task_id);
  expect(row?.status).toBe("cancelled");
  expect(reserveCredits({
    action_id: "late", user_id: owner, episode_id: "e_delete", kind: "script", units: 1,
  }).ok).toBe(false);
  await expect(enqueueTask({ episode_id: "e_delete", stage: "script" })).rejects.toThrow();
});

test("cleanup fences live and reclaimed executions, then scrubs content and stays idempotent", async () => {
  const queued = await enqueueTask({
    episode_id: "e_delete", stage: "script", instruction: "private", payload_json: "{}",
  });
  const first = (await dequeueTask())!;
  getDb().query("update tasks set lease_until = unixepoch('now') - 1 where task_id = ?")
    .run(queued.task_id);
  const second = (await dequeueTask())!;

  await deleteEpisode("e_delete", owner);
  expect(await listPendingEpisodeDeletions()).toEqual([]);
  await acknowledgeDeletedTaskExecution(second.task_id, second.lease_token!);
  expect(await listPendingEpisodeDeletions()).toEqual([]);
  await acknowledgeDeletedTaskExecution(first.task_id, first.lease_token!);
  const pending = await listPendingEpisodeDeletions();
  expect(pending.map(item => item.episode_id)).toEqual(["e_delete"]);
  expect(await finishEpisodeDeletionCleanup("e_delete", pending[0]!.cleanup_revision)).toBe(true);
  expect(getDb().query("select payload_json, instruction from tasks where task_id = ?")
    .get(queued.task_id)).toEqual({ payload_json: null, instruction: null });
  expect(await deleteEpisode("e_delete", owner)).toEqual({
    ok: true, cleanup_status: "done", refunded_credits: 0,
  });
});

test("late worker completion, retry and settlement cannot change cancellation or balance", async () => {
  const queued = await enqueueTask({
    episode_id: "e_delete", stage: "script", operation: "shot_suggest", payload_json: "private",
  });
  reserveCredits({
    action_id: queued.task_id, user_id: owner, episode_id: "e_delete",
    task_id: queued.task_id, kind: "script", units: 1,
  });
  const live = (await dequeueTask())!;
  const before = await getEpisode("e_delete");
  if (!before.ok) throw new Error("fixture episode missing");
  await deleteEpisode("e_delete", owner);

  expect(completeTaskWithEpisode(live, 1, before.episode).ok).toBe(false);
  expect(completeStoryboardSuggestion(live, { beat: "late" })).toBe(false);
  expect(failTaskWithCredits(live, true, "late")).toBe(false);
  expect(requeueTaskAfterCommitConflict(live)).toBe(false);
  expect(finalizeCredits(queued.task_id, "settled").ok).toBe(false);
  expect(submitFailedTaskRetry({ episode_id: "e_delete", owner_id: owner, row_version: 1 }).ok)
    .toBe(false);
  expect(getCreditBalance(owner)).toEqual({ available: 100, reserved: 0 });
});

test("lease expiration allows restart cleanup and retries persist a bounded backoff", async () => {
  await enqueueTask({ episode_id: "e_delete", stage: "compose" });
  await dequeueTask();
  await deleteEpisode("e_delete", owner);
  expect(await finishEpisodeDeletionCleanup("e_delete", 0)).toBe(false);

  getDb().exec("update task_executions set lease_until = unixepoch('now') - 1");
  expect((await listPendingEpisodeDeletions()).length).toBe(1);
  await failEpisodeDeletionCleanup("e_delete");
  expect(await listPendingEpisodeDeletions()).toEqual([]);
  getDb().exec("update episode_deletions set cleanup_retry_at = 0");
  const pending = await listPendingEpisodeDeletions();
  expect(pending).toEqual([{ episode_id: "e_delete", cleanup_attempts: 1, cleanup_revision: 0 }]);
  expect(await finishEpisodeDeletionCleanup("e_delete", pending[0]!.cleanup_revision)).toBe(true);
});

test("schema migration backfills live legacy executions and deletion survives reopening", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kelvoy-deletion-migration-"));
  const path = join(directory, "store.db");
  try {
    close();
    open(path);
    await insertEpisode(fixture("legacy", owner));
    getDb().query(`insert into tasks (task_id, episode_id, stage, status, lease_token, lease_until)
      values ('legacy-task', 'legacy', 'script', 'processing', 'legacy-token', unixepoch('now') + 90)`)
      .run();
    close();
    open(path);
    expect(getDb().query(
      "select migration_id from schema_migrations where migration_id = 'episode_deletions_v1'",
    ).get()).toBeTruthy();

    await deleteEpisode("legacy", owner);
    close();
    open(path);
    expect(await listPendingEpisodeDeletions()).toEqual([]);
    await acknowledgeDeletedTaskExecution("legacy-task", "legacy-token");
    const pending = await listPendingEpisodeDeletions();
    expect(pending.map(item => item.episode_id)).toEqual(["legacy"]);
    expect(await finishEpisodeDeletionCleanup("legacy", pending[0]!.cleanup_revision)).toBe(true);
    expect((await getUsageSummary(owner)).totals.episodes).toBe(1);
    await expect(insertEpisode(fixture("legacy", owner))).rejects.toThrow("episode deleted");
  } finally {
    close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test.each(["draft", "failed", "done", "scripting", "clipping", "composing"] as const)(
  "deleting a %s episode cancels held, pending and processing tasks while preserving shared catalogs",
  async (status) => {
    await insertPersona({
      persona_id: "p", owner_id: null, version: 1, name: "共享角色", desc: "",
      locked: [], default_outfit: "", refs: [], style: { lut: "", title_style: "" },
    });
    await upsertDestination({
      destination_id: "d", version: 1, name: "共享景区", city: "无锡", type: "scenic_area",
      season_best: ["秋"], landmarks: [], route: [], food: [], transport: "", stay: "",
    });
    await upsertTemplate({
      template_id: "t", owner_id: null, name: "共享模板", skeleton: "scenic_area",
      lut: "", intro: null, outro: null, title_style: "",
    });
    await insertEpisode({ ...fixture("e_status", owner), status });
    const before = {
      persona: await getPersona("p"), destination: await getDestination("d"),
      template: await getTemplate("t"),
    };
    for (const taskStatus of ["held", "pending", "processing"]) {
      const taskId = `task_${taskStatus}`;
      getDb().query(`insert into tasks (task_id, episode_id, stage, status, lease_token, lease_until)
        values (?, 'e_status', 'video', ?, ?, unixepoch('now') + 90)`)
        .run(taskId, taskStatus, taskStatus === "processing" ? "live-token" : null);
      reserveCredits({
        action_id: taskId, user_id: owner, episode_id: "e_status",
        task_id: taskId, kind: "video", units: 1,
      });
    }

    expect(await deleteEpisode("e_status", owner)).toEqual({
      ok: true, cleanup_status: "pending", refunded_credits: 30,
    });
    expect((await getEpisode("e_status")).ok).toBe(false);
    expect(getCreditBalance(owner)).toEqual({ available: 100, reserved: 0 });
    expect(getDb().query<{ status: string; lease_token: string | null }, []>(
      "select status, lease_token from tasks where episode_id = 'e_status' order by task_id",
    ).all()).toEqual(Array.from({ length: 3 }, () => ({ status: "cancelled", lease_token: null })));
    expect({
      persona: await getPersona("p"), destination: await getDestination("d"),
      template: await getTemplate("t"),
    }).toEqual(before);
  },
);
