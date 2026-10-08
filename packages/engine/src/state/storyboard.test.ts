import { test, expect } from "bun:test";
import { editStoryboard, validStoryboardPatch } from "./storyboard";
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
