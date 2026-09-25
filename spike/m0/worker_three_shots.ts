/** Technical three-shot Worker smoke in an isolated SQLite DB. No quality acceptance. */
import {
  close, dequeueTask, enqueueTask, getEpisode, insertEpisode, insertPersona,
  open, patchEpisode, patchShot, replaceEpisode, upsertDestination,
} from "../../packages/store/src/index";
import type { Episode, Shot } from "@kelvoy/engine";
import { handleTask } from "../../apps/worker/src/queue/consumer";

const root = process.env.KELVOY_PROJECTS_ROOT;
const personaKey = process.argv[2];
const landmarkKey = process.argv[3];
if (!root || !personaKey || !landmarkKey) {
  throw new Error("usage: KELVOY_PROJECTS_ROOT=... bun run spike/m0/worker_three_shots.ts <persona-key> <landmark-key>");
}

const id = `e_three_${Date.now()}`;
const dbPath = `/tmp/${id}.db`;
open(dbPath);
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
  const prompts = [
    ["旅行者站在真实的灵山大佛前，竖版中景，保持佛像和莲花座特征", "旅行者缓慢转身，镜头轻微推进"],
    ["旅行者沿灵山大佛前的步道前行，竖版远景，保留建筑和佛像特征", "旅行者向前走，镜头稳定跟随"],
    ["旅行者在灵山大佛旁停下看向远处，竖版近景，保持人物面部一致", "旅行者缓慢抬头，镜头轻微平移"],
  ];
  const shots: Shot[] = prompts.map(([kf, motion], index) => ({
    no: index + 1, scene: "s1", size: (["medium", "wide", "close"] as const)[index]!,
    beat: kf!, camera: "push", landmark: "l1", kf_prompt: kf!, motion_prompt: motion!,
    duration_s: 3, candidates: [], kf_selected: null, clip: null,
    trim_start_s: null, status: "draft", regen_stage: null, bad_shot_reported: false, model: {},
  }));
  const episode: Episode = {
    episode_id: id, owner_id: "smoke", persona_id: `${id}_p`, persona_version: 1,
    destination_id: `${id}_d`, destination_version: 1, series_id: id, template_id: "smoke",
    status: "assets", mode: "per_shot", created_at: new Date().toISOString(),
    estimated_credits: 0, credits_used: 0, share: { enabled: false, slug: "" },
    brief: { season: "秋", aspect: "9:16", duration_s: 30, tone: "", outfit_override: null, banned: [] },
    grid_refs: [], scenes: [], shots, removed_shots: [],
    music: { file: "", bpm: 0, license: "" },
    render: { res: "1080x1920", fps: 30, title: "", intro: null, outro: null, ai_label: true },
  };
  await insertEpisode(episode);
  await enqueueTask({ episode_id: id, stage: "assets" });
  const assets = await dequeueTask();
  if (!assets) throw new Error("assets task missing");
  await handleTask(assets);
  for (let no = 1; no <= shots.length; no++) {
    const task = await dequeueTask();
    if (task?.stage !== "keyframe" || task.shot_no !== no) throw new Error(`keyframe task ${no} missing`);
    await handleTask(task);
    const current = await getEpisode(id);
    if (!current.ok) throw new Error("episode missing");
    console.log(JSON.stringify({ stage: "keyframe", no, status: current.episode.status }));
  }
  let current = await getEpisode(id);
  if (!current.ok || current.episode.status !== "kf_review" ||
      current.episode.shots.some((shot) => shot.candidates.length !== 2)) {
    throw new Error("three keyframe reviews not ready");
  }
  for (const shot of current.episode.shots) {
    const selected = await patchShot(id, shot.no, current.row_version, {
      status: "kf_selected", kf_selected: shot.candidates[0]!,
    });
    if (!selected.ok) throw new Error(`select shot ${shot.no}: ${selected.error}`);
    current = await getEpisode(id);
    if (!current.ok) throw new Error("episode missing");
  }
  const clipping = await patchEpisode(id, current.row_version, { status: "clipping" });
  if (!clipping.ok) throw new Error(`clipping: ${clipping.error}`);
  for (const shot of shots) await enqueueTask({ episode_id: id, stage: "video", shot_no: shot.no });
  for (let no = 1; no <= shots.length; no++) {
    const task = await dequeueTask();
    if (task?.stage !== "video" || task.shot_no !== no) throw new Error(`video task ${no} missing`);
    await handleTask(task);
    const progress = await getEpisode(id);
    if (!progress.ok) throw new Error("episode missing");
    console.log(JSON.stringify({ stage: "video", no, status: progress.episode.status }));
  }
  current = await getEpisode(id);
  if (!current.ok || current.episode.status !== "clip_review" ||
      current.episode.shots.some((shot) => !shot.clip)) throw new Error("three clips not ready");

  // Request a new clip for one shot while retaining the other two outputs.
  const previous = current.episode.shots[1]!.clip;
  const rejected = await replaceEpisode(id, current.row_version, {
    ...current.episode,
    shots: current.episode.shots.map((shot) => shot.no === 2
      ? { ...shot, status: "rejected", regen_stage: "video" } : shot),
  });
  if (!rejected.ok) throw new Error(`reject shot 2: ${rejected.error}`);
  await enqueueTask({ episode_id: id, stage: "video", shot_no: 2 });
  const retry = await dequeueTask();
  if (retry?.stage !== "video" || retry.shot_no !== 2) throw new Error("regen task missing");
  await handleTask(retry);
  const finished = await getEpisode(id);
  if (!finished.ok || finished.episode.status !== "clip_review" ||
      finished.episode.shots[1]?.status !== "clip_ready" ||
      finished.episode.shots[1]?.clip === previous ||
      finished.episode.shots[0]?.clip !== current.episode.shots[0]?.clip ||
      finished.episode.shots[2]?.clip !== current.episode.shots[2]?.clip) {
    throw new Error("video regeneration did not preserve other shots");
  }
  console.log(JSON.stringify({ db: dbPath, episode_id: id, status: finished.episode.status,
    shots: finished.episode.shots.map((shot) => ({ no: shot.no, status: shot.status,
      candidates: shot.candidates, clip: shot.clip, model: shot.model })) }));
} finally {
  close();
}
