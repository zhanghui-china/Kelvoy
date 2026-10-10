import type { Episode } from "../schema";
import { transitionEpisode, transitionShot } from "../state";
import { generationSeed } from "./generation-seed";
import type { StageContext } from "./types";

/** Generate one clip from a reviewed keyframe. */
export async function runVideo(episode: Episode, shotNo?: number, context?: StageContext): Promise<Episode> {
  if (shotNo === undefined) throw new Error("video 需要 shot_no");
  if (!context?.video || !context.generation_id) throw new Error("video 需要 Worker 推理能力");
  if (!context.h3PromptWriter) throw new Error("video 需要 H3 提示词改写能力");
  context.signal?.throwIfAborted();
  const shot = episode.shots.find((item) => (context?.shot_id ? item.shot_id === context.shot_id : item.no === shotNo));
  if (!shot || shot.status !== "generating_clip") throw new Error(`第 ${shotNo} 镜未处于视频生成中`);
  const direct = episode.video_source === "references";
  if (!direct && (!shot.kf_selected || !shot.candidates.includes(shot.kf_selected))) {
    throw new Error(`第 ${shotNo} 镜未选中有效关键帧`);
  }
  if (direct && (!context.persona || !context.destination)) {
    throw new Error("视频直出需要角色和目的地参考图");
  }
  const landmark = context?.destination?.landmarks.find((item) => item.id === shot.landmark)
    ?? context?.destination?.landmarks[0];
  const personRef = context.persona?.refs[0];
  const sceneRef = landmark?.refs[0];
  if (direct && (!personRef || !sceneRef)) throw new Error(`第 ${shotNo} 镜缺少人物或场景参考图`);
  const refs = direct ? [personRef!, sceneRef!] : undefined;
  const duration_s = Math.max(4, Math.min(5, Math.ceil(shot.duration_s)));
  const rewritten = await context.h3PromptWriter.write({ episode_id: episode.episode_id,
    context: { mode: direct ? "Ref2VA" : "I2VA", aspect: episode.brief.aspect, duration_s,
      size: shot.size, camera: shot.camera, beat: shot.beat,
      kf_prompt: shot.kf_prompt, motion_prompt: shot.motion_prompt,
      scene: episode.scenes.find(item => item.id === shot.scene) ?? null,
      destination: context.destination?.name ?? null, landmark: landmark?.name ?? null,
      references: direct ? refs!.map((key, index) => ({ key, role: index === 0 ? "person" as const : "scene" as const, picture: index + 1 }))
        : [{ key: `${episode.episode_id}/${shot.kf_selected!}`, role: "first_frame", picture: 1 }],
    }, ...(context.signal ? { signal: context.signal } : {}) });
  context.signal?.throwIfAborted();
  const prompt = rewritten.prompt;
  const seed = generationSeed(context.generation_id, shot.shot_id ?? shotNo, "video");
  const generated = await context.video.generate({
    episode_id: episode.episode_id, shot_no: shotNo,
      ...(shot.shot_id ? { shot_id: shot.shot_id } : {}),
    ...(direct ? { refs } : { keyframe: shot.kf_selected! }),
    aspect: episode.brief.aspect,
    prompt, duration_s, expected_ref_hashes: rewritten.provenance.ref_hashes,
    seed, generation_id: context.generation_id,
    ...(context.execution_id ? { execution_id: context.execution_id } : {}),
    ...(context.signal ? { signal: context.signal } : {}),
  });
  context.signal?.throwIfAborted();
  const updatedShot = {
    ...shot,
    status: transitionShot(shot.status, { type: "clip_ready" }),
    clip: generated.key,
    regen_stage: null,
    model: { ...shot.model, video: {
      provider: "local" as const, model: generated.model, version: generated.version,
      seed: generated.seed, prompt, h3_prompt: rewritten.provenance, ref_hashes: generated.ref_hashes,
      attempts: context.attempt ?? 1, cost_usd: 0,
    } },
  };
  const shots = episode.shots.map((item) => (context?.shot_id ? item.shot_id === context.shot_id : item.no === shotNo) ? updatedShot : item);
  const allReady = shots.every((item) => item.status === "clip_ready" || item.status === "approved");
  const status = episode.status === "clipping" && allReady
    ? transitionEpisode(episode.status, { type: "advance" }) : episode.status;
  return { ...episode, status, shots };
}
