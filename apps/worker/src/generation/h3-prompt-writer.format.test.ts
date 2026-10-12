import { afterEach, beforeEach, expect, test } from "bun:test";
import type { H3PromptContext } from "@kelvoy/engine";
import { H3FormatError } from "./h3-prompt-format";
import { context, makeWriterRoot, response, sections, writer } from "./h3-prompt-writer.fixture";

let restoreRoot: () => Promise<void>;
beforeEach(async () => { ({ restore: restoreRoot } = await makeWriterRoot()); });
afterEach(async () => { await restoreRoot(); });

// Production regressions (GX10 e_5cc656f2, I2VA): models echo the worker's own "(from [Shot 1])" first-frame
// wording, and sometimes close the timeline with "4 seconds" instead of 00:04.000.
// Same shape as the production shot: a close, static, person-free xiaolongbao shot (not the shaobing detail rules).
const xiaolongbao = (): H3PromptContext => ({ ...context("I2VA"), size: "close", beat: "坐下品尝热乎的小笼",
  kf_prompt: "刚蒸好的小笼放在竹制蒸屉上，冒着热气", motion_prompt: "镜头保持静止，捕捉袅袅热气" });
const i2vaSections = (timeline: string) => ({ ...sections("I2VA"), integrated_multimodal_description: timeline });
const echoed = "[Shot 1] Live-action, detail static shot of pastry, fully matching <Picture 1> (from [Shot 1]) at the 0.00-second mark. The camera remains static as mist shifts, with no people. The timeline of this shot ends at 00:04.000.";

test("I2VA accepts the echoed first-frame source note as the only [Shot 1] marker", async () => {
  let calls = 0;
  const result = await writer((async () => { calls++; return response(i2vaSections(echoed)); }) as unknown as typeof fetch)
    .write({ episode_id: "e1", context: xiaolongbao() });
  expect(calls).toBe(1);
  expect(result.prompt).toContain("(from [Shot 1])");
});

test("a repeated real [Shot 1] marker gets one format correction, a real [Shot 2] still never does", async () => {
  let calls = 0;
  const twice = "[Shot 1] A static detail of pastry. [Shot 1] The same detail continues through 00:04.000.";
  const result = await writer((async (_u: string, init: RequestInit) => {
    calls++;
    if (calls === 2) expect(JSON.parse(init.body as string).messages.at(-1).content).toContain("one continuous Shot 1 required");
    return response(calls === 1 ? i2vaSections(twice) : i2vaSections(echoed));
  }) as unknown as typeof fetch).write({ episode_id: "e1", context: xiaolongbao() });
  expect(calls).toBe(2);
  expect(result.prompt).toContain("integrated_multimodal_description:");
  const error = await writer((async () => response(i2vaSections("[Shot 1] A detail static shot through 00:04.000. [Shot 2] Cut."))) as unknown as typeof fetch)
    .write({ episode_id: "e1", context: { ...xiaolongbao(), beat: "second input" } }).then(() => null, (e: unknown) => e as H3FormatError);
  expect(error?.rule).toBe("one continuous Shot 1 required");
  expect(error?.corrected).toBe(false);
});

test("a timeline without the closing timestamp gets one correction and stops after two requests", async () => {
  const noEnd = "[Shot 1] A detail static shot of steam rising from the buns for the full 4-second duration, no people.";
  let calls = 0;
  const result = await writer((async (_u: string, init: RequestInit) => {
    calls++;
    if (calls === 2) expect(JSON.parse(init.body as string).messages.at(-1).content).toContain("timeline must end at 00:04.000");
    return response(i2vaSections(calls === 1 ? noEnd : echoed));
  }) as unknown as typeof fetch).write({ episode_id: "e1", context: xiaolongbao() });
  expect(calls).toBe(2);
  expect(result.prompt).toContain("00:04.000");
  calls = 0;
  const error = await writer((async () => { calls++; return response(i2vaSections(noEnd)); }) as unknown as typeof fetch)
    .write({ episode_id: "e1", context: { ...xiaolongbao(), beat: "another input" } }).then(() => null, (e: unknown) => e as H3FormatError);
  expect(calls).toBe(2);
  expect(error?.rule).toBe("timeline must end at 00:04.000");
  expect(error?.corrected).toBe(true);
  // A present-but-wrong timestamp contradicts the requested length: terminal, no correction.
  calls = 0;
  const wrong = await writer((async () => { calls++; return response(i2vaSections("[Shot 1] A detail static shot of pastry through 00:05.000.")); }) as unknown as typeof fetch)
    .write({ episode_id: "e1", context: { ...xiaolongbao(), beat: "third input" } }).then(() => null, (e: unknown) => e as H3FormatError);
  expect(calls).toBe(1);
  expect(wrong?.corrected).toBe(false);
});
