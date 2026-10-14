import { test, expect } from "bun:test";
import { editStoryboard, validateStoryboardFields, validStoryboardPatch } from "./storyboard";
import type { Episode, Shot } from "../schema";
const shot: Shot = { shot_id:"sh_a",no:1,scene:"scene",size:"wide",beat:"walk",camera:"static",landmark:null,kf_prompt:"image",motion_prompt:"move",duration_s:1,candidates:["kf/01.png"],kf_selected:"kf/01.png",clip:"clip/01.mp4",trim_start_s:0,status:"approved",regen_stage:null,bad_shot_reported:false,model:{} };
const fixture = (): Episode => ({episode_id:"ep",mode:"per_shot",status:"done",scenes:[{id:"scene",name:"Scene",time:"morning",landmarks:[]}],shots:[{...shot}],removed_shots:[],final:{key:"final/old.mp4"}} as unknown as Episode);
test("caption edit retains products and freezes the old shared storyboard", () => {
 const before=fixture(); const after=editStoryboard(before,{type:"patch",shot_id:"sh_a",patch:{caption:"new"}});
 expect(after.shots[0].clip).toBe(shot.clip); expect(after.status).toBe("script_review");
 expect(after.final_needs_recompose).toBe(true); expect(after.shared_storyboard?.shots[0].caption).toBeUndefined();
 expect(before.shots[0].caption).toBeUndefined();
});
test("visual changes clear products; motion changes preserve selected frame", () => {
 const visual=editStoryboard(fixture(),{type:"patch",shot_id:"sh_a",patch:{scene:"scene",beat:"jump"}}).shots[0];
 expect(visual.candidates).toEqual([]); expect(visual.clip).toBeNull(); expect(visual.status).toBe("draft");
 const motion=editStoryboard(fixture(),{type:"patch",shot_id:"sh_a",patch:{motion_prompt:"turn"}}).shots[0];
 expect(motion.kf_selected).toBe(shot.kf_selected); expect(motion.clip).toBeNull(); expect(motion.status).toBe("kf_selected");
});
test("no-op retains episode and deletion retains historical media even for last shot", () => {
 const before=fixture(); expect(editStoryboard(before,{type:"patch",shot_id:"sh_a",patch:{beat:"walk"}})).toBe(before);
 const removed=editStoryboard(before,{type:"remove",shot_id:"sh_a"}); expect(removed.shots).toEqual([]); expect(removed.removed_shots[0].clip).toBe(shot.clip);
});
test("reordering keeps identity and artifact keys; invalid requests are rejected", () => {
 const before=fixture(); before.shots.push({...shot,shot_id:"sh_b",no:2});
 const after=editStoryboard(before,{type:"reorder",order:["sh_b","sh_a"]});
 expect(after.shots.map(s=>[s.shot_id,s.no])).toEqual([["sh_b",1],["sh_a",2]]); expect(after.shots[1].clip).toBe(shot.clip);
 expect(()=>editStoryboard(before,{type:"reorder",order:["sh_a","sh_a"]})).toThrow("invalid_order");
 expect(validStoryboardPatch({status:"approved"})).toBe(false);
});
test("reference mode motion changes retain frame history but return to draft",()=>{
 const ep=fixture();ep.video_source="references";
 const after=editStoryboard(ep,{type:"patch",shot_id:"sh_a",patch:{motion_prompt:"new"}});
 expect(after.shots[0].status).toBe("draft");expect(after.shots[0].kf_selected).toBe(shot.kf_selected);
 expect(after.shots[0].candidates).toEqual(shot.candidates);expect(after.shots[0].clip).toBeNull();
});
const longPolicy = (): Episode => ({ ...fixture(), cut_policy: "long_3_6" } as Episode);
test("suggested duration inside the same H3 bucket keeps the approved clip and flags recompose", () => {
 const ep = longPolicy(); ep.shots[0].duration_s = 4;
 const after = editStoryboard(ep, { type: "patch", shot_id: "sh_a", patch: { duration_s: 3 } });
 expect(after.shots[0].duration_s).toBe(3); expect(after.shots[0].clip).toBe(shot.clip); expect(after.shots[0].status).toBe("approved");
 expect(after.final_needs_recompose).toBe(true);
});
test("suggested duration crossing the 4 s H3 boundary clears only the clip", () => {
 const ep = longPolicy(); ep.shots[0].duration_s = 4;
 const after = editStoryboard(ep, { type: "patch", shot_id: "sh_a", patch: { duration_s: 4.5 } }).shots[0];
 expect(after.clip).toBeNull(); expect(after.kf_selected).toBe(shot.kf_selected); expect(after.status).toBe("kf_selected");
});
test("duration range and cut policy are enforced", () => {
 expect(validStoryboardPatch({ duration_s: 2.9 })).toBe(false);
 expect(validStoryboardPatch({ duration_s: 6.1 })).toBe(false);
 expect(validStoryboardPatch({ duration_s: "4" })).toBe(false);
 expect(validStoryboardPatch({ duration_s: 3, person_visible: false })).toBe(true);
 expect(validStoryboardPatch({ person_visible: "no" })).toBe(false);
 expect(validateStoryboardFields(longPolicy(), { duration_s: 5 }, null)).toEqual([]);
 expect(validateStoryboardFields({ ...fixture(), cut_policy: "fixed_1s" } as Episode, { duration_s: 5 }, null)).toEqual(["invalid_fields"]);
});
test("person_visible is stored only as false and clears the shot's products on change", () => {
 const hidden = editStoryboard(fixture(), { type: "patch", shot_id: "sh_a", patch: { person_visible: false } });
 expect(hidden.shots[0].person_visible).toBe(false); expect(hidden.shots[0].clip).toBeNull(); expect(hidden.shots[0].candidates).toEqual([]); expect(hidden.shots[0].status).toBe("draft");
 const shown = editStoryboard(hidden, { type: "patch", shot_id: "sh_a", patch: { person_visible: true } });
 expect("person_visible" in shown.shots[0]).toBe(false);
 const before = fixture(); expect(editStoryboard(before, { type: "patch", shot_id: "sh_a", patch: { person_visible: true } })).toBe(before);
});
test("insert honours duration_s and an explicit empty-shot flag", () => {
 const draft = { scene: "scene", size: "wide" as const, beat: "b", camera: "static" as const, landmark: null, kf_prompt: "k", motion_prompt: "m" };
 const after = editStoryboard(longPolicy(), { type: "insert", after_shot_id: null, shot_id: "sh_n", shot: { ...draft, duration_s: 5, person_visible: false } });
 expect(after.shots[0]).toMatchObject({ shot_id: "sh_n", duration_s: 5, person_visible: false });
 const plain = editStoryboard(longPolicy(), { type: "insert", after_shot_id: null, shot_id: "sh_m", shot: { ...draft, person_visible: true } });
 expect(plain.shots[0].duration_s).toBe(4); expect("person_visible" in plain.shots[0]).toBe(false);
});
test("landmark_ref belongs to one landmark and never survives a switch to an empty shot with none", () => {
 const ep = fixture(); ep.shots[0].landmark = "l1"; ep.shots[0].landmark_ref = 2;
 expect(editStoryboard(ep, { type: "patch", shot_id: "sh_a", patch: { landmark: "l2" } }).shots[0].landmark_ref).toBeUndefined();
 expect(editStoryboard(ep, { type: "patch", shot_id: "sh_a", patch: { beat: "other" } }).shots[0].landmark_ref).toBe(2);
 ep.shots[0].landmark_ref = "none";
 expect(editStoryboard(ep, { type: "patch", shot_id: "sh_a", patch: { person_visible: false } }).shots[0].landmark_ref).toBeUndefined();
});
