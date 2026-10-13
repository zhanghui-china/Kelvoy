import type { ProviderTally } from "@kelvoy/engine";

export interface UsageSummary {
  periods: { episode_id: string; destination_name: string; persona_name: string;
    name?: string; deleted?: boolean;
    created_at: string; shot_count: number; credits_used: number; cost_usd: number }[];
  providers: ProviderTally[];
  totals: { episodes: number; credits_used: number; cost_usd: number };
}

/**
 * 三视图生成（credit kind persona_view）的预估积分。占位值，与 store 的 DEFAULT_CREDIT_PRICES.persona_view 同为 3，
 * 待 GX10 实测校准。目前没有任何 /api/* 接口返回该单价（storyboard_prices 只含 script/image/video/compose），
 * 所以前端先用常量；服务端补价格接口后改为读取，并删除这里的常量。
 */
export const PERSONA_VIEW_CREDITS_ESTIMATE = 3;
