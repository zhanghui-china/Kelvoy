import { expect, test } from "bun:test";
import type { Task } from "@kelvoy/engine";
import { deleteEpisode, getDb, insertEpisode, insertPromptTraces, type PromptTraceInput } from "@kelvoy/store";
import { buildApp, fixture, login, setupEpisodeRouteTests, shotFixture } from "./episode-test-fixtures";

setupEpisodeRouteTests();

const FULL_HASH = "0123456789abcdef".repeat(4);
const KEY_A = "persona/SENTINEL_REF_KEY_A.png";
const KEY_B = "kf/SENTINEL_REF_KEY_B.png";

function put(episodeId: string, taskId: string, traces: PromptTraceInput[], attempt = 1): void {
  insertPromptTraces(getDb(), { task_id: taskId, attempt, episode_id: episodeId } as Task, traces);
}

const script = (over: Partial<PromptTraceInput> = {}): PromptTraceInput => ({
  kind: "script_generate", source: "llm", outcome: "accepted", user_message: "写一个脚本", ...over,
});

const video = (over: Partial<PromptTraceInput> = {}): PromptTraceInput => ({
  kind: "h3_rewrite", source: "llm", outcome: "ok", shot_id: "sh_1", model: "step-x",
  skill_version: "skillhash", writer_version: "w1", h3_mode: "I2VA", input_hash: FULL_HASH,
  final_prompt: "A man walks.",
  user_message: JSON.stringify({
    mode: "Ref2VA", beat: "走路",
    references: [{ key: KEY_A, role: "person", picture: 1 }, { key: KEY_B, role: "scene", picture: 2 }],
  }),
  ...over,
});

async function setup() {
  const owner = await login("prompt-owner");
  const stranger = await login("prompt-stranger");
  const episode = { ...fixture("e_p1", owner.ownerId), shots: [shotFixture(1, { shot_id: "sh_1" }), shotFixture(2, { shot_id: "sh_2" })] };
  await insertEpisode(episode);
  const app = buildApp();
  const get = (cookie: string | null, query: string, id = "e_p1") =>
    app.request(`/api/episodes/${id}/prompts${query}`, { headers: cookie ? { cookie } : {} });
  return { owner, stranger, app, get, episode };
}

test("anonymous request gets 401", async () => {
  const { get } = await setup();
  expect((await get(null, "?kind=script")).status).toBe(401);
});

test("stranger, missing and deleted episodes get an identical 404", async () => {
  const { owner, stranger, get } = await setup();
  await insertEpisode(fixture("e_gone", owner.ownerId));
  await deleteEpisode("e_gone", owner.ownerId);
  const responses = [
    await get(stranger.cookie, "?kind=script"),
    await get(owner.cookie, "?kind=script", "e_nope"),
    await get(owner.cookie, "?kind=script", "e_gone"),
  ];
  const bodies = await Promise.all(responses.map((r) => r.text()));
  for (const r of responses) expect(r.status).toBe(404);
  expect(new Set(bodies).size).toBe(1);
  expect(JSON.parse(bodies[0]!)).toEqual({ ok: false, error: "not_found" });
  // Same body as GET /:id for a missing episode.
  const detail = await buildApp().request("/api/episodes/e_nope", { headers: { cookie: owner.cookie } });
  expect(await detail.text()).toBe(bodies[0]!);
});

test("query validation", async () => {
  const { owner, get } = await setup();
  const bad: [string, string][] = [
    ["", "invalid_kind"],
    ["?kind=other", "invalid_kind"],
    ["?kind=script&shot_id=sh_1", "invalid_shot_id"],
    ["?kind=video&shot_id=a%2Fb", "invalid_shot_id"],
    ["?kind=video&shot_id=", "invalid_shot_id"],
    [`?kind=video&shot_id=${"a".repeat(129)}`, "invalid_shot_id"],
    ["?kind=script&limit=abc", "invalid_limit"],
    ["?kind=script&limit=0", "invalid_limit"],
    ["?kind=script&limit=-3", "invalid_limit"],
    ["?kind=script&limit=1.5", "invalid_limit"],
    ["?kind=script&before=0", "invalid_before"],
    ["?kind=script&before=-1", "invalid_before"],
    ["?kind=script&before=abc", "invalid_before"],
    ["?kind=script&before=1.5", "invalid_before"],
  ];
  for (const [query, error] of bad) {
    const res = await get(owner.cookie, query);
    expect([query, res.status]).toEqual([query, 400]);
    expect(await res.json()).toEqual({ ok: false, error });
  }
  expect((await get(owner.cookie, "?kind=video&shot_id=sh_1&limit=500")).status).toBe(200);
  expect((await get(owner.cookie, "?kind=script&limit=99999999999999999999")).status).toBe(200);
});

test("limit is clamped to 50", async () => {
  const { owner, get } = await setup();
  for (let i = 0; i < 60; i++) put("e_p1", `t${i}`, [script({ user_message: `m${i}` })]);
  const body = await (await get(owner.cookie, "?kind=script&limit=500")).json();
  expect(body.items).toHaveLength(50);
  expect(body.next_before).not.toBeNull();
  expect((await (await get(owner.cookie, "?kind=script")).json()).items).toHaveLength(20);
});

test("script traces: newest first, validated by outcome, paginated without gaps", async () => {
  const { owner, get } = await setup();
  put("e_p1", "t1", [
    script({ round: 0, outcome: "rule_violation", user_message: "r0" }),
    script({ round: 1, outcome: "accepted", user_message: "r1" }),
  ]);
  put("e_p1", "t2", [script({ kind: "script_revision", outcome: "parse_error", user_message: "rev" })]);
  put("e_p1", "t3", [video()]);

  const all = await (await get(owner.cookie, "?kind=script")).json();
  expect(all.ok).toBe(true);
  expect(all.items.map((i: { user_message: string }) => i.user_message)).toEqual(["rev", "r1", "r0"]);
  expect(all.items.map((i: { validated: boolean }) => i.validated)).toEqual([false, true, false]);
  expect(all.items[0].kind).toBe("script_revision");
  expect(all.items[1].round).toBe(1);
  expect(all.next_before).toBeNull();
  expect(all.legacy).toBeNull();

  const seen: string[] = [];
  let before = "";
  for (let guard = 0; guard < 5; guard++) {
    const page = await (await get(owner.cookie, `?kind=script&limit=2${before}`)).json();
    seen.push(...page.items.map((i: { id: string }) => i.id));
    if (page.next_before === null) break;
    expect(typeof page.next_before).toBe("string");
    before = `&before=${page.next_before}`;
  }
  expect(seen).toEqual(all.items.map((i: { id: string }) => i.id));
  expect(new Set(seen).size).toBe(3);
});

test("video traces are redacted and never expose internals", async () => {
  const { owner, get } = await setup();
  put("e_p1", "task_SENTINEL", [video(), video({ source: "cache" })]);
  const res = await get(owner.cookie, "?kind=video");
  expect(res.headers.get("cache-control")).toBe("no-store");
  const text = await res.text();
  for (const secret of [KEY_A, KEY_B, "SENTINEL_REF_KEY", FULL_HASH, "task_SENTINEL", owner.ownerId,
    '"task_id"', '"owner_id"', '"episode_id"', '"seq"', "e_p1"]) {
    expect(text).not.toContain(secret);
  }
  const body = JSON.parse(text);
  expect(body.items).toHaveLength(2);
  const item = body.items[0];
  expect(item.input_hash).toBe(FULL_HASH.slice(0, 12));
  expect(item.validated).toBe(true);
  expect(item.source).toBe("cache");
  expect(item.h3_mode).toBe("I2VA");
  expect(item.final_prompt).toBe("A man walks.");
  expect(item.truncated).toBe(false);
  expect(typeof item.id).toBe("string");
  expect(JSON.parse(item.user_message)).toEqual({
    mode: "Ref2VA", beat: "走路",
    references: [
      { key: "[reference: role=person, picture=1]", role: "person", picture: 1 },
      { key: "[reference: role=scene, picture=2]", role: "scene", picture: 2 },
    ],
  });
});

test("failed video attempts are marked not validated and carry the rule", async () => {
  const { owner, get } = await setup();
  put("e_p1", "t1", [video({ outcome: "prompt_format_invalid", rule: "missing_section", final_prompt: undefined })]);
  const item = (await (await get(owner.cookie, "?kind=video")).json()).items[0];
  expect(item.validated).toBe(false);
  expect(item.outcome).toBe("prompt_format_invalid");
  expect(item.rule).toBe("missing_section");
  expect(item.final_prompt).toBeNull();
});

test("rejected model output is shown to the owner, redacted, and null when there is none", async () => {
  const { owner, get } = await setup();
  const leaked = `The scene is ${KEY_B} hashed ${FULL_HASH} and 中文 text`;
  put("e_p1", "t1", [
    video({ outcome: "prompt_format_invalid", rule: "rewrite must be English", final_prompt: undefined,
      rejected_output: leaked }),
    video({ outcome: "ok" }),
  ]);
  const res = await get(owner.cookie, "?kind=video");
  const text = await res.text();
  for (const secret of [KEY_A, KEY_B, "SENTINEL_REF_KEY", FULL_HASH]) expect(text).not.toContain(secret);
  const items = JSON.parse(text).items as { outcome: string; rejected_output: string | null; final_prompt: string | null }[];
  const failed = items.find((i) => i.outcome === "prompt_format_invalid")!;
  expect(failed.rejected_output).toContain("中文 text");
  expect(failed.rejected_output).toContain("[reference]");
  expect(failed.final_prompt).toBeNull();
  expect(items.find((i) => i.outcome === "ok")!.rejected_output).toBeNull();
});

test("rejected output fails closed when the user message cannot be parsed", async () => {
  const { owner, get } = await setup();
  put("e_p1", "t1", [video({ outcome: "prompt_format_invalid", final_prompt: undefined, user_message: "NOT JSON",
    rejected_output: "SENTINEL_RAW_OUTPUT persona/SENTINEL_PATH.png" })]);
  const text = await (await get(owner.cookie, "?kind=video")).text();
  expect(text).not.toContain("SENTINEL_");
  expect(JSON.parse(text).items[0].rejected_output).toBe("[unavailable]");
});

test("malformed user_message never leaks the original and never 500s", async () => {
  const { owner, get } = await setup();
  const cases = [
    "NOT JSON SENTINEL_RAW persona/SENTINEL_PATH.png",
    JSON.stringify({ references: "persona/SENTINEL_STR.png" }),
    JSON.stringify({ references: { key: "persona/SENTINEL_OBJ.png" } }),
    JSON.stringify({ references: ["persona/SENTINEL_ELEM.png", null, 7, { key: 5, role: { x: "persona/SENTINEL_ROLE.png" }, picture: "persona/SENTINEL_PIC.png" }] }),
    JSON.stringify(["persona/SENTINEL_ARR.png"]),
    JSON.stringify("persona/SENTINEL_STRING.png"),
    "null",
  ];
  cases.forEach((user_message, i) => put("e_p1", `t${i}`, [video({ user_message })]));
  const res = await get(owner.cookie, "?kind=video");
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).not.toContain("SENTINEL_");
  const items = JSON.parse(text).items as { user_message: string }[];
  expect(items).toHaveLength(cases.length);
  // Newest first: reversed order of insertion.
  expect(items[6]!.user_message).toBe("[unavailable]");
  expect(items[5]!.user_message).toBe("[unavailable]");
  expect(items[0]!.user_message).toBe("[unavailable]");
  const elems = JSON.parse(items[3]!.user_message).references;
  expect(elems).toEqual([{ key: "[reference]" }, { key: "[reference]" }, { key: "[reference]" }, { key: "[reference]" }]);
});

test("shot_id filter and kind=video without shot_id", async () => {
  const { owner, get } = await setup();
  put("e_p1", "t1", [video({ shot_id: "sh_1", final_prompt: "one" }), video({ shot_id: "sh_2", final_prompt: "two" })]);
  const one = await (await get(owner.cookie, "?kind=video&shot_id=sh_1")).json();
  expect(one.items.map((i: { final_prompt: string }) => i.final_prompt)).toEqual(["one"]);
  expect(one.items[0].shot_id).toBe("sh_1");
  const all = await (await get(owner.cookie, "?kind=video")).json();
  expect(all.items.map((i: { final_prompt: string }) => i.final_prompt)).toEqual(["two", "one"]);
});

test("legacy: final_only, not_retained, and null when records exist", async () => {
  const owner = await login("legacy-owner");
  const record = { provider: "mock", model: "m", version: "1", seed: 1, prompt: "LEGACY FINAL", ref_hashes: [], attempts: 1, cost_usd: 0 };
  const episode = fixture("e_leg", owner.ownerId);
  episode.shots = [
    shotFixture(1, { shot_id: "sh_a", model: { video: record as never } }),
    shotFixture(2, { shot_id: "sh_b" }),
  ];
  await insertEpisode(episode);
  const app = buildApp();
  const get = async (q: string) =>
    (await app.request(`/api/episodes/e_leg/prompts${q}`, { headers: { cookie: owner.cookie } })).json();

  expect((await get("?kind=video&shot_id=sh_a")).legacy).toEqual({ note: "final_only", final_prompt: "LEGACY FINAL" });
  expect((await get("?kind=video&shot_id=sh_b")).legacy).toEqual({ note: "not_retained" });
  expect((await get("?kind=video&shot_id=sh_zzz")).legacy).toEqual({ note: "not_retained" });
  expect((await get("?kind=video")).legacy).toEqual({ note: "not_retained" });
  expect((await get("?kind=script")).legacy).toEqual({ note: "not_retained" });

  put("e_leg", "t1", [video({ shot_id: "sh_a" })]);
  const withRecord = await get("?kind=video&shot_id=sh_a");
  expect(withRecord.items).toHaveLength(1);
  expect(withRecord.legacy).toBeNull();
});

test("traces of other owners never appear", async () => {
  const { owner, stranger, get } = await setup();
  await insertEpisode(fixture("e_other", stranger.ownerId));
  put("e_p1", "mine", [script({ user_message: "MINE" })]);
  put("e_other", "theirs", [script({ user_message: "THEIRS_SENTINEL" })]);
  const mine = await (await get(owner.cookie, "?kind=script")).text();
  expect(mine).toContain("MINE");
  expect(mine).not.toContain("THEIRS_SENTINEL");
  const theirs = await (await get(stranger.cookie, "?kind=script", "e_other")).text();
  expect(theirs).toContain("THEIRS_SENTINEL");
  expect(theirs).not.toContain("MINE");
});

test("write methods are not accepted", async () => {
  const { owner, app } = await setup();
  const res = await app.request("/api/episodes/e_p1/prompts?kind=script", { method: "POST", headers: { cookie: owner.cookie } });
  expect(res.status).toBe(404);
});

test("episode detail does not carry trace content", async () => {
  const { owner, app } = await setup();
  put("e_p1", "t1", [script({ user_message: "SENTINEL_TRACE_BODY" }), video({ final_prompt: "SENTINEL_TRACE_FINAL" }),
    video({ outcome: "prompt_format_invalid", final_prompt: undefined, rejected_output: "SENTINEL_TRACE_REJECTED" })]);
  const res = await app.request("/api/episodes/e_p1", { headers: { cookie: owner.cookie } });
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).not.toContain("SENTINEL_TRACE");
  expect(text).not.toContain(FULL_HASH);
});
