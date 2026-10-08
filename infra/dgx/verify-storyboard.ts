// Real HTTP acceptance with synthetic private episode/media; Worker stays paused, no models run.
import { open, close, createUser, createSession, insertEpisode, getCreditBalance, grantCredits, finalizeCredits } from '../../packages/store/src/index';
import type { Destination, Episode, Persona, Shot, Template } from '../../packages/engine/src/index';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
if(process.env.KELVOY_VERIFY_WORKER_PAUSED!=='1')throw Error('Pause Worker and set KELVOY_VERIFY_WORKER_PAUSED=1');
const db=open(), base=process.env.KELVOY_VERIFY_BASE_URL??'http://127.0.0.1:8888';
const owners:string[]=[], episodeIds:string[]=[];
const projects=process.env.KELVOY_PROJECTS_ROOT??'projects';
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function account(){const result=await createUser({username:`storyboard_acceptance_${crypto.randomUUID()}`,password_hash:'acceptance-disabled'});check(result.ok,'temporary user');owners.push(result.user.user_id);const session=await createSession(result.user.user_id);return {id:result.user.user_id,cookie:`kelvoy_session=${session.session_id}`};}
async function request<T>(path:string,cookie:string,method='GET',body?:unknown,status=200):Promise<T>{const res=await fetch(base+path,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});check(res.status===status,`${method} ${path}: expected ${status}, got ${res.status}`);return res.headers.get('content-type')?.includes('application/json')?await res.json() as T:await res.text() as T;}
try{
 const owner=await account(), other=await account();
 const persona=(await request<{personas:Persona[]}>('/api/personas',owner.cookie)).personas.find(p=>p.owner_id===null);
 const destination=(await request<{destinations:Destination[]}>('/api/destinations',owner.cookie)).destinations[0];
 const template=(await request<{templates:Template[]}>('/api/templates',owner.cookie)).templates[0];check(persona&&destination&&template,'catalog');
 const me=await request<{api_contract:number}>('/api/me',owner.cookie);check(me.api_contract===2,'contract2');
 const id=`e_acceptance_${crypto.randomUUID()}`,slug=`acceptance-${crypto.randomUUID()}`;episodeIds.push(id);
 const shot=(no:number):Shot=>({shot_id:`sh_acceptance_${no}`,no,scene:'sc1',size:'wide',beat:'景区漫步',caption:'旧字幕',camera:'static',landmark:null,kf_prompt:'景区画面',motion_prompt:'缓慢前进',duration_s:1,candidates:[],kf_selected:null,clip:`clip/${no}.mp4`,trim_start_s:0,status:'approved',regen_stage:null,bad_shot_reported:false,model:{}});
 const episode:Episode={episode_id:id,name:'自由分镜临时验收',owner_id:owner.id,persona_id:persona.persona_id,persona_version:persona.version,destination_id:destination.destination_id,destination_version:destination.version,template_id:template.template_id,series_id:'acceptance',status:'done',mode:'per_shot',video_source:'references',cut_policy:'fixed_1s',candidate_count:1,created_at:new Date().toISOString(),estimated_credits:0,credits_used:0,share:{enabled:true,slug},brief:{season:'秋',aspect:'9:16',requirements:'',duration_s:2,tone:'',outfit_override:null,banned:[]},scenes:[{id:'sc1',name:'景区',time:'morning',landmarks:[]}],shots:[shot(1),shot(2)],removed_shots:[],grid_refs:[],music:{file:'',bpm:0,license:''},render:{res:'1080x1920',fps:30,title:'验收',intro:null,outro:null,ai_label:true},final:{version:1,key:'final/previous.mp4',duration_s:2,width:1080,height:1920,fps:30,size_bytes:8,completed_at:new Date().toISOString()}};
 await insertEpisode(episode);await mkdir(join(projects,id,'final'),{recursive:true});await Bun.write(join(projects,id,'final/previous.mp4'),'previous');
 const path=`/api/episodes/${id}`;
 async function current(){return request<{episode:Episode;row_version:number;storyboard_busy:boolean;storyboard_prices:{script:number;video:number}}>(path,owner.cookie);}
 const draft={scene:'sc1',size:'medium',camera:'push',landmark:null,beat:'新增漫步',caption:'',kf_prompt:'新增画面',motion_prompt:'缓慢前进'};
 let snapshot=await current();
 await request(path+'/storyboard',other.cookie,'POST',{row_version:1,after_shot_id:null,shot:draft},404);
 const first=await request<{shot_id:string}>(path+'/storyboard',owner.cookie,'POST',{row_version:1,after_shot_id:null,shot:draft});
 await request(path+'/storyboard',owner.cookie,'POST',{row_version:1,after_shot_id:null,shot:draft},409);
 snapshot=await current();const middle=await request<{shot_id:string}>(path+'/storyboard',owner.cookie,'POST',{row_version:snapshot.row_version,after_shot_id:'sh_acceptance_1',shot:draft});
 snapshot=await current();const last=await request<{shot_id:string}>(path+'/storyboard',owner.cookie,'POST',{row_version:snapshot.row_version,after_shot_id:snapshot.episode.shots.at(-1)!.shot_id,shot:draft});
 snapshot=await current();check(snapshot.episode.shots.length===5,'first/middle/last inserted');
 await request(path+'/storyboard/reorder',owner.cookie,'POST',{row_version:snapshot.row_version,order:[last.shot_id,first.shot_id,'sh_acceptance_1',middle.shot_id,'sh_acceptance_2']});
 snapshot=await current();await request(path+`/storyboard/${first.shot_id}/remove`,owner.cookie,'POST',{row_version:snapshot.row_version});
 snapshot=await current();await request(path+'/storyboard/sh_acceptance_1',owner.cookie,'PATCH',{row_version:snapshot.row_version,patch:{caption:'新字幕'}});
 snapshot=await current();check(snapshot.episode.shots.find(s=>s.shot_id==='sh_acceptance_1')?.clip==='clip/1.mp4','caption/order retain clip');check(snapshot.episode.final_needs_recompose,'priorfinal marker');
 const shared=await request<{episode:Episode}>(`/api/share/${slug}`,other.cookie);check(shared.episode.shots.length===2&&shared.episode.shots[0]?.caption==='旧字幕','share stays on old storyboard');
 check(await request<string>(path+'/files/final/previous.mp4',owner.cookie)==='previous','priorfinal readable');await request(path,other.cookie,'GET',undefined,404);
 check(getCreditBalance(owner.id).available===0&&getCreditBalance(owner.id).reserved===0,'manual edits free');
 await request(path+'/continue',owner.cookie,'POST',{row_version:snapshot.row_version},402);
 grantCredits(owner.id,2*snapshot.storyboard_prices.video+snapshot.storyboard_prices.script,'acceptance-storyboard');
 await request(path+'/continue',owner.cookie,'POST',{row_version:snapshot.row_version});
 const children=db.query<{shot_id:string},[string]>("select shot_id from tasks where episode_id=? and stage='video' and status='held'").all(id);check(children.length===2&&children.every(t=>[middle.shot_id,last.shot_id].includes(t.shot_id)),'only new clips queued');
 snapshot=await current();check(snapshot.storyboard_busy,'queue locks edits');await request(path+'/storyboard/sh_acceptance_1/remove',owner.cookie,'POST',{row_version:snapshot.row_version},409);
 // Retire only this synthetic owner's unexecuted work, then validate the suggestion queue.
 db.transaction(()=>{for(const t of db.query<{task_id:string},[string]>("select task_id from tasks where episode_id=?").all(id))finalizeCredits(t.task_id,'released');db.query("update tasks set status='cancelled' where episode_id=?").run(id);db.query("update episodes set doc=json_set(doc,'$.status','script_review') where episode_id=?").run(id);}).immediate();
 snapshot=await current();const before=JSON.stringify(snapshot.episode.shots);
 const suggestion=await request<{task_id:string}>(path+'/storyboard/suggestions',owner.cookie,'POST',{row_version:snapshot.row_version,after_shot_id:middle.shot_id,description:'新增落日空镜',fields:{scene:'sc1'}});
 const pending=await request<{status:string}>(path+`/storyboard/suggestions/${suggestion.task_id}`,owner.cookie);check(pending.status==='pending','AI suggestion queued');await request(path+`/storyboard/suggestions/${suggestion.task_id}`,other.cookie,'GET',undefined,404);
 check(JSON.stringify((await current()).episode.shots)===before,'suggestion does not insert');
 console.log('PASS real HTTP two-owner first/middle/last insert/reorder/delete/caption; conflict+queue lock; old final/share retained; manual free; selective new-video reservation; private AI queue. Synthetic media only, no GPU/LLM run.');
}finally{
 db.transaction(()=>{for(const owner of owners){const rows=db.query<{episode_id:string},[string]>('select episode_id from episodes where owner_id=?').all(owner);for(const row of rows){db.query('delete from tasks where episode_id=?').run(row.episode_id);db.query('delete from episodes where episode_id=?').run(row.episode_id);}for(const table of ['credit_ledger','credit_actions','credit_accounts','sessions','users'])db.query(`delete from ${table} where user_id=?`).run(owner);}}).immediate();
 for(const id of episodeIds)await rm(join(projects,id),{recursive:true,force:true});check(db.query<{quick_check:string},[]>('pragma quick_check').get()?.quick_check==='ok','integrity after cleanup');close();
}
