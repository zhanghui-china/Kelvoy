import { expect, test } from "bun:test";
import type { H3PromptContext } from "@kelvoy/engine";
import { H3FormatError, validateSections } from "./h3-prompt-format";

function context(size: H3PromptContext["size"], camera: H3PromptContext["camera"]): H3PromptContext {
  return { mode: "I2VA", aspect: "9:16", duration_s: 4, size, camera, beat: "展示景点",
    kf_prompt: "景点远景", motion_prompt: "镜头运动", scene: null, destination: "黄山", landmark: "街头",
    references: [{ key: "e1/kf/a.png", role: "first_frame", picture: 1 }] };
}
function sections(text: string): Record<string, string> {
  return { integrated_multimodal_description: `[Shot 1] ${text} through 00:04.000, in one continuous shot.`,
    overall_soundscape: "Quiet ambient sound.", non_diegetic_music: "N/A" };
}
function ruleOf(fn: () => void): string | undefined {
  try { fn(); } catch (error) { if (error instanceof H3FormatError) return error.rule; throw error; }
  return undefined;
}

test("detail and close sizes accept each other's wording", () => {
  expect(() => validateSections(sections("A close-up shot frames a bamboo steamer with a static camera"), context("detail", "static"))).not.toThrow();
  expect(() => validateSections(sections("A detail shot frames a bamboo steamer with a static camera"), context("close", "static"))).not.toThrow();
});

test("pan accepts tilt and panning wording", () => {
  expect(() => validateSections(sections("A wide shot where the camera tilts upward slowly"), context("wide", "pan"))).not.toThrow();
  expect(() => validateSections(sections("A wide shot with the camera slowly panning right"), context("wide", "pan"))).not.toThrow();
});

test("push accepts zoom in wording", () => {
  expect(() => validateSections(sections("A medium shot where the camera zooms in slowly"), context("medium", "push"))).not.toThrow();
});

test("missing camera wording still fails", () => {
  expect(ruleOf(() => validateSections(sections("A wide shot of the street at dusk"), context("wide", "pan"))))
    .toBe("preserve shot size and camera");
});

test("wide size is not satisfied by close-up wording", () => {
  expect(ruleOf(() => validateSections(sections("A close-up shot with the camera panning right"), context("wide", "pan"))))
    .toBe("preserve shot size and camera");
});

test("static camera still rejects movement words", () => {
  expect(ruleOf(() => validateSections(sections("A wide shot with a static camera. The camera pans"), context("wide", "static"))))
    .toBe("static camera cannot move");
});
