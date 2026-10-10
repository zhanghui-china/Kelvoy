import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Episode, Shot } from "@kelvoy/engine";
import { close, open, insertPersona, upsertDestination, insertEpisode, getDb, grantCredits,
  enqueueTask, reserveCredits, getCreditBalance, dequeueTask, getEpisode } from "@kelvoy/store";
import { handleTask } from "./consumer";

beforeEach(() => open(":memory:"));
afterEach(() => close());

// Dedicated fixtures keep the constraint/refund contract independent of inference tests.
function fixtureEpisode(id: string): Episode {
  return { name: "长镜失败验收", episode_id:id, owner_id:"u_test", persona_id:"c_test",persona_version:1,
    destination_id:"d_test",destination_version:1,series_id:"s",template_id:"t",status:"composing",
    mode:"per_shot",candidate_count:2,created_at:"2026-10-10",estimated_credits:0,credits_used:0,
    share:{enabled:false,slug:""},brief:{season:"秋",aspect:"9:16",requirements:"",duration_s:30,
      tone:"",outfit_override:null,banned:[]},grid_refs:[],scenes:[],shots:[],removed_shots:[],
    music:{file:"",bpm:0,license:""},render:{res:"1080x1920",fps:30,title:"",intro:null,outro:null,ai_label:true} };
}
function shotFixture(): Shot {
  return {no:1,scene:"s",size:"wide",beat:"走过",camera:"static",landmark:null,kf_prompt:"风景",
    motion_prompt:"走过",duration_s:4,candidates:[],kf_selected:null,clip:null,trim_start_s:null,
    status:"draft",regen_stage:null,bad_shot_reported:false,model:{}};
}
function personaFixture(id: string) {
  return {persona_id:id,owner_id:"u_test",version:1,name:"角色",desc:"",locked:[],default_outfit:"",refs:[],
    style:{lut:"",title_style:"serif-center"}};
}
function destinationFixture(id: string) {
  return {destination_id:id,version:1,name:"景区",city:"城市",type:"scenic_area" as const,season_best:[],
    landmarks:[],route:[],food:[],transport:"",stay:""};
}

for (const outputFailure of [false, true]) {
  test(`long constraint permanently fails and refunds while preserving old film: output=${outputFailure}`, async () => {
    const episode: Episode = { ...fixtureEpisode("e_long_failure"), status: "composing", cut_policy: "long_3_6",
      shots: Array.from({length:7},(_,i) => ({...shotFixture(),no:i+1,status:"approved",clip:`clip/${i+1}.mp4`,duration_s:4})),
      final: {version:1,key:"final/old.mp4",duration_s:30,width:1080,height:1920,fps:30,size_bytes:1000,completed_at:"2026-09-29"} };
    await insertPersona(personaFixture("c_test"));
    await upsertDestination(destinationFixture("d_test"));
    await insertEpisode(episode);
    getDb().query("insert into users (user_id, username, password_hash) values ('u_test', 'tester', 'hash')").run();
    grantCredits("u_test",5,"long-refund");
    const queued = await enqueueTask({episode_id:episode.episode_id,stage:"compose"});
    reserveCredits({action_id:queued.task_id,user_id:"u_test",episode_id:episode.episode_id,task_id:queued.task_id,kind:"compose",units:1});
    expect(getCreditBalance("u_test")).toEqual({available:4,reserved:1});
    let calls=0;
    await handleTask((await dequeueTask())!, {compose:{async probeMedia() {
      return {clip_duration_s:Object.fromEntries(episode.shots.map(s => [s.no,outputFailure?5:2])),intro_duration_s:0,outro_duration_s:0};
    },async compose({plan}) {
      calls++;
      return {output_key:plan.output_key,probe:{duration_s:20,width:1080,height:1920,fps:30,size_bytes:1000}};
    }}});
    expect(calls).toBe(outputFailure?1:0);
    expect(await dequeueTask()).toBeNull();
    expect(getCreditBalance("u_test")).toEqual({available:5,reserved:0});
    const loaded=await getEpisode(episode.episode_id);
    if(!loaded.ok) throw Error("missing episode");
    expect(loaded.episode.status).toBe("failed");
    expect(loaded.episode.final).toEqual(episode.final!);
    expect(loaded.episode.failure_reason).toContain(outputFailure?"成片实际":"素材不足");
  });
}
