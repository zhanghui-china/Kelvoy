import { DEFAULT_CANDIDATES } from "../rules/credits";
import type { Episode } from "../schema";
import { transitionEpisode, transitionShot } from "../state";
import { generationSeed } from "./generation-seed";
import type { GeneratedAsset, StageContext } from "./types";

/** Generate two 9:16 candidates for one shot; worker owns inference and files. */
export async function runKeyframe(episode: Episode, shotNo?: number, context?: StageContext): Promise<Episode> {
  if (shotNo === undefined) throw new Error("keyframe 需要 shot_no");
  if (!context?.persona || !context.destination || !context.keyframe || !context.generation_id) {
    throw new Error("keyframe 需要角色、目的地和 Worker 推理能力");
  }
  const shot = episode.shots.find((item) => item.no === shotNo);
  if (!shot || shot.status !== "generating_kf") throw new Error(`第 ${shotNo} 镜未处于关键帧生成中`);
  const refs = [context.persona.refs[0]];
  if (!refs[0]) throw new Error("角色参考图缺失");
  if (shot.landmark) {
    const landmark = context.destination.landmarks.find((item) => item.id === shot.landmark);
    if (!landmark?.refs[0]) throw new Error(`第 ${shotNo} 镜地标参考图缺失`);
    refs.push(landmark.refs[0]);
  }
  const seed = generationSeed(context.generation_id, shotNo, "image");
  const generated: GeneratedAsset[] = [];
  for (let candidateNo = 0; candidateNo < DEFAULT_CANDIDATES; candidateNo++) {
    generated.push(await context.keyframe.generate({
      episode_id: episode.episode_id, shot_no: shotNo, candidate_no: candidateNo,
      prompt: shot.kf_prompt, refs, seed: (seed + candidateNo) >>> 0,
      generation_id: context.generation_id,
    }));
  }
  if (generated.some((item) => item.model !== generated[0]?.model || item.version !== generated[0]?.version)) {
    throw new Error("同一镜的候选使用了不同模型版本");
  }
  const first = generated[0]!;
  const updatedShot = {
    ...shot,
    status: transitionShot(shot.status, { type: "keyframe_ready" }),
    candidates: generated.map((item) => item.key),
    kf_selected: null,
    clip: null,
    regen_stage: null,
    model: { ...shot.model, image: {
      provider: "local" as const, model: first.model, version: first.version,
      seed: first.seed, prompt: shot.kf_prompt, ref_hashes: first.ref_hashes,
      attempts: context.attempt ?? 1, cost_usd: 0,
    } },
  };
  const shots = episode.shots.map((item) => item.no === shotNo ? updatedShot : item);
  const allReady = shots.every((item) => item.status === "kf_ready" || item.status === "kf_selected");
  const status = episode.status === "keyframing" && allReady
    ? transitionEpisode(episode.status, { type: "advance" }) : episode.status;
  return { ...episode, status, shots };
}
