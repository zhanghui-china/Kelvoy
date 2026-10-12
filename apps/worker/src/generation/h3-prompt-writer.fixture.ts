import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { H3PromptContext } from "@kelvoy/engine";
import { createH3PromptWriter } from "./h3-prompt-writer";

// Shared by the h3-prompt-writer*.test.ts files. Split out of one file to stay under the 500-line limit;
// each test file registers its own beforeEach/afterEach around makeWriterRoot().
export async function makeWriterRoot(): Promise<{ root: string; restore: () => Promise<void> }> {
  const oldRoot = process.env.KELVOY_PROJECTS_ROOT;
  const root = await mkdtemp(join(tmpdir(), "h3-writer-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
  await mkdir(join(root, "persona")); await mkdir(join(root, "dest"));
  await mkdir(join(root, "e1", "kf"), { recursive: true });
  await writeFile(join(root, "persona/a.png"), "person"); await writeFile(join(root, "dest/a.png"), "scene");
  await writeFile(join(root, "e1/kf/a.png"), "first frame");
  return { root, restore: async () => {
    if (oldRoot === undefined) delete process.env.KELVOY_PROJECTS_ROOT; else process.env.KELVOY_PROJECTS_ROOT = oldRoot;
    await rm(root, { recursive: true, force: true });
  } };
}
export function context(mode: H3PromptContext["mode"] = "Ref2VA", duration_s = 4): H3PromptContext {
  return { mode, aspect: "9:16", duration_s, size: "detail", camera: "static", beat: "展示黄山烧饼",
    kf_prompt: "仅手部与黄山烧饼细节", motion_prompt: "手腕轻微旋转，固定镜头", scene: null,
    destination: "黄山", landmark: "街头", references: mode === "Ref2VA"
      ? [{ key: "persona/a.png", role: "person", picture: 1 }, { key: "dest/a.png", role: "scene", picture: 2 }]
      : [{ key: "e1/kf/a.png", role: "first_frame", picture: 1 }] };
}
export function sections(mode: H3PromptContext["mode"] = "Ref2VA", duration_s = 4): Record<string, string> {
  const timeline = `[Shot 1] A detail shot shows only hands and pastry. A slight wrist rotation continues with a static camera through 00:0${duration_s}.000, in one continuous shot.`;
  return mode === "Ref2VA" ? {
    subject_definitions: "<Subject 1> is the person from <Picture 1>. <Subject 2> is the scene from <Picture 2>.",
    summary: "[reference generation] A detail of <Subject 1>'s hands with pastry in <Subject 2>.",
    retention_analysis: "<Subject 1> (appears in [Shot 1]): partially_preserved - hands only.\n<Subject 2> (appears in [Shot 1]): weak_reference - scene only.",
    detailed_description: timeline + " <Subject 1> is framed against <Subject 2>.",
    overall_soundscape: "Quiet ambient sound.", non_diegetic_music: "N/A",
  } : { integrated_multimodal_description: timeline, overall_soundscape: "Quiet ambient sound.", non_diegetic_music: "N/A" };
}
export function response(value: unknown) { return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] }); }
export function writer(call: typeof fetch, options = {}) { return createH3PromptWriter({ fetch: call, apiKey: "test", ...options }); }
