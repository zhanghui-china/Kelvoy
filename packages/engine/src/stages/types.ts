import type { ComposeProvider } from "../providers/types";
import type { Destination, Persona } from "../schema";

/**
 * Extra read-only context a stage needs beyond the Episode itself.
 * Engine stages don't touch @kelvoy/store (ADR-0004/CLAUDE.md directory
 * table) — the caller (packages/cli, apps/worker) fetches these and passes
 * them in. Optional because most stages don't need them yet (only "script"
 * does, as of M1-10); a stage that needs a field but doesn't get it should
 * throw a clear error rather than guessing.
 */
export interface StageContext {
  destination?: Destination;
  persona?: Persona;
  generation_id?: string;
  attempt?: number;
  keyframe?: {
    generate(input: {
      episode_id: string;
      shot_no: number;
      candidate_no: number;
      prompt: string;
      refs: string[];
      seed: number;
      generation_id: string;
    }): Promise<GeneratedAsset>;
  };
  video?: {
    generate(input: {
      episode_id: string;
      shot_no: number;
      keyframe: string;
      prompt: string;
      duration_s: number;
      seed: number;
      generation_id: string;
    }): Promise<GeneratedAsset>;
  };
  /**
   * compose 阶段专用：执行 ffmpeg 的后端。engine 只出 ComposePlan，实现由
   * apps/worker 注入（CLAUDE.md：ffmpeg 只在 worker 上跑）。
   */
  compose?: ComposeProvider;
}

export interface GeneratedAsset {
  /** Episode-relative artifact key, already saved by the worker. */
  key: string;
  model: string;
  version: string;
  seed: number;
  seconds: number;
  ref_hashes: string[];
}
