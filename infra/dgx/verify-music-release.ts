/** Disposable-account production HTTP smoke check; audit rows are retained. */
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { open, close, createUser, createSession, deleteSession, insertEpisode, grantCredits,
  reserveCredits, getCreditBalance, getDb } from "../../packages/store/src/index";
import type { Episode } from "../../packages/engine/src/index";
function check(value:unknown,message:string):asserts value {if(!value)throw Error(message);}
check(process.env.KELVOY_DB_PATH && process.env.KELVOY_PROJECTS_ROOT && process.env.KELVOY_VERIFY_BASE_URL,"explicit smoke check paths required");
const root=process.env.KELVOY_PROJECTS_ROOT,base=process.env.KELVOY_VERIFY_BASE_URL;
const database=open();
const user=await createUser({username:`music_release_check_${crypto.randomUUID()}`,password_hash:"disabled-verification-account"});check(user.ok,"disposable account");
const session=await createSession(user.user.user_id);
const owner=user.user.user_id;
const ids=[`e_music_delete_${crypto.randomUUID()}`,`e_music_keep_${crypto.randomUUID()}`];
const source: Episode = {episode_id:"",owner_id:owner,name:"验收",persona_id:"p_music_verify",persona_version:1,destination_id:"d_music_verify",destination_version:1,template_id:"t_music_verify",series_id:"verification",status:"done",mode:"per_shot",cut_policy:"beat_aligned",candidate_count:1,created_at:new Date().toISOString(),estimated_credits:0,credits_used:0,share:{enabled:false,slug:""},brief:{season:"秋",aspect:"9:16",requirements:"",duration_s:1,tone:"",outfit_override:null,banned:[]},grid_refs:[],scenes:[],shots:[],removed_shots:[],music:{file:"",bpm:0,license:""},render:{res:"1080x1920",fps:30,title:"验收",intro:null,outro:null,ai_label:true}};
const headers={cookie:`kelvoy_session=${session.session_id}`,"content-type":"application/json"};
async function request(path:string,method="GET",body?:unknown,status=200){
 const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 check(response.status===status,`smoke HTTP ${method}: expected ${status}, got ${response.status}`);return response;
}
try {
 grantCredits(owner,10,`music-smoke-${owner}`);
 for(const id of ids){
  const episode:Episode={...source,episode_id:id,owner_id:owner,name:"配乐发布删除验收",status:"done",shots:[],removed_shots:[],credits_used:0,estimated_credits:0,
   share:{enabled:true,slug:`music_smoke_${crypto.randomUUID()}`},music:{file:"",bpm:0,license:"",enabled:false},
   final:{version:1,key:"final/previous.mp4",duration_s:1,width:1080,height:1920,fps:30,size_bytes:8,completed_at:new Date().toISOString()}};
  await insertEpisode(episode);await mkdir(join(root,id,"final"),{recursive:true});await Bun.write(join(root,id,"final/previous.mp4"),"previous");
 }
 const id=ids[0]!,path=`/api/episodes/${id}`;
 let detail=await(await request(path)).json();
 await request(path,"PATCH",{row_version:detail.row_version,patch:{music:{file:"music/calm_morning.mp3",bpm:84,license:"Kelvoy original",enabled:false}}});
 detail=await(await request(path)).json();check(detail.episode.final_needs_recompose && detail.episode.final.key==="final/previous.mp4","old final retained and flagged");
 check(await(await request(path+"/files/final/previous.mp4")).text()==="previous","old file readable after music save");
 const taskId=`tk_music_held_${crypto.randomUUID()}`;
 database.query("insert into tasks(task_id,episode_id,stage,status) values(?,?,'compose','held')").run(taskId,id);
 check(reserveCredits({action_id:taskId,task_id:taskId,episode_id:id,user_id:owner,kind:"compose",units:1}).ok,"isolated held reservation");
 const first=await(await request(path,"DELETE")).json();check(first.refunded_credits===1,"refund once");
 const second=await(await request(path,"DELETE")).json();check(second.refunded_credits===0,"replay does not refund twice");
 check(getCreditBalance(owner).available===10 && getCreditBalance(owner).reserved===0,"held credits restored");
 await request(path,"GET",undefined,404);await request(path+"/files/final/previous.mp4","GET",undefined,404);
 await request(`/api/share/${detail.episode.share.slug}`,"GET",undefined,404);
 check(await(await request(`/api/episodes/${ids[1]}/files/final/previous.mp4`)).text()==="previous","other episode file retained");
 await request(`/api/episodes/${ids[1]}`,"DELETE");
 const deadline=Date.now()+75_000;
 while(Date.now()<deadline){
  const rows=database.query<{cleanup_status:string},[string,string]>("select cleanup_status from episode_deletions where episode_id in (?,?)").all(ids[0]!,ids[1]!);
  if(rows.length===2 && rows.every(row=>row.cleanup_status==="done"))break;
  await Bun.sleep(1000);
 }
 check(ids.every(id=>!database.query("select 1 from episodes where episode_id=?").get(id)),"test episodes absent");
 check(database.query<{n:number},[string,string]>("select count(*) n from episode_deletions where episode_id in (?,?) and cleanup_status='done'").get(ids[0]!,ids[1]!)?.n===2,"durable media deletion completed");
 console.log(JSON.stringify({status:"passed",old_final_retained:true,duplicate_refund_protected:true,links_revoked:true,other_episode_preserved:true,deletion_audits:ids}));
} finally {
 await deleteSession(session.session_id);
 // Test-only financial/account rows; deletion audits and all pre-existing rows remain.
 if(ids.every(id=>!database.query("select 1 from episodes where episode_id=?").get(id))){
  database.transaction(()=>{for(const table of ["credit_ledger","credit_actions","credit_accounts","sessions","users"])database.query(`delete from ${table} where user_id=?`).run(owner);}).immediate();
 }
 close();
}
