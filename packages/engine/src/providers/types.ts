import type { Destination, EpisodeBrief, Persona, Scene, Shot } from "../schema";
import type { ShotCut } from "../rules/beat";

export interface ScriptProvider {
  generateShots(input: {
    brief: EpisodeBrief;
    destination: Destination;
  }): Promise<{ shots: Shot[]; scenes: Scene[] }>;
}

export interface IdentityProvider {
  applyPersona(input: { persona: Persona; targetPrompt: string }): Promise<string>; // image path
}

export interface KeyframeProvider {
  generateCandidates(input: {
    shot: Shot;
    persona: Persona;
    destination: Destination;
    count: number;
  }): Promise<string[]>;
}

export interface VideoProvider {
  generateClip(input: { keyframePath: string; motionPrompt: string }): Promise<string>;
}

export interface UpscaleProvider {
  upscale(input: { path: string }): Promise<string>;
}

export interface MusicProvider {
  selectTrack(input: { bpm?: number; tone?: string }): Promise<{
    file: string;
    bpm: number;
    license: string;
  }>;
}

/**
 * 合成计划 (FR-07, M1-13)：engine 算出来的、后端无关的"该怎么剪"描述，
 * 由 apps/worker 的 ComposeProvider 翻译成一条 ffmpeg 命令执行。
 *
 * 路径一律是**相对 key**，不是绝对路径：期内产物（clip/、final/）相对
 * `projects/<episode_id>/`，跨期共享素材（music/、lut/、intro/、outro/）
 * 相对 `projects/`。绝对路径解析是 worker 的事（ADR-0004：engine 不碰 IO）。
 *
 * 不含超分：Real-ESRGAN 类放大是执行这份 plan **之前**的可选后期步骤，
 * 依赖 services/inference 的 /upscale 和 M0-4/#26 的关键帧分辨率结论，
 * 定了以后单独接，不塞进合成阶段。
 */
export interface ComposePlan {
  episode_id: string;
  /** 成片相对 key，约定为 final/<episode_id>.mp4（不进 schema，见 stages/compose.ts）。 */
  output_key: string;
  cuts: ShotCut[];
  music: ComposePlanMusic | null;
  /** 账号级 LUT（Persona.style.lut），只作用于正片，不作用于片头片尾。 */
  lut_key: string | null;
  intro_key: string | null;
  outro_key: string | null;
  title: string;
  title_style: string;
  /** 显式 AI 标识：画面水印开关（PRD §8）。 */
  ai_label: boolean;
  ai_label_text: string;
  /** 隐式 AI 标识：写进封装容器的元数据字段（PRD §8）。 */
  metadata: Record<string, string>;
  res: { w: number; h: number };
  fps: number;
}

export interface ComposePlanMusic {
  file_key: string;
  bpm: number;
  license: string;
}

export interface ComposeProvider {
  compose(input: { plan: ComposePlan }): Promise<{ output_key: string }>;
}
