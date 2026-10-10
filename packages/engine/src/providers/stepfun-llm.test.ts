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

// 使用不同景别提供基础输出夹具。
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
  const invalid = buildValidRawShots(10).map(s => ({ ...s, landmark: "unknown" }));
  const valid = buildValidRawShots(26);
  let call = 0;
  (globalThis as { fetch: typeof fetch }).fetch = (async () => {
    call += 1;
    const raw = call === 1 ? invalid : valid;
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
  const invalid = buildValidRawShots(5).map(s => ({ ...s, landmark: "unknown" }));
  mockFetchOnce(JSON.stringify(invalid));

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


test.each([1, 10, 23, 31, 40])("first generation accepts %i same-size shots without landmarks in one call", async (count) => {
  const raw = buildValidRawShots(count).map(s => ({ ...s, size: "wide", landmark: null }));
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return Response.json({ choices: [{ message: { content: JSON.stringify(raw) } }] });
  }) as unknown as typeof fetch;
  const result = await stepfunScriptProvider.generateShots({ brief, destination });
  expect(result.shots).toHaveLength(count);
  expect(calls).toBe(1);
});

test("optimization prompt permits adding and removing shots and omits quotas", async () => {
  mockFetchOnce(JSON.stringify(buildValidRawShots(26)));
  const previous = await stepfunScriptProvider.generateShots({ brief, destination });
  let prompt = "";
  globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    prompt = JSON.parse(init!.body as string).messages[0].content;
    return Response.json({ choices: [{ message: { content: JSON.stringify(buildValidRawShots(3).map(s => ({ ...s, landmark: null }))) } }] });
  }) as unknown as typeof fetch;
  const result = await stepfunScriptProvider.generateShots({ brief, destination, previousShots: previous.shots, instruction: "精简到 3 镜" });
  expect(result.shots).toHaveLength(3);
  expect(prompt).toContain("精简到 3 镜");
  expect(prompt).toContain("允许按用户指令增加或删除镜头");
  for (const quota of ["保持当前镜数", "优化保留当前镜数", "镜头类型配比", "至少 5 镜", "连续超过 2 镜", "写一份 26 镜"]) expect(prompt).not.toContain(quota);
});

test.each([{ scene: "" }, { time: "dawn" }, { size: "invalid" }, { camera: "invalid" }, { beat: "" }, { kf_prompt: "" }, { motion_prompt: "" }])("rejects invalid generated fields %j", async (patch) => {
  mockFetchOnce(JSON.stringify(buildValidRawShots(1).map(s => ({ ...s, ...patch }))));
  await expect(stepfunScriptProvider.generateShots({ brief, destination })).rejects.toThrow();
});


test("first generation prompt treats 28 shots as a flexible starting point", async () => {
  let prompt = "";
  globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    prompt = JSON.parse(init!.body as string).messages[0].content;
    return Response.json({ choices: [{ message: { content: JSON.stringify(buildValidRawShots(1)) } }] });
  }) as unknown as typeof fetch;
  await stepfunScriptProvider.generateShots({ brief, destination });
  expect(prompt).toContain("首次生成可从约 28 镜开始");
  expect(prompt).not.toContain("镜头类型配比");
  expect(prompt).not.toContain("写一份 28 镜");
});


test.each([1, 7, 8, 12])("long policy preserves suggested durations for %i shots without a quota", async count => {
  let prompt = "";
  const raw = buildValidRawShots(count).map((s, i) => ({ ...s, duration_s: [3, 4.25, 6][i % 3] }));
  globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    prompt = JSON.parse(init!.body as string).messages[0].content;
    return Response.json({ choices: [{ message: { content: JSON.stringify(raw) } }] });
  }) as unknown as typeof fetch;
  const result = await stepfunScriptProvider.generateShots({ brief, destination, cutPolicy: "long_3_6" });
  expect(result.shots.map(s => s.duration_s)).toEqual(raw.map(s => s.duration_s!));
  expect(prompt).toContain("约 7–8 镜");
  expect(prompt).toContain("3–6 秒");
  expect(prompt).not.toContain("约 28 镜");
});

test.each([undefined, null, "4", 2.99, 6.01, Number.NaN, Infinity])("long policy rejects invalid suggestion %j", async duration_s => {
  mockFetchOnce(JSON.stringify(buildValidRawShots(1).map(s => ({ ...s, duration_s }))));
  await expect(stepfunScriptProvider.generateShots({ brief, destination, cutPolicy: "long_3_6" }))
    .rejects.toThrow("duration_s 必须为 3–6 秒的有限数值");
});

test("long optimization preserves new durations while changing the shot count", async () => {
  mockFetchOnce(JSON.stringify(buildValidRawShots(7).map(s => ({ ...s, duration_s: 4 }))));
  const previous = await stepfunScriptProvider.generateShots({ brief, destination, cutPolicy: "long_3_6" });
  let prompt = "";
  globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    prompt = JSON.parse(init!.body as string).messages[0].content;
    return Response.json({ choices: [{ message: { content: JSON.stringify(buildValidRawShots(11).map(s => ({ ...s, duration_s: 3.5 }))) } }] });
  }) as unknown as typeof fetch;
  const result = await stepfunScriptProvider.generateShots({ brief, destination, cutPolicy: "long_3_6", previousShots: previous.shots, instruction: "增加到 11 镜" });
  expect(result.shots).toHaveLength(11);
  expect(result.shots.every(s => s.duration_s === 3.5)).toBe(true);
  expect(prompt).not.toContain("保持当前镜数");
});
