import { ContentBlockedError, suggestStoryboardShot, type StageContext, type Task } from "@kelvoy/engine";
import { completeStoryboardSuggestion, failTaskWithCredits, getDestinationVersion, getEpisode,
  getPersonaVersion, renewTaskLease } from "@kelvoy/store";

/** Uses the normal queue lease, frozen versions, HTTP provider and script credit action. */
export async function handleStoryboardSuggestion(task: Task, overrides: Partial<StageContext> = {}): Promise<void> {
  try {
    if (overrides.signal?.aborted) return;
    if (task.lease_token && !await renewTaskLease(task.task_id, task.lease_token)) return;
    const current = await getEpisode(task.episode_id);
    if (!current.ok) throw new Error("episode missing");
    const [destination, persona] = await Promise.all([
      getDestinationVersion(current.episode.destination_id, current.episode.destination_version),
      getPersonaVersion(current.episode.persona_id, current.episode.persona_version),
    ]);
    if (!destination || !persona || !task.payload_json) throw new Error("suggestion context missing");
    const suggestion = await suggestStoryboardShot(JSON.parse(task.payload_json), current.episode,
      destination, persona, overrides.signal);
    if (overrides.signal?.aborted) return;
    if (task.lease_token && !await renewTaskLease(task.task_id, task.lease_token)) return;
    completeStoryboardSuggestion(task, suggestion);
  } catch (error) {
    if (overrides.signal?.aborted) return;
    if (task.lease_token && !await renewTaskLease(task.task_id, task.lease_token)) return;
    const retry = !(error instanceof ContentBlockedError) && task.attempt < 2;
    failTaskWithCredits(task, retry, "镜头建议生成失败，积分已退回，请检查描述后重试。");
  }
}
