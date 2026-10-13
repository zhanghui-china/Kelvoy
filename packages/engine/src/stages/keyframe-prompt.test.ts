import { expect, test } from "bun:test";
import { buildKeyframePrompt } from "./keyframe-prompt";

const kf = "9:16画幅，傍晚暖光，人物全身入镜，背对镜头望向灵山大佛";

test("person and landmark: both images are named, the person goes into the scene, then the script prompt", () => {
  const prompt = buildKeyframePrompt({ kf_prompt: kf, landmarkName: "灵山大佛", personOmitted: false });
  expect(prompt.startsWith("图1是出镜人物的参考图，图2是「灵山大佛」的实景参考图")).toBe(true);
  expect(prompt).toContain("把图1的人物放进图2的实景中");
  expect(prompt.endsWith(kf)).toBe(true);
});

test("person without a landmark names only image 1", () => {
  const prompt = buildKeyframePrompt({ kf_prompt: kf, landmarkName: null, personOmitted: false });
  expect(prompt).toContain("图1是出镜人物的参考图");
  expect(prompt).not.toContain("图2");
  expect(prompt.endsWith(kf)).toBe(true);
});

test("empty shot names the landmark as image 1 and says nobody is in it", () => {
  const prompt = buildKeyframePrompt({ kf_prompt: "无人物出镜", landmarkName: "南长街街区", personOmitted: true });
  expect(prompt).toBe("图1是「南长街街区」的实景参考图，画面中没有人物。无人物出镜");
  expect(prompt).not.toContain("出镜人物的参考图");
});

test("sheet reference: T0 naming prefix with landmark, then the script prompt", () => {
  const prompt = buildKeyframePrompt({ kf_prompt: kf, landmarkName: "灵山大佛", personOmitted: false, personKind: "sheet" });
  expect(prompt).toBe("图1是出镜人物的三视图设定图（从左到右依次是正面、侧面、背面，是同一个人），图2是「灵山大佛」的实景参考图。"
    + "把图1中的这一个人物放进图2的实景中，画面里只出现一个人，不要画出设定图的拼图或多个人物，"
    + "保持人物的脸、发型和服装不变，保持地标的形状与比例、清晰可辨。" + kf);
});

test("sheet reference without a landmark names only image 1", () => {
  const prompt = buildKeyframePrompt({ kf_prompt: kf, landmarkName: null, personOmitted: false, personKind: "sheet" });
  expect(prompt).toContain("图1是出镜人物的三视图设定图");
  expect(prompt).toContain("画面里只出现一个人");
  expect(prompt).not.toContain("图2");
  expect(prompt.endsWith(kf)).toBe(true);
});

test("an empty shot ignores personKind", () => {
  const prompt = buildKeyframePrompt({ kf_prompt: "无人物出镜", landmarkName: "南长街街区", personOmitted: true, personKind: "sheet" });
  expect(prompt).toBe("图1是「南长街街区」的实景参考图，画面中没有人物。无人物出镜");
});

test("photo kind (explicit or default) keeps the original wording", () => {
  const a = buildKeyframePrompt({ kf_prompt: kf, landmarkName: "灵山大佛", personOmitted: false });
  const b = buildKeyframePrompt({ kf_prompt: kf, landmarkName: "灵山大佛", personOmitted: false, personKind: "photo" });
  expect(a).toBe(b);
  expect(a).not.toContain("设定图");
});
