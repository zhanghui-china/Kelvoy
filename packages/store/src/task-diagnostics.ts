import type { Episode } from "@kelvoy/engine";
import { getCreditAction } from "./credits";
import { getDb } from "./db";

/** Only safe provider messages belong here; raw prompts and responses never do. */
export interface TaskDiagnostic {
  stage: string;
  code: string;
  message: string;
  elapsed_seconds: number;
  budget_seconds: number;
  cancellation: "confirmed" | "unconfirmed" | "failed" | "not_needed";
}

export interface ShotFailure {
  shot_id: string;
  code: string;
  message: string;
}

function decodeDiagnostic(error: string | null): TaskDiagnostic | null {
  if (!error) return null;
  try {
    const value: unknown = JSON.parse(error);
    if (!value || typeof value !== "object") return null;
    const item = value as Partial<TaskDiagnostic>;
    return typeof item.code === "string" && typeof item.message === "string" &&
      typeof item.stage === "string" && typeof item.elapsed_seconds === "number" &&
      typeof item.budget_seconds === "number" ? item as TaskDiagnostic : null;
  } catch { return null; }
}

/** Called only after the route establishes episode ownership. Match stable IDs before legacy numbers. */
export async function getShotFailures(episode: Episode): Promise<ShotFailure[]> {
  const failures = getDb().query<{ task_id: string; shot_id: string | null; shot_no: number | null; error: string | null }, [string]>(
    `select failed.task_id, failed.shot_id, failed.shot_no, failed.error
     from tasks as failed where failed.episode_id = ? and failed.status = 'failed'
       and failed.stage in ('keyframe', 'video') and failed.operation is null
       and not exists (select 1 from tasks as active where active.episode_id = failed.episode_id
         and active.stage = failed.stage and active.status in ('pending', 'processing', 'held')
         and ((failed.shot_id is not null and active.shot_id = failed.shot_id)
           or (failed.shot_id is null and active.shot_no is failed.shot_no)))
     order by failed.updated_at desc, failed.rowid desc`,
  ).all(episode.episode_id);
  const result: ShotFailure[] = [];
  for (const shot of episode.shots) {
    if (shot.status !== "failed" || !shot.shot_id) continue;
    const failure = failures.find(item => item.shot_id ? item.shot_id === shot.shot_id : item.shot_no === shot.no);
    if (!failure) continue;
    const diagnostic = decodeDiagnostic(failure.error);
    const refunded = getCreditAction(failure.task_id)?.status === "released";
    result.push({ shot_id: shot.shot_id, code: diagnostic?.code ?? "unknown",
      message: (diagnostic?.message ?? "历史任务未记录具体原因") + (refunded ? "，积分已退回" : "") });
  }
  return result;
}
