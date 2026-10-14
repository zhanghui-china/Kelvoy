import { expect, test } from "bun:test";
import type { H3PromptContext } from "@kelvoy/engine";
import { H3FormatError, validateSections } from "./h3-prompt-format";

const context = (over: Partial<H3PromptContext> = {}): H3PromptContext => ({
  mode: "I2VA", aspect: "9:16", duration_s: 4, size: "wide", camera: "static", beat: "b", kf_prompt: "k", motion_prompt: "m",
  scene: { id: "sc1", name: "山顶", time: "morning", landmarks: [] }, destination: "黄山", landmark: "迎客松",
  references: [{ key: "kf/1.png", role: "first_frame", picture: 1 }], ...over });
const sections = (text: string) => ({ integrated_multimodal_description: `[Shot 1] wide static shot, ${text} 00:00.000-00:04.000`,
  non_diegetic_music: "N/A" });
const rule = (fn: () => void) => { try { fn(); } catch (e) { return e instanceof H3FormatError ? e.rule : String(e); } return null; };

test("the context's own landmark, destination and scene names may stay in Chinese", () => {
  const text = "the man stands beside 迎客松 on 黄山 at 山顶";
  // Other rules may still apply to this minimal fixture; the point is that the English rule does not fire.
  expect(rule(() => validateSections(sections(text), context()))).not.toBe("rewrite must be English");
  expect(rule(() => validateSections(sections(text), context({ landmark: null, destination: null, scene: null })))).toBe("rewrite must be English");
});

test("other Chinese text is still rejected, even next to an allowed name", () => {
  expect(rule(() => validateSections(sections("beside 迎客松 reading 营业中"), context()))).toBe("rewrite must be English");
});

test("a name that is not in this shot's context is rejected", () => {
  expect(rule(() => validateSections(sections("beside 迎客松"), context({ landmark: null })))).toBe("rewrite must be English");
});
