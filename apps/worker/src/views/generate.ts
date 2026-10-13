import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localImageRequest, type ThreeViews, type ViewsGeneration } from "@kelvoy/engine";
import { requestOne, type GenerationBackend } from "../generation/local";
import type { callInference } from "../inference-client";
import { publishPersonaFile, removePersonaFiles } from "./publish";
import { composeSheet, type SheetComposer } from "./sheet";

/**
 * Three-view generation for one job (ADR-0017). Prompt V1 and the view texts are verbatim from
 * spike/three-views/README.md; do not edit them without re-running that experiment.
 */
const VIEW_TEXT = {
  front: "面向镜头正面站立",
  side: "身体转向画面右侧，标准90度侧面站立",
  back: "背对镜头站立，完整展示背部和背包",
} as const;
const ORDER = ["front", "side", "back"] as const;

export function viewPrompt(view: keyof typeof VIEW_TEXT): string {
  return `把人物改为全身角色设定图：${VIEW_TEXT[view]}，纯白背景，人物居中，全身入镜，双臂自然下垂，` +
    "保持人物的脸型、发型、服装、鞋子和背包的款式与颜色完全不变";
}

/** One seed per job: the three views and any retry share it; a regenerate (new job) gets a new one. */
export function viewsSeed(generationId: string): number {
  return createHash("sha256").update(generationId).digest().readUInt32BE(0) % 2_147_483_647;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export interface GenerateDeps {
  call: typeof callInference;
  backend: GenerationBackend;
  compose?: SheetComposer;
}

export interface GenerateInput {
  job_id: string; persona_id: string; generation_id: string; source_key: string; attempt: number;
}

/**
 * Runs the three /image calls, stitches the sheet and publishes four append-only keys under
 * persona/<persona_id>/. Returns what the store should adopt plus the published keys, so the caller can
 * delete them if the store rejects the result. On any failure here the partial output is removed.
 */
export async function generateThreeViews(input: GenerateInput, deps: GenerateDeps, signal: AbortSignal):
  Promise<{ views: ThreeViews; views_gen: ViewsGeneration }> {
  if (!SAFE_ID.test(input.persona_id) || !SAFE_ID.test(input.generation_id) || !SAFE_ID.test(input.job_id)) {
    throw new Error("invalid views job identifier");
  }
  // A job may only read its own persona's files; the inference service resolves refs against the projects root.
  if (!input.source_key.startsWith(`persona/${input.persona_id}/`) || input.source_key.split(/[\\/]/).includes("..")) {
    throw new Error("invalid views source key");
  }
  const seed = viewsSeed(input.generation_id);
  const staging = await mkdtemp(join(tmpdir(), "kelvoy-views-"));
  const published: string[] = [];
  const sources: string[] = [];
  try {
    let model = "";
    let version = "";
    for (const view of ORDER) {
      const response = await requestOne(deps.call, "/image/",
        localImageRequest({ prompt: viewPrompt(view), refs: [input.source_key], seed, aspect: "9:16" }),
        signal, deps.backend, { task_id: input.job_id, attempt: input.attempt });
      sources.push(response.source);
      // Three views come from one workflow; a drifting model/version would make views_gen untrue.
      if (model && (model !== response.model || version !== response.version)) {
        throw new Error("inference backend changed between views");
      }
      model = response.model; version = response.version;
    }
    const sheetPath = join(staging, "sheet.jpg");
    await (deps.compose ?? composeSheet)(sources as [string, string, string], sheetPath, signal);
    signal.throwIfAborted();
    const directory = `persona/${input.persona_id}/views_${input.generation_id}_${crypto.randomUUID().slice(0, 8)}`;
    const views: ThreeViews = {
      front: `${directory}/front.png`, side: `${directory}/side.png`,
      back: `${directory}/back.png`, sheet: `${directory}/sheet.jpg`,
    };
    const files: [string, string][] = [
      [views.front, sources[0]!], [views.side, sources[1]!], [views.back, sources[2]!], [views.sheet, sheetPath],
    ];
    for (const [key, path] of files) {
      signal.throwIfAborted();
      published.push(key);
      await publishPersonaFile(key, path);
    }
    return { views, views_gen: { provider: "local", model, version, seed } };
  } catch (error) {
    await removePersonaFiles(published);
    throw error;
  } finally {
    await Promise.all(sources.map((path) => rm(path, { force: true }).catch(() => undefined)));
    await rm(staging, { recursive: true, force: true });
  }
}
