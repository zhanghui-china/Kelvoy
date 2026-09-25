import type { Episode } from "../schema";
import { transitionEpisode } from "../state";
import type { StageContext } from "./types";

/** Validate the reference pack before any GPU work is queued. */
export async function runAssets(episode: Episode, _shotNo?: number, context?: StageContext): Promise<Episode> {
  if (episode.status !== "assets") throw new Error("assets 阶段状态不正确");
  if (episode.mode !== "per_shot") throw new Error("网格模式尚未完成，不能按逐镜模式生成");
  if (!context?.persona || !context.destination) throw new Error("assets 需要角色和目的地");
  if (context.persona.refs.length < 3) throw new Error("角色参考图不足 3 张");
  if (episode.shots.length === 0) throw new Error("分镜表为空");
  for (const shot of episode.shots) {
    if (!shot.landmark) continue;
    const landmark = context.destination.landmarks.find((item) => item.id === shot.landmark);
    if (!landmark || landmark.refs.length < 3) {
      throw new Error(`第 ${shot.no} 镜地标参考图不足，不能生成`);
    }
  }
  return { ...episode, status: transitionEpisode(episode.status, { type: "advance" }) };
}
