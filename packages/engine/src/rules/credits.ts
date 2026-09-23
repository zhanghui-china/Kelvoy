import type { Episode } from "../schema/episode";

/**
 * FR-01/FR-09 超额拦截估价：镜数 × 候选数 × 单位成本 × 1.5（PRD v0.2 附录，
 * "回填占位数字"对照表）。单位成本和候选数常量卡 M0-6（模型评测 + 定价回填
 * 之后才有真实数字），这里先留函数签名，函数体不写假公式——M2-5(#21)的
 * POST /api/episodes 直接把 estimated_credits 定死填 0,不调用这个函数。
 */
export function estimateCredits(_episode: Episode): number {
  throw new Error("not implemented");
}
