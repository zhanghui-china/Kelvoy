import { afterEach, beforeEach, expect, test } from "bun:test";
import { close, getDb, open } from "./db";
import { dequeueTask } from "./tasks";
import { submitScriptAction } from "./script-actions";
import { grantCredits, getCreditBalance } from "./credits";

beforeEach(() => {
  open(":memory:");
  getDb().query("insert into users (user_id, username, password_hash) values ('u_1', 'tester', 'hash')").run();
  grantCredits("u_1", 3, "grant-script-tests");
  getDb().query("insert into episodes (episode_id, owner_id, doc) values (?, ?, ?)")
    .run("e_1", "u_1", JSON.stringify({ episode_id: "e_1", owner_id: "u_1", status: "script_review", shots: [{ beat: "原稿" }] }));
});
afterEach(() => close());

test("script action atomically marks the draft and queues exactly one operation", async () => {
  const result = submitScriptAction({ episode_id: "e_1", owner_id: "u_1", row_version: 1,
    operation: "script_optimize", instruction: "突出夜景" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const row = getDb().query<{ doc: string; row_version: number }, []>("select doc, row_version from episodes where episode_id = 'e_1'").get();
  expect(row?.row_version).toBe(2);
  expect(JSON.parse(row!.doc).script_pending_task_id).toBe(result.task.task_id);
  expect((await dequeueTask())?.instruction).toBe("突出夜景");
  expect(await dequeueTask()).toBeNull();
  expect(getCreditBalance("u_1")).toEqual({ available: 2, reserved: 1 });
});

test("script action blocks stale versions, another owner and duplicate pending requests", () => {
  expect(submitScriptAction({ episode_id: "e_1", owner_id: "u_2", row_version: 1,
    operation: "script_regenerate" })).toEqual({ ok: false, error: "not_found" });
  expect(submitScriptAction({ episode_id: "e_1", owner_id: "u_1", row_version: 1,
    operation: "script_regenerate" }).ok).toBe(true);
  expect(submitScriptAction({ episode_id: "e_1", owner_id: "u_1", row_version: 1,
    operation: "script_regenerate" })).toMatchObject({ ok: false, error: "version_conflict" });
  expect(submitScriptAction({ episode_id: "e_1", owner_id: "u_1", row_version: 2,
    operation: "script_regenerate" })).toEqual({ ok: false, error: "action_pending" });
});
