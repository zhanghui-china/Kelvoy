import { afterEach, beforeEach, test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import type { Episode } from "@kelvoy/engine";
import { open, close, getDb } from "./db";
import { insertEpisode, getEpisode } from "./episodes";
import { updateStoryboard } from "./storyboard";
function fixtureEpisode(id: string, ownerId = "u_test"): Episode {
  return {
    name: "测试期", episode_id: id,
    owner_id: ownerId,
    persona_id: "c_test",
    persona_version: 1,
    destination_id: "d_test",
    destination_version: 1,
    series_id: "s_test",
    template_id: "t_test",
    status: "draft",
    mode: "per_shot", candidate_count: 2,
    created_at: "2026-09-23T00:00:00+08:00",
    estimated_credits: 0,
    credits_used: 0,
    share: { enabled: false, slug: "" },
    brief: {
      season: "秋",
      aspect: "9:16",
      requirements: "",
      duration_s: 30,
      tone: "松弛",
      outfit_override: null,
      banned: [],
    },
    grid_refs: [],
    scenes: [{ id: "s1", name: "到达", time: "morning", landmarks: [] }],
    shots: [
      {
        no: 1,
        scene: "s1",
        size: "wide",
        beat: "test",
        camera: "static",
        landmark: null,
        kf_prompt: "",
        motion_prompt: "",
        duration_s: 1,
        candidates: [],
        kf_selected: null,
        clip: null,
        trim_start_s: null,
        status: "draft",
        regen_stage: null,
        bad_shot_reported: false,
        model: {},
      },
    ],
    removed_shots: [],
    music: { file: "", bpm: 0, license: "" },
    render: {
      res: "1080x1920",
      fps: 30,
      title: "",
      intro: null,
      outro: null,
      ai_label: true,
    },
  };
}

const temporaryDatabases: string[] = [];
beforeEach(()=>open(":memory:"));
afterEach(() => { close(); for (const path of temporaryDatabases.splice(0)) for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true }); });
test("owner/version and held task checks share the edit transaction",async()=>{
 const ep=fixtureEpisode("ep");ep.status="script_review";await insertEpisode(ep);
 const loaded=await getEpisode("ep");if(!loaded.ok)throw Error("missing");
 const input={episode_id:"ep",owner_id:"u_test",row_version:1,edit:{type:"remove" as const,shot_id:loaded.episode.shots[0].shot_id!}};
 expect((await updateStoryboard({...input,owner_id:"other"})).ok).toBe(false);
 getDb().query("insert into tasks(task_id,episode_id,stage,status) values ('task','ep','video','held')").run();
 expect(await updateStoryboard(input)).toMatchObject({ok:false,error:"storyboard_busy"});
 getDb().query("update tasks set status='done'").run();
 expect(await updateStoryboard(input)).toMatchObject({ok:true,row_version:2});
 expect(await updateStoryboard(input)).toMatchObject({ok:false,error:"version_conflict"});
 const after=await getEpisode("ep");if(!after.ok)throw Error("missing");expect(after.episode.shots).toHaveLength(0);expect(after.episode.removed_shots).toHaveLength(1);
});
test("unchanged patch keeps row version while invalid scene is rejected",async()=>{
 const ep=fixtureEpisode("ep");ep.status="script_review";await insertEpisode(ep);
 const loaded=await getEpisode("ep");if(!loaded.ok)throw Error("missing");
 const input={episode_id:"ep",owner_id:"u_test",row_version:1,edit:{type:"patch" as const,shot_id:loaded.episode.shots[0].shot_id!,patch:{caption:""}}};
 expect(await updateStoryboard({...input,edit:{...input.edit,patch:{scene:"unknown"}}})).toMatchObject({ok:false,error:"invalid_scene"});
 expect(await updateStoryboard({...input,edit:{...input.edit,patch:{beat:"test"}}})).toMatchObject({ok:true,row_version:1});
});
test("legacy identities remain stable after removal and renumbering without rewriting media",async()=>{
 const ep=fixtureEpisode("ep");ep.status="script_review";ep.shots[0].clip="clip/01.mp4";
 ep.shots.push({...ep.shots[0],no:2,clip:"clip/02.mp4"});await insertEpisode(ep);
 const first=await getEpisode("ep");if(!first.ok)throw Error("missing");
 const ids=first.episode.shots.map(s=>s.shot_id!);
 expect(await updateStoryboard({episode_id:"ep",owner_id:"u_test",row_version:1,edit:{type:"reorder",order:[...ids].reverse()}})).toMatchObject({ok:true,row_version:2});
 const after=await getEpisode("ep");if(!after.ok)throw Error("missing");
 expect(after.episode.shots[0].shot_id).toBe(ids[1]);expect(after.episode.shots[0].clip).toBe("clip/02.mp4");
 expect(after.episode.shots[1].shot_id).toBe(ids[0]);expect(after.episode.shots[1].clip).toBe("clip/01.mp4");
});
test("concurrent writes using one version have exactly one winner",async()=>{
 const ep=fixtureEpisode("ep");ep.status="script_review";await insertEpisode(ep);
 const loaded=await getEpisode("ep");if(!loaded.ok)throw Error("missing");
 const input={episode_id:"ep",owner_id:"u_test",row_version:1,edit:{type:"patch" as const,shot_id:loaded.episode.shots[0].shot_id!,patch:{caption:"first"}}};
 const results=await Promise.all([updateStoryboard(input),updateStoryboard({...input,edit:{...input.edit,patch:{caption:"second"}}})]);
 expect(results.filter(result=>result.ok)).toHaveLength(1);expect(results.filter(result=>!result.ok)).toHaveLength(1);
});
test("identity migration preserves minimal historical documents across reopen",()=>{
 const path=join(tmpdir(),`kelvoy-identity-${crypto.randomUUID()}.db`);temporaryDatabases.push(path);
 const original={episode_id:"partial",owner_id:"u",persona_id:"missing",persona_version:1,destination_id:"missing",destination_version:1};
 const db=open(path);db.query("insert into episodes(episode_id,owner_id,doc) values(?,?,?)").run("partial","u",JSON.stringify(original));close();
 const reopened=open(path);const row=reopened.query<{doc:string},[]>("select doc from episodes where episode_id='partial'").get();expect(JSON.parse(row!.doc)).toEqual(original);close();
 const again=open(path);const repeat=again.query<{doc:string},[]>("select doc from episodes where episode_id='partial'").get();expect(JSON.parse(repeat!.doc)).toEqual(original);
});
test("migration freezes seven legacy shot/task identities and leaves all media keys unchanged",()=>{
 const path=join(tmpdir(),`kelvoy-identity-${crypto.randomUUID()}.db`);temporaryDatabases.push(path);const db=open(path);const ep=fixtureEpisode("ep");
 ep.shots=Array.from({length:7},(_,i)=>({...ep.shots[0],no:i+1,clip:`clip/${i+1}.mp4`,candidates:[`kf/${i+1}.png`]}));
 ep.removed_shots=[{...ep.shots[0],no:8,clip:"clip/historical.mp4"}];
 db.query("insert into episodes(episode_id,owner_id,doc) values(?,?,?)").run("ep","u",JSON.stringify(ep));
 db.query("insert into tasks(task_id,episode_id,stage,shot_no,status) values('task','ep','video',7,'done')").run();close();
 const migrated=open(path);const first=migrated.query<{doc:string},[]>("select doc from episodes where episode_id='ep'").get()!;const parsed=JSON.parse(first.doc) as Episode;
 expect(new Set([...parsed.shots,...parsed.removed_shots].map(s=>s.shot_id)).size).toBe(8);
 expect(parsed.shots.map(s=>s.clip)).toEqual(ep.shots.map(s=>s.clip));expect(parsed.removed_shots[0].clip).toBe("clip/historical.mp4");
 expect(migrated.query<{shot_id:string},[]>("select shot_id from tasks where task_id='task'").get()!.shot_id).toBe(parsed.shots[6].shot_id!);close();
 const repeated=open(path);expect(repeated.query<{doc:string},[]>("select doc from episodes where episode_id='ep'").get()!.doc).toBe(first.doc);
});
