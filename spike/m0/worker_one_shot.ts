/** Technical Worker smoke against a separate SQLite DB. Never use for M0 quality acceptance. */
import { close, dequeueTask, enqueueTask, getEpisode, insertEpisode, insertPersona,
  open, patchEpisode, patchShot, upsertDestination } from "../../packages/store/src/index";
import type { Episode, Shot } from "@kelvoy/engine";
import { handleTask } from "../../apps/worker/src/queue/consumer";

const root = process.env.KELVOY_PROJECTS_ROOT;
if (!root) throw new Error("KELVOY_PROJECTS_ROOT required");
const personaKey = process.argv[2];
const landmarkKey = process.argv[3];
if (!personaKey || !landmarkKey) {
  throw new Error("usage: bun run spike/m0/worker_one_shot.ts <persona-key> <landmark-key>");
}

const id = `e_smoke_${Date.now()}`;
open(`/tmp/${id}.db`);
try {
  await insertPersona({
    persona_id: `${id}_p`, owner_id: "smoke", version: 1, name: "测试角色", desc: "",
    locked: [], default_outfit: "", refs: [personaKey, personaKey, personaKey],
    style: { lut: "", title_style: "" },
  });
  await upsertDestination({
    destination_id: `${id}_d`, version: 1, name: "测试地标", city: "无锡",
    type: "scenic_area", season_best: [], route: [], food: [], transport: "", stay: "",
    landmarks: [{ id: "l1", name: "灵山大佛", refs: [landmarkKey, landmarkKey, landmarkKey],
      best_time: "上午" }],
  });
  const shot: Shot = {
    no: 1, scene: "s1", size: "medium", beat: "角色站在地标前", camera: "push",
    landmark: "l1", kf_prompt: "一位旅行者站在真实的灵山大佛前，保持大佛和莲花座的特征，竖版构图",
    motion_prompt: "旅行者缓慢转身，镜头轻微推进，保持人物和大佛稳定",
    duration_s: 1.5, candidates: [], kf_selected: null, clip: null,
    trim_start_s: null, status: "draft", regen_stage: null, bad_shot_reported: false, model: {},
  };
  const episode: Episode = {
    episode_id: id, owner_id: "smoke", persona_id: `${id}_p`, persona_version: 1,
    destination_id: `${id}_d`, destination_version: 1, series_id: id, template_id: "smoke",
    status: "assets", mode: "per_shot", created_at: new Date().toISOString(),
    estimated_credits: 0, credits_used: 0, share: { enabled: false, slug: "" },
    brief: { season: "秋", aspect: "9:16", duration_s: 30, tone: "", outfit_override: null, banned: [] },
    grid_refs: [], scenes: [], shots: [shot], removed_shots: [],
    music: { file: "", bpm: 0, license: "" },
    render: { res: "1080x1920", fps: 30, title: "", intro: null, outro: null, ai_label: true },
  };
  await insertEpisode(episode);
  await enqueueTask({ episode_id: id, stage: "assets" });
  const assets = await dequeueTask();
  if (!assets) throw new Error("assets task missing");
  await handleTask(assets);
  const keyframe = await dequeueTask();
  if (!keyframe || keyframe.stage !== "keyframe") throw new Error("keyframe task missing");
  await handleTask(keyframe);
  const reviewed = await getEpisode(id);
  if (!reviewed.ok || reviewed.episode.status !== "kf_review" ||
      reviewed.episode.shots[0]?.candidates.length !== 2) {
    throw new Error("keyframe review state not reached");
  }
  const chosen = reviewed.episode.shots[0].candidates[0]!;
  const selected = await patchShot(id, 1, reviewed.row_version, { status: "kf_selected", kf_selected: chosen });
  if (!selected.ok) throw new Error(`selection failed: ${selected.error}`);
  const clipping = await patchEpisode(id, selected.row_version, { status: "clipping" });
  if (!clipping.ok) throw new Error(`continue failed: ${clipping.error}`);
  await enqueueTask({ episode_id: id, stage: "video", shot_no: 1 });
  const video = await dequeueTask();
  if (!video) throw new Error("video task missing");
  await handleTask(video);
  const finished = await getEpisode(id);
  if (!finished.ok || finished.episode.status !== "clip_review" || !finished.episode.shots[0]?.clip) {
    throw new Error("clip review state not reached");
  }
  console.log(JSON.stringify({ db: `/tmp/${id}.db`, episode_id: id,
    status: finished.episode.status, shot: finished.episode.shots[0] }));
} finally {
  close();
}
