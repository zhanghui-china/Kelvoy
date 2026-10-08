import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Episode, Shot, StageContext, Task } from '@kelvoy/engine';
import { open, close, createUser, createSession, insertEpisode, upsertOfficialPersona, upsertDestination,
  getEpisode, grantCredits, dequeueTask, getCreditBalance } from '@kelvoy/store';
import { Hono } from 'hono';
import episodes from './episodes';
import share from './share';
// Cross-app runtime integration: each app is typechecked in its own composite project.
const workerModule = '../../../../worker/src/queue/consumer';
const { handleTask }: { handleTask(task: Task, overrides?: Partial<StageContext>): Promise<void> } = await import(workerModule);
let root = '', priorRoot: string | undefined;
afterEach(async () => { close(); if (root) await rm(root, {recursive:true,force:true}); if(priorRoot===undefined)delete process.env.KELVOY_PROJECTS_ROOT;else process.env.KELVOY_PROJECTS_ROOT=priorRoot; });

test.each(['keyframe', 'references'] as const)('completed storyboard insert/reorder/delete selectively regenerates and updates share (%s)', async (video_source) => {
  open(':memory:'); root=await mkdtemp(join(tmpdir(),'kelvoy-storyboard-flow-')); priorRoot=process.env.KELVOY_PROJECTS_ROOT; process.env.KELVOY_PROJECTS_ROOT=root;
  const created = await createUser({ username:'flow',password_hash:'disabled' }); if(!created.ok)throw Error('user');
  const owner=created.user.user_id; const session=await createSession(owner); const cookie=`kelvoy_session=${session.session_id}`;
  await upsertOfficialPersona({persona_id:'p_flow',owner_id:null,version:1,name:'角色',desc:'',locked:[],default_outfit:'',refs:['persona/p/a.jpg','persona/p/b.jpg','persona/p/c.jpg'],style:{lut:'',title_style:''}});
  await upsertDestination({destination_id:'d_flow',version:1,name:'景区',city:'测试',type:'scenic_area',season_best:[],landmarks:[{id:'lm1',name:'景点',refs:['dest/a.jpg','dest/b.jpg','dest/c.jpg'],best_time:'清晨'}],route:[],food:[],transport:'',stay:''});
  const shot=(no:number):Shot=>({no,shot_id:`sh_keep_${no}`,scene:'sc1',size:'wide',beat:'漫步',camera:'static',landmark:null,kf_prompt:'景区',motion_prompt:'走过',caption:'旧字幕',duration_s:1,candidates:['kf/keep.png'],kf_selected:'kf/keep.png',clip:`clip/keep_${no}.mp4`,trim_start_s:0,status:'approved',regen_stage:null,bad_shot_reported:false,model:{}});
  const original:Episode={episode_id:'e_flow',name:'流程',owner_id:owner,persona_id:'p_flow',persona_version:1,destination_id:'d_flow',destination_version:1,template_id:'t',series_id:'s',status:'done',mode:'per_shot',video_source,cut_policy:'fixed_1s',candidate_count:1,created_at:new Date().toISOString(),estimated_credits:0,credits_used:0,share:{enabled:true,slug:'flow-public'},brief:{season:'秋',aspect:'9:16',requirements:'',duration_s:2,tone:'',outfit_override:null,banned:[]},grid_refs:[],scenes:[{id:'sc1',name:'景区',time:'morning',landmarks:[]}],shots:[shot(1),shot(2)],removed_shots:[],music:{file:'',bpm:0,license:''},render:{res:'1080x1920',fps:30,title:'',intro:null,outro:null,ai_label:true},final:{version:1,key:'final/old.mp4',duration_s:2,width:1080,height:1920,fps:30,size_bytes:3,completed_at:new Date().toISOString()}};
  await insertEpisode(original); grantCredits(owner,20,'flow-grant');
  await mkdir(join(root,'e_flow','final'),{recursive:true}); await writeFile(join(root,'e_flow','final','old.mp4'),'old');
  const app=new Hono();app.route('/api/episodes',episodes);app.route('/api/share',share);
  async function request(path:string,body?:unknown,method='POST') {return app.request(`/api/episodes/e_flow${path}`,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}
  async function current(){const got=await getEpisode('e_flow');if(!got.ok)throw Error('missing');return got;}
  const draft={scene:'sc1',size:'medium',beat:'新镜头',caption:'新增',camera:'push',landmark:null,kf_prompt:'新增画面',motion_prompt:'缓慢前进'};
  const insert=await request('/storyboard',{row_version:1,after_shot_id:'sh_keep_1',shot:draft});expect(insert.status).toBe(200);
  const fresh=(await current()).episode.shots[1]!.shot_id!;
  expect((await current()).episode.final_needs_recompose).toBe(true);
  const publicBefore=await app.request('/api/share/flow-public');expect((await publicBefore.json()).episode.shots).toHaveLength(2);
  expect(await (await request('/files/final/old.mp4',undefined,'GET')).text()).toBe('old');
  let snapshot=await current();expect((await request('/storyboard/reorder',{row_version:snapshot.row_version,order:['sh_keep_2',fresh,'sh_keep_1']})).status).toBe(200);
  snapshot=await current();expect((await request('/storyboard/sh_keep_2/remove',{row_version:snapshot.row_version})).status).toBe(200);
  snapshot=await current();expect(snapshot.episode.shots[1]?.clip).toBe('clip/keep_1.mp4');expect(snapshot.episode.removed_shots[0]?.clip).toBe('clip/keep_2.mp4');
  expect((await request('/continue',{row_version:snapshot.row_version})).status).toBe(200);
  let images=0,videos=0;
  const asset=(key:string,seed:number)=>({key,model:'mock',version:'1',seed,seconds:0,ref_hashes:[]});
  const providers:Partial<StageContext>={keyframe:{generate:async input=>{images++;return asset(`kf/${input.shot_id}.png`,input.seed);}},video:{generate:async input=>{videos++;return asset(`clip/${input.shot_id}.mp4`,input.seed);}}};
  const assets=await dequeueTask();expect(assets?.stage).toBe('assets');await handleTask(assets!);
  if (video_source === 'keyframe') {
    const image=await dequeueTask();expect(image?.shot_id).toBe(fresh);await handleTask(image!,providers);expect(await dequeueTask()).toBeNull();
    snapshot=await current();expect(snapshot.episode.status).toBe('kf_review');const frame=snapshot.episode.shots.find(s=>s.shot_id===fresh)!;
    expect((await request(`/shots/${frame.no}`,{row_version:snapshot.row_version,patch:{kf_selected:frame.candidates[0],status:'kf_selected'}},'PATCH')).status).toBe(200);
    snapshot=await current();expect((await request('/continue',{row_version:snapshot.row_version})).status).toBe(200);
  }
  const generated=(await current()).episode.shots.find(s=>s.shot_id===fresh)!;
  const video=await dequeueTask();expect(video?.shot_id).toBe(fresh);await handleTask(video!,providers);expect(await dequeueTask()).toBeNull();
  snapshot=await current();expect(snapshot.episode.status).toBe('clip_review');expect((await request(`/shots/${generated.no}`,{row_version:snapshot.row_version,patch:{status:'approved'}},'PATCH')).status).toBe(200);
  snapshot=await current();expect((await request('/continue',{row_version:snapshot.row_version})).status).toBe(200);
  snapshot=await current();expect(snapshot.episode.status).toBe('compose_ready');expect((await request('/continue',{row_version:snapshot.row_version})).status).toBe(200);
  const composition=await dequeueTask();expect(composition?.stage).toBe('compose');await handleTask(composition!,{compose:{compose:async({plan})=>{await writeFile(join(root,'e_flow',plan.output_key),'new');return {output_key:plan.output_key,probe:{duration_s:2,width:1080,height:1920,fps:30,size_bytes:3}};}}});
  snapshot=await current();expect(snapshot.episode.status).toBe('done');expect(snapshot.episode.final_needs_recompose).toBe(false);expect(snapshot.episode.shared_storyboard).toBeUndefined();expect(snapshot.episode.shots[1]?.clip).toBe('clip/keep_1.mp4');
  expect(images).toBe(video_source === "keyframe" ? 1 : 0);expect(videos).toBe(1);expect(getCreditBalance(owner).available).toBe(video_source === "keyframe" ? 8 : 9); // image1 + video10 + compose1
  const publicAfter=await app.request('/api/share/flow-public');expect((await publicAfter.json()).episode.shots.map((s:Shot)=>s.shot_id)).toEqual([fresh,'sh_keep_1']);
});
