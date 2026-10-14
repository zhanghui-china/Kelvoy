import type { Episode } from "../schema";
import { SETTINGS_CANDIDATES_MAX, SETTINGS_CANDIDATES_MIN } from "../schema/user";
import { transitionEpisode, transitionShot } from "../state";
import { generationSeed } from "./generation-seed";
import { keyframeReferences } from "./keyframe-references";
import { buildKeyframePrompt } from "./keyframe-prompt";
import type { GeneratedAsset, StageContext } from "./types";

/** Generate the episode's saved candidate count for one shot. */
export async function runKeyframe(episode: Episode, shotNo?: number, context?: StageContext): Promise<Episode> {
  if (shotNo === undefined) throw new Error("keyframe 需要 shot_no");
  if (!context?.persona || !context.destination || !context.keyframe || !context.generation_id) {
    throw new Error("keyframe 需要角色、目的地和 Worker 推理能力");
  }
  const candidateCount = episode.candidate_count ?? 2;
  if (!Number.isInteger(candidateCount) || candidateCount < SETTINGS_CANDIDATES_MIN || candidateCount > SETTINGS_CANDIDATES_MAX) {
    throw new Error(`candidate_count 必须是 ${SETTINGS_CANDIDATES_MIN}–${SETTINGS_CANDIDATES_MAX} 的整数`);
  }
  const shot = episode.shots.find((item) => (context?.shot_id ? item.shot_id === context.shot_id : item.no === shotNo));
  if (!shot || shot.status !== "generating_kf") throw new Error(`第 ${shotNo} 镜未处于关键帧生成中`);
  const used = keyframeReferences(context.persona, context.destination, shot, episode.brief.outfit_id);
  if (!used.persona && !used.person_omitted) throw new Error("角色参考图缺失");
  if (used.landmark_id && !used.landmark && !used.landmark_skipped) throw new Error(`第 ${shotNo} 镜地标参考图缺失`);
  const refs = [...(used.persona ? [used.persona.key] : []), ...(used.landmark ? [used.landmark.key] : [])];
  // What the model is told, not just the script's kf_prompt: image roles are named (ADR-0016).
  const prompt = buildKeyframePrompt({ kf_prompt: shot.kf_prompt, landmarkName: used.landmark?.name ?? null,
    personOmitted: used.person_omitted, personKind: used.persona?.kind ?? "photo" });
  const seed = generationSeed(context.generation_id, shot.shot_id ?? shotNo, "image");
  const generated: GeneratedAsset[] = [];
  for (let candidateNo = 0; candidateNo < candidateCount; candidateNo++) {
    context.signal?.throwIfAborted();
    generated.push(await context.keyframe.generate({
      episode_id: episode.episode_id, shot_no: shotNo,
      ...(shot.shot_id ? { shot_id: shot.shot_id } : {}), candidate_no: candidateNo,
      aspect: episode.brief.aspect,
      prompt, refs, seed: (seed + candidateNo) >>> 0,
      generation_id: context.generation_id,
      ...(context.execution_id ? { execution_id: context.execution_id } : {}),
      ...(context.signal ? { signal: context.signal } : {}),
    }));
  }
  context.signal?.throwIfAborted();
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
      seed: first.seed, prompt, ref_hashes: first.ref_hashes,
      ...(used.landmark ? { landmark_ref_key: used.landmark.key } : {}),
      attempts: context.attempt ?? 1, cost_usd: 0,
    } },
  };
  const shots = episode.shots.map((item) => (context?.shot_id ? item.shot_id === context.shot_id : item.no === shotNo) ? updatedShot : item);
  const allReady = shots.every((item) => item.status === "kf_ready" || item.status === "kf_selected" || (!!item.clip && (item.status === "approved" || item.status === "clip_ready")));
  const status = episode.status === "keyframing" && allReady
    ? transitionEpisode(episode.status, { type: "advance" }) : episode.status;
  return { ...episode, status, shots };
}
