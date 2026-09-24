import type { Episode, EpisodeMode } from "../schema/episode";

/**
 * FR-01/FR-09 提交前粗估：镜数 × 候选数 × 单位成本 × 1.5 返工系数
 * （PRD v0.2 §14 表格原文）。"单位成本"拆成关键帧 + 视频两段 GPU 分钟数，
 * 网格模式（EpisodeMode "grid"）省去逐镜单独出关键帧这一步（§4），关键帧
 * 部分按逐镜模式打五折，视频部分两种模式一样。
 *
 * 下面每个常量都是 M0-6(#6) 占位——模型选型 + Spark 实测每镜 GPU 分钟数
 * 之前先用最佳判断填数，回填时只改这几个常量，不改这份公式/breakdown 形状
 * （CLAUDE.md"没有结论的地方按最佳判断做完整设计"）。
 */

// M0-6(#6) 占位，实测后回填：默认镜数，取 PRD"24–30 镜"的中值。
export const DEFAULT_SHOT_COUNT = 28;

// M0-6(#6) 占位，实测后回填：默认候选数，FR-04 原文"每镜 N 候选（默认 2）"。
export const DEFAULT_CANDIDATES = 2;

// M0-6(#6) 占位，实测后回填：逐镜模式下单个候选出一次关键帧的 GPU 分钟数。
export const KEYFRAME_GPU_MINUTES_PER_CANDIDATE = 1.5;

// M0-6(#6) 占位，实测后回填：单个候选出一次视频片段的 GPU 分钟数（两种
// 模式都要走这一步，网格模式不省视频生成）。
export const VIDEO_GPU_MINUTES_PER_CANDIDATE = 2;

// PRD §4：网格模式直出关键帧网格图，比逐镜模式少一步单独关键帧生成，
// 关键帧部分的 GPU 分钟按逐镜模式打五折算。
export const GRID_MODE_KEYFRAME_DISCOUNT = 0.5;

// FR-09/§14 原文"× 1.5 返工系数"。
export const REWORK_FACTOR = 1.5;

export interface EstimateCostInput {
  /** 缺省时用 DEFAULT_SHOT_COUNT——建期这一步脚本还没生成，没有真实镜数。 */
  shot_count?: number;
  /** 缺省时用 DEFAULT_CANDIDATES。 */
  candidates?: number;
  mode: EpisodeMode;
}

export interface EstimateCostBreakdown {
  shot_count: number;
  candidates: number;
  keyframe_gpu_minutes: number;
  video_gpu_minutes: number;
  rework_factor: number;
}

export interface EstimateCostResult {
  gpu_minutes: number;
  // §6："当前阶段填的是成本估算的等价值"——积分汇率待 M0-6/商业化阶段
  // 才定，当前阶段 estimated_credits 直接等于 gpu_minutes。
  estimated_credits: number;
  breakdown: EstimateCostBreakdown;
}

export function estimateCost(input: EstimateCostInput): EstimateCostResult {
  const shotCount = input.shot_count ?? DEFAULT_SHOT_COUNT;
  const candidates = input.candidates ?? DEFAULT_CANDIDATES;

  const keyframeUnitMinutes =
    KEYFRAME_GPU_MINUTES_PER_CANDIDATE * (input.mode === "grid" ? GRID_MODE_KEYFRAME_DISCOUNT : 1);
  const keyframeGpuMinutes = shotCount * candidates * keyframeUnitMinutes;
  const videoGpuMinutes = shotCount * candidates * VIDEO_GPU_MINUTES_PER_CANDIDATE;

  const gpuMinutes = (keyframeGpuMinutes + videoGpuMinutes) * REWORK_FACTOR;

  return {
    gpu_minutes: gpuMinutes,
    estimated_credits: gpuMinutes,
    breakdown: {
      shot_count: shotCount,
      candidates,
      keyframe_gpu_minutes: keyframeGpuMinutes,
      video_gpu_minutes: videoGpuMinutes,
      rework_factor: REWORK_FACTOR,
    },
  };
}

/**
 * POST /api/episodes 建期时用：这一刻 episode.shots 还是空数组（脚本要到
 * brief 任务跑完才有），所以镜数落回默认值，只有 mode 是真实输入。
 */
export function estimateCredits(episode: Pick<Episode, "shots" | "mode">): number {
  const shotCount = episode.shots.length > 0 ? episode.shots.length : undefined;
  return estimateCost({ shot_count: shotCount, mode: episode.mode }).estimated_credits;
}
