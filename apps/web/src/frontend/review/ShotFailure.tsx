import type { ShotFailureSummary } from "../api/client";

export function ShotFailureNotice({ shot, failures }: {
  shot?: { shot_id?: string; status: string };
  failures?: ShotFailureSummary[];
}) {
  if (shot?.status !== "failed") return null;
  const failure = failures?.find(item => item.shot_id === shot.shot_id);
  return <p className="k-error" role="alert">{failure?.message ?? "历史任务未记录具体原因"}</p>;
}
