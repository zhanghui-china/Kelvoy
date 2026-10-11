import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Episode, Task } from "@kelvoy/engine";
import { completeTaskWithEpisode, completeTaskWithoutEpisode, failTaskWithCredits } from "./charged-tasks";
import { close, getDb, open } from "./db";
import { deleteEpisode } from "./episode-deletion";
import { insertEpisode } from "./episodes";
import { insertPromptTraces, listPromptTraces, type PromptTraceInput } from "./prompt-traces";
import { SCHEMA } from "./schema";
import { dequeueTask, enqueueTask } from "./tasks";
import { createUser } from "./users";

let ownerId = "";
beforeEach(async () => {
  open(":memory:");
  const user = await createUser({ username: "trace-owner", password_hash: "hash" });
  if (!user.ok) throw new Error("fixture user failed");
  ownerId = user.user.user_id;
});
afterEach(() => close());

function episode(id = "e_trace"): Episode {
  return {
    episode_id: id, owner_id: ownerId, name: "测试", status: "draft",
    persona_id: "p", persona_version: 1, destination_id: "d", destination_version: 1,
    series_id: "s", template_id: "t", mode: "per_shot", candidate_count: 2,
    created_at: "2026-10-11T00:00:00Z", estimated_credits: 0, credits_used: 0,
    share: { enabled: false, slug: "" },
    brief: { season: "秋", aspect: "9:16", requirements: "", duration_s: 30,
      tone: "", outfit_override: null, banned: [] },
    grid_refs: [], scenes: [], shots: [], removed_shots: [],
    music: { file: "", bpm: 0, license: "" },
    render: { res: "1080x1920", fps: 30, title: "", intro: null, outro: null, ai_label: true },
  };
}

const trace = (over: Partial<PromptTraceInput> = {}): PromptTraceInput => ({
  kind: "script_generate", source: "llm", outcome: "ok", user_message: "hello", ...over,
});

async function claimBrief(id = "e_trace"): Promise<Task> {
  await enqueueTask({ episode_id: id, stage: "brief" });
  const task = await dequeueTask();
  if (!task) throw new Error("no task");
  return task;
}

const rows = () => getDb().query<Record<string, unknown>, []>(
  "select * from prompt_traces order by rowid").all();

test("legacy database without prompt_traces upgrades additively and idempotently", () => {
  const dir = mkdtempSync(join(tmpdir(), "kelvoy-trace-"));
  const path = join(dir, "legacy.db");
  try {
    // The old schema is everything before the prompt_traces block (appended at the SCHEMA tail).
    const legacy = SCHEMA.split("create table if not exists prompt_traces")[0]!;
    const raw = new Database(path, { create: true });
    raw.exec(legacy);
    raw.exec(`insert into episodes (episode_id, owner_id, row_version, doc) values ('e_old', 'u', 1, '{}')`);
    raw.exec(`insert into tasks (task_id, episode_id, stage, attempt, status) values ('tk_old', 'e_old', 'brief', 1, 'pending')`);
    const before = raw.query<{ name: string }, []>("select name from sqlite_master where name not like 'sqlite_%'").all()
      .map((r) => r.name);
    expect(before).not.toContain("prompt_traces");
    raw.close();

    for (let i = 0; i < 3; i++) {
      const db = open(path);
      const names = db.query<{ name: string }, []>("select name from sqlite_master").all().map((r) => r.name);
      expect(names).toContain("prompt_traces");
      expect(names).toContain("idx_prompt_traces_episode");
      for (const name of before) expect(names).toContain(name);
      expect(db.query("select count(*) as n from episodes").get()).toEqual({ n: 1 });
      expect(db.query("select count(*) as n from tasks").get()).toEqual({ n: 1 });
      expect(db.query("select count(*) as n from schema_migrations where migration_id = 'prompt_traces_v1'").get())
        .toEqual({ n: 1 });
      close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("traces keep order; same key is idempotent; new attempt and new task keep history", async () => {
  await insertEpisode(episode());
  const first = await claimBrief();
  expect(failTaskWithCredits(first, true, undefined, undefined,
    [trace({ outcome: "prompt_format_invalid", rule: "r1" }), trace({ round: 1 })])).toBe(true);
  expect(rows().map((r) => [r.attempt, r.seq])).toEqual([[1, 0], [1, 1]]);

  // Same (task_id, attempt, seq) again: ignored.
  getDb().transaction(() => insertPromptTraces(getDb(), first, [trace({ user_message: "dup" })])).immediate();
  expect(rows()).toHaveLength(2);
  expect(rows()[0]!.user_message).toBe("hello");

  const second = await dequeueTask();
  expect(second?.attempt).toBe(2);
  expect(completeTaskWithEpisode(second!, 1, { ...episode(), status: "scripting" }, undefined,
    [trace({ round: 2 })]).ok).toBe(true);
  expect(rows().map((r) => [r.task_id, r.attempt, r.seq])).toEqual([
    [first.task_id, 1, 0], [first.task_id, 1, 1], [first.task_id, 2, 0]]);
  expect(rows()[0]).toMatchObject({ episode_id: "e_trace", owner_id: ownerId, truncated: 0, source: "llm" });

  // A user retry is a new task_id: new version, old one kept.
  await enqueueTask({ episode_id: "e_trace", stage: "script" });
  const retry = await dequeueTask();
  failTaskWithCredits(retry!, false, "x", undefined, [trace({ user_message: "retry" })]);
  expect(rows()).toHaveLength(4);
});

test("lost leases write nothing on either commit path", async () => {
  await insertEpisode(episode());
  const t = await claimBrief();
  const done = { ...episode(), status: "scripting" as const };
  const t1 = [trace()];

  const wrong = { ...t, lease_token: "other" };
  expect(completeTaskWithEpisode(wrong, 1, done, undefined, t1)).toEqual({ ok: false, error: "lease_lost" });
  expect(failTaskWithCredits(wrong, true, undefined, undefined, t1)).toBe(false);

  getDb().query("update tasks set lease_until = 1 where task_id = ?").run(t.task_id);
  expect(completeTaskWithEpisode(t, 1, done, undefined, t1)).toEqual({ ok: false, error: "lease_lost" });
  expect(failTaskWithCredits(t, false, undefined, undefined, t1)).toBe(false);

  getDb().query("update tasks set lease_until = unixepoch('now') + 60, status = 'cancelled' where task_id = ?")
    .run(t.task_id);
  expect(completeTaskWithEpisode(t, 1, done, undefined, t1)).toEqual({ ok: false, error: "lease_lost" });
  expect(failTaskWithCredits(t, false, undefined, undefined, t1)).toBe(false);
  expect(rows()).toHaveLength(0);
});

test("version_conflict, illegal_transition and not_found write nothing", async () => {
  await insertEpisode(episode());
  const t = await claimBrief();
  expect(completeTaskWithEpisode(t, 99, { ...episode(), status: "scripting" }, undefined, [trace()]))
    .toEqual({ ok: false, error: "version_conflict" });
  expect(completeTaskWithEpisode(t, 1, { ...episode(), status: "done" }, undefined, [trace()]))
    .toEqual({ ok: false, error: "illegal_transition" });
  expect(rows()).toHaveLength(0);

  getDb().query("delete from episodes where episode_id = 'e_trace'").run();
  expect(completeTaskWithEpisode(t, 1, { ...episode(), status: "scripting" }, undefined, [trace()]))
    .toEqual({ ok: false, error: "not_found" });
  expect(rows()).toHaveLength(0);
});

test("requeue and terminal failure both write; completeTaskWithoutEpisode does not", async () => {
  await insertEpisode(episode());
  const a = await claimBrief();
  expect(failTaskWithCredits(a, true, undefined, undefined, [trace()])).toBe(true);
  expect(rows()).toHaveLength(1);
  const b = (await dequeueTask())!;
  expect(failTaskWithCredits(b, false, "boom", undefined, [trace({ outcome: "failed" })])).toBe(true);
  expect(rows().map((r) => r.attempt)).toEqual([1, 2]);

  await enqueueTask({ episode_id: "e_trace", stage: "script" });
  const c = (await dequeueTask())!;
  completeTaskWithoutEpisode(c);
  expect(rows()).toHaveLength(2);
});

test("owner and episode come from episodes, never the caller; missing episode is a silent no-op", async () => {
  await insertEpisode(episode());
  const t = await claimBrief();
  const forged = { ...trace(), owner_id: "evil", episode_id: "other", task_id: "x", attempt: 9, seq: 9 };
  expect(failTaskWithCredits(t, true, undefined, undefined, [forged as PromptTraceInput])).toBe(true);
  expect(rows()[0]).toMatchObject({ owner_id: ownerId, episode_id: "e_trace", task_id: t.task_id, attempt: 1, seq: 0 });

  const ghost = { ...t, task_id: "tk_ghost", episode_id: "e_missing" } as Task;
  expect(() => getDb().transaction(() => insertPromptTraces(getDb(), ghost, [trace()])).immediate()).not.toThrow();
  expect(rows()).toHaveLength(1);
});

test("deleteEpisode purges traces and a late commit cannot re-create them", async () => {
  await insertEpisode(episode());
  const t = await claimBrief();
  failTaskWithCredits(t, true, undefined, undefined, [trace()]);
  const late = (await dequeueTask())!;
  expect(rows()).toHaveLength(1);
  expect(await deleteEpisode("e_trace", ownerId)).toMatchObject({ ok: true });
  expect(rows()).toHaveLength(0);
  completeTaskWithEpisode(late, 1, { ...episode(), status: "scripting" }, undefined, [trace()]);
  failTaskWithCredits(late, false, undefined, undefined, [trace()]);
  expect(rows()).toHaveLength(0);
  expect((await listPromptTraces({ episodeId: "e_trace", ownerId: "other", kind: "script", limit: 10 })).items)
    .toEqual([]);
});

test("text is cut at 64KB of UTF-8 without splitting a character; at most 16 rows are kept", async () => {
  await insertEpisode(episode());
  const t = await claimBrief();
  // "中" is 3 bytes; 65536 is not a multiple of 3, so a naive byte cut would split a character.
  const big = "中".repeat(30000);
  const many = Array.from({ length: 20 }, (_, i) => trace({ user_message: i === 0 ? big : `m${i}`,
    final_prompt: i === 0 ? "e".repeat(70000) : undefined }));
  expect(completeTaskWithEpisode(t, 1, { ...episode(), status: "scripting" }, undefined, many).ok).toBe(true);
  const stored = rows();
  expect(stored).toHaveLength(16);
  const first = stored[0]!;
  const msg = first.user_message as string;
  expect(first.truncated).toBe(1);
  expect(Buffer.byteLength(msg)).toBeLessThanOrEqual(65536);
  expect(Buffer.byteLength(msg)).toBeGreaterThan(65536 - 3);
  expect(msg).not.toContain("�");
  expect(msg).toBe("中".repeat(msg.length));
  expect(Buffer.byteLength(first.final_prompt as string)).toBe(65536);
  expect(stored[1]!.truncated).toBe(0);
  const settled = getDb().query<{ status: string }, [string]>("select status from tasks where task_id = ?").get(t.task_id);
  expect(settled?.status).toBe("done");
});

test("listPromptTraces maps kinds, filters shot, pages newest first and isolates owners", async () => {
  await insertEpisode(episode());
  await insertEpisode(episode("e_other"));
  const t = await claimBrief();
  const batch: PromptTraceInput[] = [
    trace({ kind: "script_generate", user_message: "g" }),
    trace({ kind: "script_revision", user_message: "r" }),
    trace({ kind: "h3_rewrite", shot_id: "sh_1", user_message: "h1" }),
    trace({ kind: "h3_rewrite", shot_id: "sh_2", source: "cache", user_message: "h2", input_hash: "a".repeat(64) }),
    trace({ kind: "h3_rewrite", shot_id: "sh_1", user_message: "h3" }),
  ];
  failTaskWithCredits(t, true, undefined, undefined, batch);
  const q = { episodeId: "e_trace", ownerId };

  const script = await listPromptTraces({ ...q, kind: "script", limit: 10 });
  expect(script.items.map((r) => r.user_message)).toEqual(["r", "g"]);
  expect(script.next_before).toBeNull();
  const video = await listPromptTraces({ ...q, kind: "video", limit: 10 });
  expect(video.items.map((r) => r.user_message)).toEqual(["h3", "h2", "h1"]);
  expect(video.items[1]!.input_hash).toBe("a".repeat(64));
  const shot = await listPromptTraces({ ...q, kind: "video", shotId: "sh_1", limit: 10 });
  expect(shot.items.map((r) => r.user_message)).toEqual(["h3", "h1"]);

  const page1 = await listPromptTraces({ ...q, kind: "video", limit: 2 });
  expect(page1.items.map((r) => r.user_message)).toEqual(["h3", "h2"]);
  expect(page1.next_before).not.toBeNull();
  const page2 = await listPromptTraces({ ...q, kind: "video", limit: 2, before: page1.next_before! });
  expect(page2.items.map((r) => r.user_message)).toEqual(["h1"]);
  expect(page2.next_before).toBeNull();

  expect((await listPromptTraces({ ...q, kind: "video", limit: 0 })).items).toHaveLength(1);
  expect((await listPromptTraces({ ...q, kind: "video", limit: 9999 })).items).toHaveLength(3);
  expect((await listPromptTraces({ episodeId: "e_trace", ownerId: "someone-else", kind: "video", limit: 10 })).items)
    .toEqual([]);
  expect((await listPromptTraces({ episodeId: "e_other", ownerId, kind: "video", limit: 10 })).items).toEqual([]);
});

test("a failing trace insert rolls the whole settlement back instead of being swallowed", async () => {
  await insertEpisode(episode());
  const t = await claimBrief();
  getDb().exec(`create trigger boom before insert on prompt_traces begin select raise(abort, 'trace boom'); end`);
  expect(() => completeTaskWithEpisode(t, 1, { ...episode(), status: "scripting" }, undefined, [trace()]))
    .toThrow("trace boom");
  const task = getDb().query<{ status: string }, [string]>("select status from tasks where task_id = ?").get(t.task_id);
  expect(task?.status).toBe("processing");
  const ep = getDb().query<{ row_version: number }, []>("select row_version from episodes").get();
  expect(ep?.row_version).toBe(1);
  expect(() => failTaskWithCredits(t, true, undefined, undefined, [trace()])).toThrow("trace boom");
  expect(getDb().query<{ status: string }, [string]>("select status from tasks where task_id = ?")
    .get(t.task_id)?.status).toBe("processing");
});
