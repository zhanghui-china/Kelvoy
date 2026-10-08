import { type ContentViolation, type Destination, type ShotPatch,
  checkContent, editStoryboard, storyboardEditable, validStoryboardPatch, isLegalShotStatusChange, validatePatchShotRequest } from "@kelvoy/engine";
import { getDb } from "./db";
import { storyboardBusy } from "./storyboard";
import { decodeEpisode } from "./episode-codec";

export type ReviewShotPatchResult =
  | { ok: true; row_version: number }
  | { ok: false; error: "not_found" | "version_conflict" | "action_pending" |
      "invalid_public_patch" | "illegal_transition" | "destination_not_found" |
      "landmark_reference"; current_row_version?: number }
  | { ok: false; error: "content_blocked"; violations: ContentViolation[] };

/** The public review edit is checked against the latest owned episode in one write transaction. */
export function submitReviewShotPatch(input: {
  episode_id: string; owner_id: string; row_version: number; shot_no: number; patch: ShotPatch;
}): ReviewShotPatchResult {
  return getDb().transaction(() => {
    const row = getDb().query<{ doc: string; row_version: number }, [string, string]>(
      "select doc, row_version from episodes where episode_id = ? and owner_id = ?",
    ).get(input.episode_id, input.owner_id);
    if (!row || !Number.isInteger(input.shot_no)) return { ok: false, error: "not_found" } as const;
    if (row.row_version !== input.row_version) return { ok: false, error: "version_conflict",
      current_row_version: row.row_version } as const;
    const episode = decodeEpisode(row.doc);
    const index = episode.shots.findIndex((shot) => shot.no === input.shot_no);
    if (index < 0) return { ok: false, error: "not_found" } as const;
    if (episode.script_pending_task_id) return { ok: false, error: "action_pending" } as const;
    if (!validatePatchShotRequest({ row_version: input.row_version, patch: input.patch }).valid) {
      return { ok: false, error: "invalid_public_patch" } as const;
    }
    const patch = { ...input.patch };
    const shot = episode.shots[index]!;
    const keys = Object.keys(patch);
    const scriptFields = ["beat", "caption", "size", "camera", "landmark", "kf_prompt", "motion_prompt"];
    const scriptEdit = storyboardEditable(episode) && keys.every((key) => scriptFields.includes(key));
    if (keys.some(key => scriptFields.includes(key)) && storyboardBusy(input.episode_id)) return { ok:false,error:"action_pending" } as const;
    if (keys.some(key => scriptFields.includes(key)) && !scriptEdit) return {ok:false,error:"invalid_public_patch"} as const;
    const keyframeEdit = (episode.status === "kf_review" || episode.status === "keyframing") &&
      keys.every((key) => (episode.status === "keyframing"
        ? ["kf_selected", "status"] : ["kf_selected", "status", "kf_prompt", "motion_prompt"]).includes(key)) &&
      (patch.status === undefined || patch.status === "kf_selected") &&
      (patch.status === undefined || shot.status === "kf_ready") &&
      (patch.kf_selected === undefined ||
        (patch.kf_selected !== null && shot.candidates.includes(patch.kf_selected)));
    const clipEdit = episode.status === "clip_review" &&
      keys.every((key) => ["trim_start_s", "status"].includes(key)) &&
      (patch.status === undefined || (patch.status === "approved" && shot.status === "clip_ready"));
    if (keys.length === 0 || (!scriptEdit && !keyframeEdit && !clipEdit)) {
      return { ok: false, error: "invalid_public_patch" } as const;
    }
    if (patch.status && !isLegalShotStatusChange(shot.status, patch.status)) {
      return { ok: false, error: "illegal_transition" } as const;
    }
    const violations = checkContent([
      ...(patch.beat !== undefined ? [{ field: "beat", text: patch.beat }] : []),
      ...(patch.caption !== undefined ? [{ field: "caption", text: patch.caption }] : []),
      ...(patch.kf_prompt !== undefined ? [{ field: "kf_prompt", text: patch.kf_prompt }] : []),
      ...(patch.motion_prompt !== undefined ? [{ field: "motion_prompt", text: patch.motion_prompt }] : []),
    ]);
    if (violations.length > 0) return { ok: false, error: "content_blocked", violations } as const;
    if (patch.landmark !== undefined && patch.landmark !== null) {
      const revision = getDb().query<{ doc: string }, [string, number]>(
        "select doc from destination_versions where destination_id = ? and version = ?",
      ).get(episode.destination_id, episode.destination_version);
      if (!revision) return { ok: false, error: "destination_not_found" } as const;
      const destination = JSON.parse(revision.doc) as Destination;
      if (!destination.landmarks.some((landmark) => landmark.id === patch.landmark)) {
        return { ok: false, error: "landmark_reference" } as const;
      }
    }
    if (episode.cut_policy === "fixed_1s" && patch.trim_start_s !== undefined && patch.trim_start_s !== null) {
      patch.trim_start_s = Math.round(patch.trim_start_s * 30) / 30;
    }
    if (scriptEdit) {
      if (!validStoryboardPatch(patch)) return {ok:false,error:"invalid_public_patch"} as const;
      const updated = editStoryboard(episode, {type:"patch",shot_id:shot.shot_id!,patch});
      if (updated === episode) return {ok:true,row_version:row.row_version} as const;
      getDb().query("update episodes set doc = ?, row_version = row_version + 1, updated_at = datetime('now') where episode_id = ?").run(JSON.stringify(updated),input.episode_id);
      return {ok:true,row_version:row.row_version+1} as const;
    }
    const shots = [...episode.shots];
    shots[index] = { ...shot, ...patch };
    getDb().query(`update episodes set doc = ?, row_version = row_version + 1,
      updated_at = datetime('now') where episode_id = ?`)
      .run(JSON.stringify({ ...episode, shots }), input.episode_id);
    return { ok: true, row_version: row.row_version + 1 } as const;
  }).immediate();
}
