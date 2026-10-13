// 三视图 job 的前端视图模型：与 GET /api/personas/:id/views/jobs/:job_id 的 `job` 对应，
// 只保留前端用到的字段（不 import @kelvoy/store，前端不依赖持久化模型）。
export type ViewsJobStatus = "pending" | "processing" | "succeeded" | "failed" | "cancelled";

export interface ViewsJobView {
  job_id: string;
  persona_id: string;
  /** null = 默认穿搭。 */
  outfit_id: string | null;
  status: ViewsJobStatus;
  attempt: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export function isViewsJobActive(job: Pick<ViewsJobView, "status">): boolean {
  return job.status === "pending" || job.status === "processing";
}
