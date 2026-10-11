import { expect, test } from "bun:test";
import type { H3PromptContext } from "@kelvoy/engine";
import { H3FormatError, validateSections } from "./h3-prompt-format";

function context(): H3PromptContext {
  return { mode: "Ref2VA", aspect: "9:16", duration_s: 4, size: "detail", camera: "static", beat: "展示黄山烧饼",
    kf_prompt: "仅手部与黄山烧饼细节", motion_prompt: "手腕轻微旋转，固定镜头", scene: null,
    destination: "黄山", landmark: "街头",
    references: [{ key: "persona/a.png", role: "person", picture: 1 }, { key: "dest/a.png", role: "scene", picture: 2 }] };
}
function sections(retention_analysis: string): Record<string, string> {
  const timeline = "[Shot 1] A detail shot shows only hands and pastry. A slight wrist rotation continues with a static camera through 00:04.000, in one continuous shot.";
  return {
    subject_definitions: "<Subject 1> is the person from <Picture 1>. <Subject 2> is the scene from <Picture 2>.",
    summary: "[reference generation] A detail of <Subject 1>'s hands with pastry in <Subject 2>.",
    retention_analysis,
    detailed_description: timeline + " <Subject 1> is framed against <Subject 2>.",
    overall_soundscape: "Quiet ambient sound.", non_diegetic_music: "N/A",
  };
}
function ruleOf(retention: string): string | undefined {
  try { validateSections(sections(retention), context()); } catch (error) {
    expect(error).toBeInstanceOf(H3FormatError);
    return (error as H3FormatError).rule;
  }
  return undefined;
}
const S1 = "<Subject 1> (appears in [Shot 1]): partially_preserved - hands only.";
const S2 = "<Subject 2> (appears in [Shot 1]): weak_reference - scene only.";
const INVALID = "invalid visible retention syntax";

test("canonical two-line retention passes", () => {
  expect(ruleOf(`${S1}\n${S2}`)).toBeUndefined();
});
test("subject reported as not appearing passes", () => {
  expect(ruleOf(`<Subject 1> (does not appear in [Shot 1]): weak_reference - the person is not shown.\n${S2}`)).toBeUndefined();
});
test("empty or absent parenthetical passes", () => {
  expect(ruleOf(`<Subject 1> (appears in []): weak_reference - not shown.\n${S2}`)).toBeUndefined();
  expect(ruleOf(`<Subject 1> (absent): weak_reference - not shown.\n${S2}`)).toBeUndefined();
});
test("Picture entry is allowed and not counted", () => {
  expect(ruleOf(`${S1}\n${S2}\n<Picture 1> ([Shot 1] first frame): partially_preserved - used only as the person reference.`)).toBeUndefined();
});
test("missing subject entry fails", () => {
  expect(ruleOf(S1)).toBe(INVALID);
});
test("duplicate subject entry fails", () => {
  expect(ruleOf(`${S1}\n${S1}`)).toBe(INVALID);
});
test("unknown relation tag fails", () => {
  expect(ruleOf(`<Subject 1> (appears in [Shot 1]): kind_of_preserved - hands.\n${S2}`)).toBe(INVALID);
});
test("missing separator or explanation fails", () => {
  expect(ruleOf(`<Subject 1> (appears in [Shot 1]): weak_reference hands only.\n${S2}`)).toBe(INVALID);
  expect(ruleOf(`<Subject 1> (appears in [Shot 1]): weak_reference - \n${S2}`)).toBe(INVALID);
});
test("line not starting with Subject or Picture fails", () => {
  expect(ruleOf(`${S1}\n${S2}\nSubject 1 appears in the shot`)).toBe(INVALID);
});
