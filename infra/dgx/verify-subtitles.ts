// Real HTTP smoke check with disposable episodes only; never submits generation.
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { open, close, createUser, createSession, insertEpisode, getCreditBalance } from "../../packages/store/src/index";
import { buildComposePlan, type Episode, type Persona, type Shot } from "../../packages/engine/src/index";

if (process.env.KELVOY_VERIFY_WORKER_PAUSED !== "1" || !process.env.KELVOY_DB_PATH ||
    !process.env.KELVOY_PROJECTS_ROOT || !process.env.KELVOY_VERIFY_BASE_URL) {
  throw Error("Paused Worker and explicit DB, projects and API URL required");
}
const db = open(), base = process.env.KELVOY_VERIFY_BASE_URL;
const root = process.env.KELVOY_PROJECTS_ROOT;
const owners: string[] = [], ids: string[] = [];
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
async function account() {
  const user = await createUser({ username: `subtitle_acceptance_${crypto.randomUUID()}`, password_hash: "acceptance-disabled" });
  check(user.ok, "temporary user"); owners.push(user.user.user_id);
  const session = await createSession(user.user.user_id);
  return { id: user.user.user_id, cookie: `kelvoy_session=${session.session_id}` };
}
async function request<T>(path: string, cookie: string, method = "GET", body?: unknown, status = 200): Promise<T> {
  const response = await fetch(base + path, { method, headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  check(response.status === status, `${method} ${path}: expected ${status}, got ${response.status}`);
  return response.headers.get("content-type")?.includes("application/json") ? await response.json() as T : await response.text() as T;
}
try {
  const owner = await account(), other = await account();
  const id = `e_subtitle_acceptance_${crypto.randomUUID()}`; ids.push(id);
  const shot = (no: number, caption: string): Shot => ({ no, shot_id: `sh_subtitle_${no}`, scene: "sc1", size: "wide", beat: "漫步",
    caption, camera: "static", landmark: null, kf_prompt: "景区", motion_prompt: "前进", duration_s: no === 1 ? 1.5 : 1,
    candidates: [], kf_selected: null, clip: `clip/${no}.mp4`, trim_start_s: 0.5, status: "approved", regen_stage: null,
    bad_shot_reported: false, model: {} });
  const episode: Episode = { episode_id: id, name: "字幕部署临时验收", owner_id: owner.id, persona_id: "p_subtitle_acceptance",
    persona_version: 1, destination_id: "d_subtitle_acceptance", destination_version: 1, template_id: "t_subtitle_acceptance",
    series_id: "acceptance", status: "done", mode: "per_shot", cut_policy: "beat_aligned", candidate_count: 1,
    created_at: new Date().toISOString(), estimated_credits: 0, credits_used: 0, share: { enabled: false, slug: "" },
    brief: { season: "秋", aspect: "9:16", requirements: "", duration_s: 2.5, tone: "", outfit_override: null, banned: [] },
    scenes: [{ id: "sc1", name: "景区", time: "morning", landmarks: [] }], grid_refs: [], removed_shots: [],
    shots: [shot(1, "中文\n你好' : , {旅途} \\ 路"), shot(2, "  ")],
    music: { file: "music/custom-acceptance.mp3", bpm: 120, license: "acceptance" },
    render: { res: "540x960", fps: 30, title: "字幕验收", intro: "intro/custom-acceptance.mp4", outro: "outro/custom-acceptance.mp4", ai_label: true },
    final: { version: 1, key: "final/previous.mp4", duration_s: 2.5, width: 540, height: 960, fps: 30, size_bytes: 8, completed_at: new Date().toISOString() } };
  await insertEpisode(episode);
  await mkdir(join(root, id, "final"), { recursive: true }); await Bun.write(join(root, id, "final/previous.mp4"), "previous");
  const path = `/api/episodes/${id}`;
  const current = () => request<{ episode: Episode; row_version: number }>(path, owner.cookie);
  await request(path, other.cookie, "GET", undefined, 404);
  let saved = await current();
  const persona: Persona = { persona_id: episode.persona_id, owner_id: owner.id, version: 1, name: "验收", desc: "",
    locked: [], default_outfit: "", refs: [], style: { lut: "", title_style: "" } };
  const defaultPlan = await buildComposePlan(saved.episode, { persona });
  check(defaultPlan.subtitles_enabled && defaultPlan.cuts[0]?.caption === episode.shots[0]?.caption, "legacy default captions propagated");
  const taskCount = db.query<{ count: number }, []>("select count(*) as count from tasks").get()!.count;
  await request(path, owner.cookie, "PATCH", { row_version: saved.row_version, patch: { render: { ...episode.render, subtitles_enabled: true } } });
  saved = await current(); check(!saved.episode.final_needs_recompose, "default-on to true is not an effective change");
  await request(path, owner.cookie, "PATCH", { row_version: saved.row_version, patch: { render: { ...episode.render, subtitles_enabled: false } } });
  saved = await current(); check(saved.episode.final_needs_recompose && saved.episode.render.subtitles_enabled === false, "saved toggle flags old final");
  check(JSON.stringify(saved.episode.music) === JSON.stringify(episode.music), "old music retained");
  check(saved.episode.render.intro === episode.render.intro && saved.episode.render.outro === episode.render.outro, "old bookends retained");
  check(saved.episode.final?.key === episode.final?.key, "old delivery retained");
  check(await request<string>(path + "/files/final/previous.mp4", owner.cookie) === "previous", "old artifact readable");
  await request(path, owner.cookie, "PATCH", { row_version: 1, patch: { render: episode.render } }, 409);
  await request(path, owner.cookie, "PATCH", { row_version: saved.row_version, patch: { render: { ...saved.episode.render, intro: "intro/unapproved.mp4" } } }, 400);
  await request(path + "/storyboard/sh_subtitle_1", owner.cookie, "PATCH", { row_version: saved.row_version, patch: { caption: "新的每镜字幕" } });
  saved = await current(); check(saved.episode.shots[0]?.caption === "新的每镜字幕", "caption saved");
  check(saved.episode.shots.every((s, i) => s.clip === episode.shots[i]?.clip && s.status === "approved"), "caption edit retains approved clips");
  check(db.query<{ count: number }, []>("select count(*) as count from tasks").get()!.count === taskCount, "no generation submitted");
  check(getCreditBalance(owner.id).available === 0 && getCreditBalance(owner.id).reserved === 0, "manual edits free");
  console.log("PASS real HTTP subtitles default/save/conflict/ownership, legacy assets retained, old final readable, caption edit retains clips; no generation or credits used.");
} finally {
  db.transaction(() => {
    for (const id of ids) { db.query("delete from tasks where episode_id=?").run(id); db.query("delete from episodes where episode_id=?").run(id); }
    for (const owner of owners) for (const table of ["credit_ledger", "credit_actions", "credit_accounts", "sessions", "users"]) {
      db.query(`delete from ${table} where user_id=?`).run(owner);
    }
  }).immediate();
  for (const id of ids) await rm(join(root, id), { recursive: true, force: true });
  check(db.query<{ quick_check: string }, []>("pragma quick_check").get()?.quick_check === "ok", "integrity after cleanup");
  close();
}
