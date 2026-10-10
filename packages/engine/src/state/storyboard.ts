import { checkContent } from "../rules/content";
import type { Destination } from "../schema/destination";
import type { Episode, ShotDraft, StoryboardPatch, Shot } from "../schema";

const FIELDS = ["scene", "size", "beat", "caption", "camera", "landmark", "kf_prompt", "motion_prompt"] as const;
const VISUAL = ["scene", "size", "beat", "camera", "landmark", "kf_prompt"] as const;
export function storyboardEditable(episode: Episode): boolean {
  return episode.mode === "per_shot" && ["script_review", "assets", "keyframing", "kf_review", "clipping", "clip_review", "compose_ready", "composing", "done", "failed"].includes(episode.status);
}
export function validStoryboardPatch(value: unknown, complete = false): value is StoryboardPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const patch = value as Record<string, unknown>;
  if (Object.keys(patch).some(key => !FIELDS.includes(key as typeof FIELDS[number]))) return false;
  if (complete && FIELDS.filter(key => key !== "caption").some(key => !(key in patch))) return false;
  for (const [key, val] of Object.entries(patch)) {
    if (key === "landmark") { if (val !== null && typeof val !== "string") return false; }
    else if (typeof val !== "string") return false;
    if (typeof val === "string" && (val.length > (key === "caption" ? 120 : 2000) || (["beat", "kf_prompt", "motion_prompt"].includes(key) && !val.trim()))) return false;
  }
  if (patch.size !== undefined && !["wide", "medium", "close", "detail", "pov"].includes(patch.size as string)) return false;
  if (patch.camera !== undefined && !["static", "pan", "push", "follow"].includes(patch.camera as string)) return false;
  return true;
}
export type StoryboardEdit =
  | { type: "insert"; after_shot_id: string | null; shot: ShotDraft; shot_id: string }
  | { type: "patch"; shot_id: string; patch: StoryboardPatch }
  | { type: "remove"; shot_id: string }
  | { type: "reorder"; order: string[] };
export function editStoryboard(episode: Episode, edit: StoryboardEdit): Episode {
  let shots = [...episode.shots];
  let removed = [...episode.removed_shots];
  let scenes = episode.scenes;
  if (edit.type === "insert") {
    const index = edit.after_shot_id === null ? -1 : shots.findIndex(s => s.shot_id === edit.after_shot_id);
    if (edit.after_shot_id !== null && index < 0) throw new Error("not_found");
    if (!scenes.length) scenes = [{ id: "scene_default", name: "默认场景", time: "morning", landmarks: [] }];
    const draft = { ...edit.shot, scene: edit.shot.scene || scenes[0].id };
    if (!scenes.some(s => s.id === draft.scene)) throw new Error("invalid_scene");
    shots.splice(index + 1, 0, { ...draft, shot_id: edit.shot_id, no: 0, duration_s: episode.cut_policy === "long_3_6" ? 4 : 1,
      candidates: [], kf_selected: null, clip: null, trim_start_s: null, status: "draft",
      regen_stage: null, bad_shot_reported: false, model: {} });
  } else if (edit.type === "reorder") {
    if (edit.order.length !== shots.length || new Set(edit.order).size !== shots.length) throw new Error("invalid_order");
    shots = edit.order.map(id => { const shot = shots.find(s => s.shot_id === id); if (!shot) throw new Error("invalid_order"); return shot; });
  } else {
    const index = shots.findIndex(s => s.shot_id === edit.shot_id);
    if (index < 0) throw new Error("not_found");
    if (edit.type === "remove") removed.push(...shots.splice(index, 1));
    else {
      const shot = shots[index];
      if (edit.patch.scene !== undefined && !scenes.some(s => s.id === edit.patch.scene)) throw new Error("invalid_scene");
      const updated: Shot = { ...shot, ...edit.patch };
      if (VISUAL.some(key => updated[key] !== shot[key])) Object.assign(updated, {
        candidates: [], kf_selected: null, clip: null, trim_start_s: null, model: {}, status: "draft", regen_stage: null });
      else if (updated.motion_prompt !== shot.motion_prompt) Object.assign(updated, {
        clip: null, trim_start_s: null, model: { ...(shot.model.image ? { image: shot.model.image } : {}) },
        status: episode.video_source === "references" ? "draft" : shot.kf_selected ? "kf_selected" : shot.candidates.length ? "kf_ready" : "draft", regen_stage: null });
      shots[index] = updated;
    }
  }
  shots = shots.map((shot, index) => ({ ...shot, no: index + 1 }));
  if (JSON.stringify(shots) === JSON.stringify(episode.shots) && JSON.stringify(scenes) === JSON.stringify(episode.scenes)) return episode;
  return { ...episode, shots, scenes, removed_shots: removed, status: "script_review",
    ...(episode.final ? { final_needs_recompose: true, shared_storyboard: episode.shared_storyboard ?? { shots: episode.shots, scenes: episode.scenes } } : {}) };
}

export function validateStoryboardFields(episode: Episode, fields: unknown, destination: Destination | null, complete = false): string[] {
  if (!validStoryboardPatch(fields, complete)) return ["invalid_fields"];
  const errors: string[] = [];
  if (fields.scene !== undefined && !(complete && !episode.scenes.length && !fields.scene) && !episode.scenes.some(scene => scene.id === fields.scene)) errors.push("invalid_scene");
  if (fields.landmark && (!destination || !destination.landmarks.some(landmark => landmark.id === fields.landmark))) errors.push("invalid_landmark");
  if (checkContent(Object.entries(fields).filter(([, value]) => typeof value === "string").map(([field, value]) => ({field,text:value as string}))).length) errors.push("content_blocked");
  return errors;
}
