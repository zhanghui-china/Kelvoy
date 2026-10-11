/** Authorized original recovery: normal HTTP retry only, never fabricates a completed episode. */
import { join } from "node:path";
import { createHash } from "node:crypto";
import { open, close, getDb, createSession, deleteSession, getCreditBalance, getCreditPrice } from "../../packages/store/src/index";
import { runCommand } from "../../apps/worker/src/compose/ffmpeg";
const id = "e_2ceea195-725c-43b7-a9ae-1632599ebbe9";
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
check(process.env.KELVOY_RECOVER_COMPOSE === id && process.env.KELVOY_DB_PATH && process.env.KELVOY_PROJECTS_ROOT && process.env.KELVOY_RECOVERY_REPORT, "explicit original recovery authorization and paths required");
const database = open();
const row = database.query<{doc:string},[string]>("select doc from episodes where episode_id=?").get(id);
check(row, "original episode exists");
const source = JSON.parse(row.doc);
check(source.status === "failed" && source.music.enabled === false && source.shots.length === 8 && source.shots.every((s: {status:string;clip:string}) => s.status === "approved" && s.clip), "original is a silent failed composition with eight approved clips");
const root = process.env.KELVOY_PROJECTS_ROOT;
const digest = (data: ArrayBuffer) => createHash("sha256").update(new Uint8Array(data)).digest("hex");
const hashes: Record<string,string> = {};
for (const shot of source.shots) hashes[shot.clip] = digest(await Bun.file(join(root,id,shot.clip)).arrayBuffer());
const beforeCredits = getCreditBalance(source.owner_id);
const beforeTasks = new Set(database.query<{task_id:string},[string]>("select task_id from tasks where episode_id=?").all(id).map(t=>t.task_id));
const session = await createSession(source.owner_id);
const headers = { cookie: `kelvoy_session=${session.session_id}`, "content-type":"application/json" };
const base = "http://127.0.0.1:8888";
let submitted = false;
try {
  const response = await fetch(base+`/api/episodes/${id}`,{headers}); check(response.ok,"original detail");
  let current = await response.json();
  check(current.failed_task?.stage === "compose", "retry resolves to composition");
  const retry = await fetch(base+`/api/episodes/${id}/retry`,{method:"POST",headers,body:JSON.stringify({row_version:current.row_version})});
  check(retry.ok, "normal retry accepted");
  check((await retry.json()).stage === "compose", "only composition submitted");
  submitted = true;
  const deadline = Date.now()+180_000;
  do {
    await Bun.sleep(1000);
    const polled = await fetch(base+`/api/episodes/${id}`,{headers}); check(polled.ok,"original remains accessible");
    current = await polled.json();
    if(current.episode.status === "done" || current.episode.status === "failed") break;
  } while(Date.now()<deadline);
  check(current.episode.status === "done" && current.episode.final && current.episode.failure_reason === null, "real composition succeeded");
  const episode = current.episode;
  for(const field of ["cut_policy","shots","removed_shots","render","music","brief","persona_id","persona_version","destination_id","destination_version"])
    check(JSON.stringify(episode[field])===JSON.stringify(source[field]),`original ${field} retained`);
  for(const [key,hash] of Object.entries(hashes)) check(digest(await Bun.file(join(root,id,key)).arrayBuffer())===hash,"original clip hash retained");
  const newTasks = database.query<{task_id:string;stage:string;status:string},[string]>("select task_id,stage,status from tasks where episode_id=?").all(id).filter(t=>!beforeTasks.has(t.task_id));
  check(newTasks.length===1 && newTasks[0]?.stage==="compose" && newTasks[0]?.status==="done","one successful composition, no new model work");
  const probe = await runCommand(["ffprobe","-v","error","-show_streams","-of","json",join(root,id,episode.final.key)]);
  check(probe.code===0,"output probe");
  const streams = JSON.parse(probe.stdout).streams;
  check(!streams.some((s:{codec_type:string})=>s.codec_type==="audio"),"silent output has no audio stream");
  check(episode.final.width===1080 && episode.final.height===1920 && episode.final.fps===30,"1080x1920 30fps output");
  const delivery = await fetch(base+`/api/episodes/${id}/files/${episode.final.key}`,{headers}); check(delivery.ok,"delivery reads new final");
  const finalHash = digest(await Bun.file(join(root,id,episode.final.key)).arrayBuffer());
  check(digest(await delivery.arrayBuffer())===finalHash,"delivery bytes match current final");
  let shareVerified = false;
  if(episode.share.enabled) {
    const share = await fetch(base+`/api/share/${episode.share.slug}`); check(share.ok,"share metadata accessible");
    check((await share.json()).episode.final.key===episode.final.key,"share current final key");
    const sharedFile = await fetch(base+`/api/share/${episode.share.slug}/final.mp4`);check(sharedFile.ok,"share file accessible");
    check(digest(await sharedFile.arrayBuffer())===finalHash,"share bytes match new final");
    shareVerified=true;
  }
  const credits = getCreditBalance(source.owner_id);
  check(credits.available===beforeCredits.available-getCreditPrice("compose") && credits.reserved===beforeCredits.reserved,"existing composition credit price settled once");
  await Bun.write(process.env.KELVOY_RECOVERY_REPORT,JSON.stringify({status:"done",episode_id:id,task_id:newTasks[0]!.task_id,clips:8,clip_hashes:hashes,cut_policy:episode.cut_policy,final:episode.final,final_sha256:finalHash,audio_streams:0,model_tasks:0,credits_charged:getCreditPrice("compose"),delivery_verified:true,share_verified:shareVerified,share_enabled:episode.share.enabled},null,2));
  console.log(JSON.stringify({status:"done",episode_id:id,duration_s:episode.final.duration_s,width:episode.final.width,height:episode.final.height,fps:episode.final.fps,audio_streams:0,clips_unchanged:8,model_tasks:0,credits:getCreditPrice("compose"),share_verified:shareVerified}));
} catch(error) {
  await Bun.write(process.env.KELVOY_RECOVERY_REPORT,JSON.stringify({status:"verification_failed",episode_id:id,submitted,error:error instanceof Error?error.message:"verification failed"},null,2));
  throw error;
} finally {
  await deleteSession(session.session_id);
  close();
}
