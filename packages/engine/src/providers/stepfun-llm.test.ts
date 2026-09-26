import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Destination } from "../schema/destination";
import type { EpisodeBrief } from "../schema/episode";
import { ContentBlockedError } from "../rules/content";
import { stepfunScriptProvider } from "./stepfun-llm";

const destination: Destination = {
  destination_id: "d_test",
  version: 1,
  name: "测试景区",
  city: "测试市",
  type: "scenic_area",
  season_best: ["秋"],
  landmarks: [
    { id: "lm_1", name: "地标一", refs: [], best_time: "上午" },
    { id: "lm_2", name: "地标二", refs: [], best_time: "下午" },
  ],
  route: ["山门", "地标一", "地标二"],
  food: ["素斋"],
  transport: "地铁",
  stay: "民宿",
};

const brief: EpisodeBrief = {
  season: "秋",
  aspect: "9:16",
  requirements: "",
  duration_s: 30,
  tone: "松弛",
  outfit_override: null,
  banned: [],
};

// 5 个景别循环，保证任何长度下都不会连续 2 镜以上同景别 —— checkScriptRules
// 的 size_run 检查天然通过，测试焦点不在这条规则上。
const SIZES = ["wide", "medium", "close", "detail", "pov"] as const;

function buildValidRawShots(count: number, landmarkEvery = 5) {
  return Array.from({ length: count }, (_, i) => ({
    scene: i < count / 2 ? "上段" : "下段",
    time: "morning",
    size: SIZES[i % SIZES.length],
    beat: `动作 ${i + 1}`,
    camera: "static",
    landmark: i % landmarkEvery === 0 ? "lm_1" : null,
    kf_prompt: `画面 ${i + 1}`,
    motion_prompt: `运动 ${i + 1}`,
  }));
}

function mockFetchOnce(content: string) {
  (globalThis as { fetch: typeof fetch }).fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

const originalFetch = globalThis.fetch;
const originalKey = process.env.STEPFUN_API_KEY;

beforeEach(() => {
  process.env.STEPFUN_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.STEPFUN_API_KEY;
  else process.env.STEPFUN_API_KEY = originalKey;
});

test("generateShots returns shots+scenes when the first round already passes the rules", async () => {
  const raw = buildValidRawShots(26);
  mockFetchOnce(`这是分镜表：\n${JSON.stringify(raw)}\n请查收`);

  const result = await stepfunScriptProvider.generateShots({ brief, destination });

  expect(result.shots).toHaveLength(26);
  expect(result.shots[0]?.no).toBe(1);
  expect(result.shots.filter((s) => s.landmark !== null).length).toBeGreaterThanOrEqual(5);
  expect(result.scenes.map((s) => s.name)).toEqual(["上段", "下段"]);
  expect(result.shots.every((s) => s.status === "draft")).toBe(true);
});

test("retries with rule-violation feedback and succeeds on a later round", async () => {
  const tooFew = buildValidRawShots(10); // 违反最少 24 镜
  const valid = buildValidRawShots(26);
  let call = 0;
  (globalThis as { fetch: typeof fetch }).fetch = (async () => {
    call += 1;
    const raw = call === 1 ? tooFew : valid;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const result = await stepfunScriptProvider.generateShots({ brief, destination });

  expect(call).toBe(2);
  expect(result.shots).toHaveLength(26);
});

test("retries when a generated shot hits the content blocklist, and succeeds once it's clean", async () => {
  const dirty = buildValidRawShots(26).map((s, i) => (i === 0 ? { ...s, kf_prompt: "色情场景" } : s));
  const clean = buildValidRawShots(26);
  let call = 0;
  (globalThis as { fetch: typeof fetch }).fetch = (async () => {
    call += 1;
    const raw = call === 1 ? dirty : clean;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const result = await stepfunScriptProvider.generateShots({ brief, destination });

  expect(call).toBe(2);
  expect(result.shots).toHaveLength(26);
});

test("throws ContentBlockedError after exhausting all correction rounds while still hitting the blocklist", async () => {
  const dirty = buildValidRawShots(26).map((s, i) => (i === 0 ? { ...s, kf_prompt: "色情场景" } : s));
  mockFetchOnce(JSON.stringify(dirty));

  await expect(stepfunScriptProvider.generateShots({ brief, destination })).rejects.toBeInstanceOf(
    ContentBlockedError,
  );
});

test("throws after exhausting all correction rounds", async () => {
  const alwaysTooFew = buildValidRawShots(5);
  mockFetchOnce(JSON.stringify(alwaysTooFew));

  await expect(stepfunScriptProvider.generateShots({ brief, destination })).rejects.toThrow("3 轮自动修正后仍不满足规则");
});

test("throws a clear error when STEPFUN_API_KEY is missing", async () => {
  delete process.env.STEPFUN_API_KEY;
  await expect(stepfunScriptProvider.generateShots({ brief, destination })).rejects.toThrow("STEPFUN_API_KEY");
});

test("throws when a landmark id isn't in the destination's landmark list", async () => {
  const raw = buildValidRawShots(26).map((s, i) => (i === 0 ? { ...s, landmark: "lm_unknown" } : s));
  mockFetchOnce(JSON.stringify(raw));

  await expect(stepfunScriptProvider.generateShots({ brief, destination })).rejects.toThrow(
    "3 轮自动修正后仍不满足规则",
  );
});
