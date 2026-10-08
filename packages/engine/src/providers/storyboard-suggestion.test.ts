import { expect, test } from "bun:test";
import { validateSuggestionFields } from "./storyboard-suggestion";
import type { Destination, Episode } from "../schema";
const episode = { scenes: [{ id: "sc_1" }] } as Episode;
const destination = { landmarks: [{ id: "lm_1" }] } as Destination;
test("suggestion rejects arrays, generated state, invented scene and landmark", () => {
  for (const value of [[], { clip: "x" }, { scene: "invented" }, { landmark: "invented" }, { size: "huge" }]) {
    expect(() => validateSuggestionFields(value, episode, destination)).toThrow();
  }
});
test("suggestion rejects overwriting filled fields and keeps valid partial fields", () => {
  expect(() => validateSuggestionFields({ beat: "覆盖" }, episode, destination, { beat: "已有" })).toThrow();
  expect(validateSuggestionFields({ scene: "sc_1", landmark: "lm_1", size: "wide" }, episode, destination)).toEqual({ scene: "sc_1", landmark: "lm_1", size: "wide" });
});

test("suggestion uses HTTP provider and frozen context, returning only missing fields", async () => {
  const { suggestStoryboardShot } = await import("./storyboard-suggestion");
  const originalFetch = globalThis.fetch;
  const key = process.env.STEPFUN_API_KEY;
  process.env.STEPFUN_API_KEY = "test-key";
  let prompt = "";
  globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
    prompt = JSON.parse(options.body as string).messages[0].content;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ scene: "sc_1", size: "wide", camera: "static", landmark: null, caption: "清晨出发", kf_prompt: "晨光中的石板路", motion_prompt: "沿石板路步行" }) } }] });
  }) as typeof fetch;
  try {
    const result = await suggestStoryboardShot({ description: "走过石板路", after_shot_id: null, fields: { beat: "走过石板路" } },
      { ...episode, shots: [], brief: { tone: "松弛" } } as unknown as Episode, destination,
      { name: "冻结角色" } as import("../schema").Persona);
    expect(result.beat).toBeUndefined();
    expect(result.scene).toBe("sc_1");
    expect(prompt).toContain("冻结角色");
    expect(prompt).toContain('"after":null');
  } finally {
    globalThis.fetch = originalFetch;
    if (key === undefined) delete process.env.STEPFUN_API_KEY; else process.env.STEPFUN_API_KEY = key;
  }
});

test('AI suggestions obey insertion field limits and support the default empty-scene draft', () => {
  expect(() => validateSuggestionFields({ caption: '长'.repeat(121) }, episode, destination)).toThrow();
  expect(() => validateSuggestionFields({ kf_prompt: '画'.repeat(2001) }, episode, destination)).toThrow();
  expect(validateSuggestionFields({ scene: '' }, { ...episode, scenes: [] }, destination)).toEqual({ scene: '' });
  expect(() => validateSuggestionFields({ scene: '' }, episode, destination)).toThrow();
});
