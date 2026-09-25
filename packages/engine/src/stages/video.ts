import type { Episode } from "../schema";
import { transitionEpisode, transitionShot } from "../state";
import { generationSeed } from "./generation-seed";
import type { StageContext } from "./types";

/** Generate one clip from a reviewed keyframe. */
export async function runVideo(episode: Episode, shotNo?: number, context?: StageContext): Promise<Episode> {
  if (shotNo === undefined) throw new Error("video 需要 shot_no");
  if (!context?.video || !context.generation_id) throw new Error("video 需要 Worker 推理能力");
  const shot = episode.shots.find((item) => item.no === shotNo);
  if (!shot || shot.status !== "generating_clip") throw new Error(`第 ${shotNo} 镜未处于视频生成中`);
  if (!shot.kf_selected || !shot.candidates.includes(shot.kf_selected)) {
    throw new Error(`第 ${shotNo} 镜未选中有效关键帧`);
  }
  const seed = generationSeed(context.generation_id, shotNo, "video");
  const generated = await context.video.generate({
    episode_id: episode.episode_id, shot_no: shotNo, keyframe: shot.kf_selected,
    prompt: shot.motion_prompt, duration_s: Math.max(3, Math.min(5, Math.ceil(shot.duration_s))),
    seed, generation_id: context.generation_id,
  });
  const updatedShot = {
    ...shot,
    status: transitionShot(shot.status, { type: "clip_ready" }),
    clip: generated.key,
    regen_stage: null,
    model: { ...shot.model, video: {
      provider: "local" as const, model: generated.model, version: generated.version,
      seed: generated.seed, prompt: shot.motion_prompt, ref_hashes: generated.ref_hashes,
      attempts: context.attempt ?? 1, cost_usd: 0,
    } },
  };
  const shots = episode.shots.map((item) => item.no === shotNo ? updatedShot : item);
  const allReady = shots.every((item) => item.status === "clip_ready" || item.status === "approved");
  const status = episode.status === "clipping" && allReady
    ? transitionEpisode(episode.status, { type: "advance" }) : episode.status;
  return { ...episode, status, shots };
}
