import { afterEach, beforeEach, expect, test } from "bun:test";
import { close, getDb, open } from "./db";
import { dequeueTask } from "./tasks";
import { grantCredits, getCreditBalance } from "./credits";
import { failTaskWithCredits } from "./charged-tasks";
import { completeStoryboardSuggestion, getStoryboardSuggestion, submitStoryboardSuggestion } from "./storyboard-suggestions";

beforeEach(() => {
  open(":memory:");
  getDb().query("insert into users (user_id, username, password_hash) values ('u_1', 'tester', 'hash')").run();
  grantCredits("u_1", 3, "grant-suggestions");
  const doc = { episode_id: "e_1", owner_id: "u_1", name: "测试", status: "done", mode: "per_shot",
    destination_id: "d_1", destination_version: 1, credits_used: 0, render: {}, brief: {}, removed_shots: [],
    shots: [{ shot_id: "sh_1", no: 1, beat: "原稿", status: "approved" }], scenes: [{ id: "sc_1" }] };
  getDb().query("insert into episodes (episode_id, owner_id, doc) values ('e_1', 'u_1', ?)").run(JSON.stringify(doc));
  getDb().query("insert into destination_versions (destination_id, version, doc) values ('d_1', 1, ?)")
    .run(JSON.stringify({ landmarks: [{ id: "lm_1" }] }));
});
afterEach(() => close());
const request = { description: "漫步石板路", after_shot_id: "sh_1", fields: {} };
const submit = (row_version = 1, owner_id = "u_1") => submitStoryboardSuggestion({ episode_id: "e_1", owner_id, row_version, request });

test("owner, stale version and active task checks precede reservation", () => {
  expect(submit(1, "other")).toMatchObject({ ok: false, error: "not_found" });
  expect(submit(2)).toMatchObject({ ok: false, error: "version_conflict" });
  expect(getCreditBalance("u_1")).toEqual({ available: 3, reserved: 0 });
  expect(submit().ok).toBe(true);
  expect(submit(2)).toMatchObject({ ok: false, error: "action_pending" });
  expect(getCreditBalance("u_1")).toEqual({ available: 2, reserved: 1 });
});
test("lease-fenced completion settles once, preserves formal storyboard and isolates polling", async () => {
  const result = submit();
  if (!result.ok) throw new Error("queue failed");
  const task = (await dequeueTask())!;
  expect(task.operation).toBe("shot_suggest");
  expect(JSON.parse(task.payload_json!)).toEqual(request);
  expect(completeStoryboardSuggestion({ ...task, lease_token: "stale" }, { beat: "建议" })).toBe(false);
  expect(completeStoryboardSuggestion(task, { beat: "建议" })).toBe(true);
  expect(completeStoryboardSuggestion(task, { beat: "覆盖" })).toBe(false);
  expect(getCreditBalance("u_1")).toEqual({ available: 2, reserved: 0 });
  const episode = JSON.parse(getDb().query<{ doc: string }, []>("select doc from episodes").get()!.doc);
  expect(episode.status).toBe("done");
  expect(episode.shots[0].beat).toBe("原稿");
  expect(episode.credits_used).toBe(1);
  expect(getStoryboardSuggestion("e_1", "other", result.task_id)).toBeNull();
  expect(getStoryboardSuggestion("e_1", "u_1", result.task_id)).toMatchObject({ status: "done", suggestion: { beat: "建议" } });
});
test("terminal failure refunds reservation without changing current episode status", async () => {
  const result = submit();
  if (!result.ok) throw new Error("queue failed");
  const task = (await dequeueTask())!;
  expect(failTaskWithCredits(task, false, "镜头建议失败")).toBe(true);
  expect(getCreditBalance("u_1")).toEqual({ available: 3, reserved: 0 });
  expect(JSON.parse(getDb().query<{ doc: string }, []>("select doc from episodes").get()!.doc).status).toBe("done");
  expect(getStoryboardSuggestion("e_1", "u_1", result.task_id)).toMatchObject({ status: "failed" });
});
