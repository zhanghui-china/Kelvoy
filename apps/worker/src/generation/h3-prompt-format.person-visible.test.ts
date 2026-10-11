import { expect, test } from "bun:test";
import type { H3PromptContext } from "@kelvoy/engine";
import { H3FormatError, validateSections } from "./h3-prompt-format";

// A no-person shot: the person picture is still supplied (the video model needs two references) but the
// script says nobody is in frame, so the rewrite is not forced to cite <Picture 1>.
function context(personVisible?: boolean): H3PromptContext {
  return { mode: "Ref2VA", aspect: "16:9", duration_s: 4, size: "wide", camera: "push", beat: "远景呈现整条街灯火",
    kf_prompt: "夜晚的街巷全貌，无人物出镜", motion_prompt: "镜头缓慢前推", scene: null, destination: "无锡南长街", landmark: "南长街街区",
    references: [{ key: "persona/a.png", role: "person", picture: 1 }, { key: "dest/a.png", role: "scene", picture: 2 }],
    ...(personVisible === undefined ? {} : { person_visible: personVisible }) };
}
// The person Subject is defined by role only; the text never mentions <Picture 1>.
function withoutPersonPicture(): Record<string, string> {
  return {
    subject_definitions: "<Subject 1> is the identity reference supplied with the person role. <Subject 2> is the night street scene from <Picture 2>.",
    summary: "[reference generation] A wide push-in over the lit street in <Subject 2>.",
    retention_analysis: "<Subject 1> (not in frame): weak_reference - identity only.\n<Subject 2> (appears in [Shot 1]): fully_preserved - street scene.",
    detailed_description: "[Shot 1] A wide shot of <Subject 2> with a slow push camera move, lanterns glowing, through 00:04.000, in one continuous shot.",
    overall_soundscape: "Quiet ambient sound.", non_diegetic_music: "N/A",
  };
}
function ruleOf(value: Record<string, string>, ctx: H3PromptContext): string | undefined {
  try { validateSections(value, ctx); } catch (error) {
    expect(error).toBeInstanceOf(H3FormatError);
    return (error as H3FormatError).rule;
  }
  return undefined;
}

test("person_visible=false: the person picture does not have to be referenced", () => {
  expect(ruleOf(withoutPersonPicture(), context(false))).toBeUndefined();
});
test("person_visible missing or true: an unreferenced person picture still fails", () => {
  expect(ruleOf(withoutPersonPicture(), context())).toBe("all supplied pictures must be referenced");
  expect(ruleOf(withoutPersonPicture(), context(true))).toBe("all supplied pictures must be referenced");
});
test("person_visible=false: the scene picture must still be referenced", () => {
  const value = { ...withoutPersonPicture(),
    subject_definitions: "<Subject 1> is the identity reference supplied with the person role. <Subject 2> is the night street scene supplied with the scene role." };
  expect(ruleOf(value, context(false))).toBe("all supplied pictures must be referenced");
});
test("person_visible=false: citing the person picture is still accepted", () => {
  const value = { ...withoutPersonPicture(),
    subject_definitions: "<Subject 1> is the person from <Picture 1>. <Subject 2> is the night street scene from <Picture 2>." };
  expect(ruleOf(value, context(false))).toBeUndefined();
});
test("person_visible=false: a person subject mapped to the wrong picture still fails", () => {
  const value = { ...withoutPersonPicture(),
    subject_definitions: "<Subject 1> is the person from <Picture 2>. <Subject 2> is the night street scene from <Picture 2>." };
  expect(ruleOf(value, context(false))).toBe("subject mapped to wrong picture");
});
test("person_visible=false does not weaken the scene role check", () => {
  const value = { ...withoutPersonPicture(),
    subject_definitions: "<Subject 1> is the identity reference supplied with the person role. <Subject 2> is the person from <Picture 2>." };
  expect(ruleOf(value, context(false))).toBe("subject role does not match supplied reference");
});
