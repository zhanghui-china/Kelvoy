import { expect, test } from "bun:test";
import type { H3PromptContext } from "@kelvoy/engine";
import { normalizePictureLabels } from "./h3-prompt-format";

function context(): H3PromptContext {
  return { mode: "Ref2VA", aspect: "9:16", duration_s: 4, size: "detail", camera: "static", beat: "b",
    kf_prompt: "k", motion_prompt: "m", scene: null, destination: "d", landmark: "l",
    references: [{ key: "persona/a.png", role: "person", picture: 1 }, { key: "dest/a.png", role: "scene", picture: 2 }] };
}
const normalize = (value: Record<string, string>) => normalizePictureLabels(value, context());

test("bare provided picture labels gain angle brackets and are counted", () => {
  const out = normalize({ a: "<Subject 1> is the person reference from Picture 1 and picture 2.", b: "Picture 2" });
  expect(out.sections).toEqual({ a: "<Subject 1> is the person reference from <Picture 1> and <Picture 2>.", b: "<Picture 2>" });
  expect(out.normalized).toBe(3);
});

test("labels with brackets, unprovided numbers and ordinary words stay untouched", () => {
  const value = { a: "from <Picture 1> and Picture 7", b: "Picture perfect pictures 1 Pictures 2 Picture 1st Picture 0 Picture 1.5", c: "N/A" };
  const out = normalize(value);
  expect(out.sections).toEqual(value);
  expect(out.normalized).toBe(0);
});

test("normalization is idempotent and never doubles brackets", () => {
  const once = normalize({ a: "Picture 1, <Picture 2>, Picture 2" });
  expect(once.sections.a).toBe("<Picture 1>, <Picture 2>, <Picture 2>");
  const twice = normalizePictureLabels(once.sections, context());
  expect(twice.sections).toEqual(once.sections);
  expect(twice.normalized).toBe(0);
});

test("every field is normalized and the input object is not mutated", () => {
  const value = { subject_definitions: "Picture 1", summary: "Picture 2", non_diegetic_music: "N/A", overall_soundscape: "see Picture 1" };
  const out = normalize(value);
  expect(Object.keys(out.sections)).toEqual(Object.keys(value));
  expect(out.sections.non_diegetic_music).toBe("N/A");
  expect(out.sections.overall_soundscape).toBe("see <Picture 1>");
  expect(value.summary).toBe("Picture 2");
});
