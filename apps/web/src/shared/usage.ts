import type { ProviderTally } from "@kelvoy/engine";

export interface UsageSummary {
  periods: { episode_id: string; destination_name: string; persona_name: string;
    created_at: string; shot_count: number; credits_used: number; cost_usd: number }[];
  providers: ProviderTally[];
  totals: { episodes: number; credits_used: number; cost_usd: number };
}
