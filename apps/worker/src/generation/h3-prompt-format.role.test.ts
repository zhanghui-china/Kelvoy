import { expect, test } from "bun:test";
import type { H3PromptContext } from "@kelvoy/engine";
import { H3FormatError, validateSections } from "./h3-prompt-format";

function context(mode: H3PromptContext["mode"] = "Ref2VA", duration_s = 4): H3PromptContext {
  return { mode, aspect: "9:16", duration_s, size: "detail", camera: "static", beat: "展示黄山烧饼",
    kf_prompt: "仅手部与黄山烧饼细节", motion_prompt: "手腕轻微旋转，固定镜头", scene: null,
    destination: "黄山", landmark: "街头", references: mode === "Ref2VA"
      ? [{ key: "persona/a.png", role: "person", picture: 1 }, { key: "dest/a.png", role: "scene", picture: 2 }]
      : [{ key: "e1/kf/a.png", role: "first_frame", picture: 1 }] };
}
function sections(mode: H3PromptContext["mode"] = "Ref2VA", duration_s = 4): Record<string, string> {
  const timeline = `[Shot 1] A detail shot shows only hands and pastry. A slight wrist rotation continues with a static camera through 00:0${duration_s}.000, in one continuous shot.`;
  return mode === "Ref2VA" ? {
    subject_definitions: "<Subject 1> is the person from <Picture 1>. <Subject 2> is the scene from <Picture 2>.",
    summary: "[reference generation] A detail of <Subject 1>'s hands with pastry in <Subject 2>.",
    retention_analysis: "<Subject 1> (appears in [Shot 1]): partially_preserved - hands only.\n<Subject 2> (appears in [Shot 1]): weak_reference - scene only.",
    detailed_description: timeline + " <Subject 1> is framed against <Subject 2>.",
    overall_soundscape: "Quiet ambient sound.", non_diegetic_music: "N/A",
  } : { integrated_multimodal_description: timeline, overall_soundscape: "Quiet ambient sound.", non_diegetic_music: "N/A" };
}

function ruleOf(value: Record<string, string>): string | undefined {
  try { validateSections(value, context()); } catch (error) {
    expect(error).toBeInstanceOf(H3FormatError);
    return (error as H3FormatError).rule;
  }
  return undefined;
}
function withDefinitions(subject_definitions: string, summary?: string): Record<string, string> {
  return { ...sections(), subject_definitions, ...(summary ? { summary } : {}) };
}

test("persona wording is accepted", () => {
  expect(ruleOf(withDefinitions("<Subject 1> is the persona referenced from <Picture 1>, matching the supplied person role. <Subject 2> is the scene from <Picture 2>."))).toBeUndefined();
});
test("legacy person wording is still accepted", () => {
  expect(ruleOf(sections())).toBeUndefined();
});
test("person reference described only as a scene fails", () => {
  expect(ruleOf(withDefinitions("<Subject 1> is the scene environment from <Picture 1>. <Subject 2> is the scene from <Picture 2>."))).toBe("subject role does not match supplied reference");
});
test("scene reference described only as a person fails", () => {
  expect(ruleOf(withDefinitions("<Subject 1> is the person from <Picture 1>. <Subject 2> is the person from <Picture 2>."))).toBe("subject role does not match supplied reference");
});
test("definition with no role words from either side is accepted", () => {
  expect(ruleOf(withDefinitions("<Subject 1> is the person from <Picture 1>. <Subject 2> is the thing from <Picture 2>."))).toBeUndefined();
});
test("definition with both kinds of role words is accepted", () => {
  expect(ruleOf(withDefinitions("<Subject 1> is the person standing in a scene from <Picture 1>. <Subject 2> is the scene from <Picture 2>."))).toBeUndefined();
});
test("subject mapped to the wrong picture still fails", () => {
  expect(ruleOf(withDefinitions(
    "<Subject 1> is the person from <Picture 2>. <Subject 2> is the scene from <Picture 2>.",
    "[reference generation] A detail of <Subject 1>'s hands with pastry in <Subject 2>, see <Picture 1>.",
  ))).toBe("subject mapped to wrong picture");
});
