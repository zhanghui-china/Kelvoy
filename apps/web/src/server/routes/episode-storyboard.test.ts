import { test, expect } from "bun:test";
import { insertEpisode, getEpisode } from "@kelvoy/store";
import { setupEpisodeRouteTests, login, buildApp, fixture } from "./episode-test-fixtures";
setupEpisodeRouteTests();
test("stable storyboard API permits empty scripts and creates default scene on insert",async()=>{
 const {cookie,ownerId}=await login("storyboard");const ep=fixture("ep_edit",ownerId);ep.status="script_review";ep.scenes=[];await insertEpisode(ep);
 const app=buildApp();const headers={cookie,"content-type":"application/json"};
 const response=await app.request("/api/episodes/ep_edit/storyboard",{method:"POST",headers,body:JSON.stringify({row_version:1,after_shot_id:null,shot:{scene:"",size:"wide",beat:"走路",camera:"static",landmark:null,kf_prompt:"远景",motion_prompt:"向前走"}})});
 const body=await response.json();expect(body).toMatchObject({ok:true});expect(response.status).toBe(200);expect(body.shot_id).toStartWith("sh_");expect(body.row_version).toBe(2);
 const stale=await app.request(`/api/episodes/ep_edit/storyboard/${body.shot_id}`,{method:"PATCH",headers,body:JSON.stringify({row_version:1,patch:{caption:"字幕"}})});expect(stale.status).toBe(409);
 const remove=await app.request(`/api/episodes/ep_edit/storyboard/${body.shot_id}/remove`,{method:"POST",headers,body:JSON.stringify({row_version:2})});expect(remove.status).toBe(200);
 const current=await getEpisode("ep_edit");if(!current.ok)throw Error("missing");expect(current.episode.shots).toEqual([]);expect(current.episode.removed_shots[0].shot_id).toBe(body.shot_id);
});
test("new storyboard routes isolate owners and reject forged fields",async()=>{
 const first=await login("storyboard_owner");const second=await login("storyboard_other");const ep=fixture("ep_private",first.ownerId);ep.status="script_review";ep.scenes=[];await insertEpisode(ep);
 const app=buildApp();const body={row_version:1,after_shot_id:null,shot:{scene:"",size:"wide",beat:"走路",camera:"static",landmark:null,kf_prompt:"远景",motion_prompt:"向前走"}};
 const other=await app.request("/api/episodes/ep_private/storyboard",{method:"POST",headers:{cookie:second.cookie,"content-type":"application/json"},body:JSON.stringify(body)});expect(other.status).toBe(404);
 const forged=await app.request("/api/episodes/ep_private/storyboard",{method:"POST",headers:{cookie:first.cookie,"content-type":"application/json"},body:JSON.stringify({...body,shot:{...body.shot,status:"approved"}})});expect(forged.status).toBe(400);
 const invalid=await app.request("/api/episodes/ep_private/storyboard",{method:"POST",headers:{cookie:first.cookie,"content-type":"application/json"},body:JSON.stringify({...body,shot:{...body.shot,landmark:"unknown"}})});expect(invalid.status).toBe(400);
 const unchanged=await getEpisode("ep_private");if(!unchanged.ok)throw Error("missing");expect(unchanged.row_version).toBe(1);
});
