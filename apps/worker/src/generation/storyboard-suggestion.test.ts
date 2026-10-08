import { afterEach, beforeEach, expect, test } from "bun:test";
import { open, close, getDb, grantCredits, getCreditBalance, submitStoryboardSuggestion,
  dequeueTask, getEpisode, getStoryboardSuggestion } from "@kelvoy/store";
import { handleTask } from "../queue/consumer";
let originalFetch: typeof fetch;
let originalKey: string | undefined;
beforeEach(() => {
  open(":memory:");
  originalFetch = globalThis.fetch;
  originalKey = process.env.STEPFUN_API_KEY;
  process.env.STEPFUN_API_KEY = "private-test-key";
  getDb().query("insert into users (user_id, username, password_hash) values ('u', 'suggest', 'hash')").run();
  grantCredits("u", 3, "suggest-grant");
  getDb().query("insert into episodes (episode_id,owner_id,doc) values ('e','u',?)").run(JSON.stringify({
    episode_id: "e", owner_id: "u", mode: "per_shot", status: "done", name: "测试", credits_used: 0,
    persona_id: "p", persona_version: 1, destination_id: "d", destination_version: 1,
    shots: [{ shot_id: "sh1", no: 1, beat: "原稿", status: "approved" }], removed_shots: [],
    scenes: [{ id: "sc1" }], brief: {}, render: {},
  }));
  getDb().query("insert into destination_versions (destination_id,version,doc) values ('d',1,?)")
    .run(JSON.stringify({ destination_id: "d", landmarks: [] }));
  getDb().query("insert into persona_versions (persona_id,version,doc) values ('p',1,?)")
    .run(JSON.stringify({ persona_id: "p", name: "冻结角色" }));
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.STEPFUN_API_KEY; else process.env.STEPFUN_API_KEY = originalKey;
  close();
});
function queue() {
  const queued = submitStoryboardSuggestion({ episode_id: "e", owner_id: "u", row_version: 1,
    request: { description: "沿石板路步行", after_shot_id: "sh1", fields: { beat: "步行" } } });
  if (!queued.ok) throw new Error(queued.error);
  return queued.task_id;
}
test("consumer dispatches one-shot HTTP suggestion without modifying formal storyboard", async () => {
  const id = queue();
  globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: JSON.stringify({
    scene: "sc1", size: "wide", camera: "static", landmark: null, caption: "晨光", kf_prompt: "晨光石板路", motion_prompt: "步行",
  }) } }] })) as unknown as typeof fetch;
  await handleTask((await dequeueTask())!);
  const result = getStoryboardSuggestion("e", "u", id);
  expect(result?.status).toBe("done");
  expect(result?.suggestion?.beat).toBeUndefined();
  expect(getCreditBalance("u")).toEqual({ available: 2, reserved: 0 });
  const episode = await getEpisode("e");
  if (!episode.ok) throw new Error("missing episode");
  expect(episode.episode.status).toBe("done");
  expect(episode.episode.shots[0]?.beat).toBe("原稿");
});
test("HTTP failure retries then refunds and only exposes safe readable error", async () => {
  const id = queue();
  globalThis.fetch = (async () => new Response("Bearer private-test-key", { status: 500 })) as unknown as typeof fetch;
  await handleTask((await dequeueTask())!);
  expect(getStoryboardSuggestion("e", "u", id)?.status).toBe("pending");
  await handleTask((await dequeueTask())!);
  const result = getStoryboardSuggestion("e", "u", id);
  expect(result?.status).toBe("failed");
  expect(result?.error).not.toContain("private-test-key");
  expect(result?.error).toContain("积分已退回");
  expect(getCreditBalance("u")).toEqual({ available: 3, reserved: 0 });
});
test("expired worker cannot publish suggestion or settle a reservation", async () => {
  const id = queue();
  globalThis.fetch = (async () => {
    getDb().query("update tasks set lease_until = unixepoch('now') - 1 where task_id = ?").run(id);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ scene: "sc1", size: "wide", camera: "static", landmark: null, caption: "晨光", kf_prompt: "晨光石板路", motion_prompt: "步行" }) } }] });
  }) as unknown as typeof fetch;
  await handleTask((await dequeueTask())!);
  expect(getStoryboardSuggestion("e", "u", id)).toEqual({ ok: true, status: "processing" });
  expect(getCreditBalance("u")).toEqual({ available: 2, reserved: 1 });
  const reclaimed = await dequeueTask();
  expect(reclaimed?.task_id).toBe(id);
  expect(reclaimed?.attempt).toBe(2);
});
