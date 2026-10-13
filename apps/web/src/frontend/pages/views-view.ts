import type { Persona, PersonaOutfit, ThreeViews, ViewsStatus } from "@kelvoy/engine";
import { isViewsJobActive, type ViewsJobView } from "../../shared/views-job";

/** 三视图的目标：outfit 为 null = 默认穿搭（三视图记在角色自身，全身照是 refs[0]）。 */
export interface ViewsTargetState {
  /** 用于生成的全身照 key；旧式穿搭没有，不支持三视图。 */
  source: string | undefined;
  status: ViewsStatus;
  views: ThreeViews | undefined;
}

export function viewsTargetState(persona: Persona, outfit: PersonaOutfit | null): ViewsTargetState {
  if (!outfit) return { source: persona.refs[0], status: persona.views_status ?? "none", views: persona.views };
  return { source: outfit.source, status: outfit.views_status ?? "none", views: outfit.views };
}

/** 只认 job 自己的失败原因；没有则给一句不带内部细节的兜底。 */
export function viewsFailureReason(job: ViewsJobView | null): string {
  return job?.status === "failed" && job.error ? job.error : "生成没有成功，预留的积分已退回。";
}

/** 进度文案：排队 / 生成中（第 n 次尝试）。 */
export function viewsProgressText(job: ViewsJobView | null): string {
  if (!job || !isViewsJobActive(job)) return "三视图生成中，通常需要几分钟，可以离开此页。";
  const retry = job.attempt > 1 ? `（第 ${job.attempt} 次尝试）` : "";
  return job.status === "pending" ? `排队中，等待生成服务领取${retry}…` : `正在生成正 / 侧 / 背三视图${retry}…`;
}

/** 从 job 列表（按创建时间倒序）里挑出该目标最该展示的一条：pending 取在途，failed 取最近失败。 */
export function pickJobForTarget(jobs: ViewsJobView[], outfitId: string | null, status: ViewsStatus): ViewsJobView | null {
  const mine = jobs.filter((j) => j.outfit_id === outfitId);
  if (status === "pending") return mine.find(isViewsJobActive) ?? null;
  if (status === "failed") return mine.find((j) => j.status === "failed") ?? null;
  return null;
}
