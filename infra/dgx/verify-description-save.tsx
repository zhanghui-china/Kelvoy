// HTTP acceptance uses disposable private episodes only; original work is rendered read-only.
import { open, close, createUser, createSession, insertEpisode, getEpisode, storyboardBusy } from "../../packages/store/src/index";
import type { Episode, Shot } from "../../packages/engine/src/index";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EpisodeDetailContent } from "../../apps/web/src/frontend/pages/EpisodeDetailPage";
import type { EpisodeMutation } from "../../apps/web/src/frontend/review/useEpisodeMutation";

if (process.env.KELVOY_VERIFY_WORKER_PAUSED !== "1") throw Error("Pause Worker and set KELVOY_VERIFY_WORKER_PAUSED=1");
const db = open();
const base = process.env.KELVOY_VERIFY_BASE_URL ?? "http://127.0.0.1:8888";
const projects = process.env.KELVOY_PROJECTS_ROOT!;
if (!projects) throw Error("Set KELVOY_PROJECTS_ROOT");
const owners: string[] = [], episodeIds: string[] = [];
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
async function account() {
  const user = await createUser({ username: `description_acceptance_${crypto.randomUUID()}`, password_hash: "acceptance-disabled" });
  check(user.ok, "temporary user");
  owners.push(user.user.user_id);
  const session = await createSession(user.user.user_id);
  return { id: user.user.user_id, cookie: `kelvoy_session=${session.session_id}` };
}
async function request(path: string, cookie: string, body?: unknown, status = 200) {
  const response = await fetch(base + path, { method: body ? "PATCH" : "GET", headers: { cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  check(response.status === status, `${path}: expected ${status}, got ${response.status}`);
  return response.json();
}
function shot(no: number, status: Shot["status"]): Shot {
  return { no, scene: "sc1", size: "wide", beat: "山顶看晨光", camera: "static", landmark: null,
    kf_prompt: "山顶晨光", motion_prompt: "缓慢移动", duration_s: 2, candidates: [`kf/${no}.png`],
    kf_selected: `kf/${no}.png`, clip: `clip/${no}.mp4`, trim_start_s: null,
    status, regen_stage: null, bad_shot_reported: false, model: {} };
}
try {
  const owner = await account(), other = await account();
  for (const status of ["failed", "kf_selected", "kf_ready", "approved"] as const) {
    const id = `e_description_acceptance_${crypto.randomUUID()}`;
    const episode: Episode = { name: "画面描述保存临时验收", episode_id: id, owner_id: owner.id,
      persona_id: "acceptance", persona_version: 1, destination_id: "acceptance", destination_version: 1,
      series_id: "acceptance", template_id: "acceptance", status: "kf_review", mode: "per_shot", candidate_count: 2,
      created_at: new Date().toISOString(), estimated_credits: 0, credits_used: 0,
      share: { enabled: false, slug: "" }, brief: { season: "秋", aspect: "9:16", requirements: "", duration_s: 4, tone: "松弛", outfit_override: null, banned: [] },
      grid_refs: [], scenes: [{ id: "sc1", name: "山顶", time: "morning", landmarks: [] }],
      shots: [shot(1, status), shot(2, "approved")], removed_shots: [], music: { file: "", bpm: 0, license: "" },
      render: { res: "1080x1920", fps: 30, title: "", intro: null, outro: null, ai_label: true },
      final: { version: 1, key: "final/old.mp4", duration_s: 4, width: 1080, height: 1920, fps: 30, size_bytes: 3, completed_at: new Date().toISOString() } };
    await insertEpisode(episode); episodeIds.push(id);
    const dir = join(projects, id); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "history.txt"), "old media preserved");
    const path = `/api/episodes/${id}`, before = await request(path, owner.cookie);
    const body = { row_version: before.row_version, patch: { kf_prompt: "山顶晨光" } };
    for (let repeat = 0; repeat < 2; repeat++) {
      const result = await request(`${path}/shots/1`, owner.cookie, body);
      check(result.row_version === before.row_version, "no-op version retained");
      check(JSON.stringify(await request(path, owner.cookie)) === JSON.stringify(before), "no-op retains entire detail");
    }
    await request(`${path}/shots/1`, other.cookie, body, 404);
    await request(`${path}/shots/1`, owner.cookie, { ...body, row_version: 999 }, 409);
    await request(`${path}/shots/1`, owner.cookie, { ...body, patch: { kf_prompt: "" } }, 400);
    await request(`${path}/shots/1`, owner.cookie, { ...body, patch: { kf_prompt: "新的山顶晨光" } });
    const after = await request(path, owner.cookie);
    check(after.episode.status === "script_review", "changed save reopens script review");
    check(after.episode.shots[0].status === "draft" && after.episode.shots[0].candidates.length === 0 && after.episode.shots[0].kf_selected === null && after.episode.shots[0].clip === null, "target refs invalidated");
    check(JSON.stringify(after.episode.shots[1]) === JSON.stringify(before.episode.shots[1]), "other shot retained");
    check(JSON.stringify(after.episode.final) === JSON.stringify(before.episode.final), "old final retained");
    check(await readFile(join(dir, "history.txt"), "utf8") === "old media preserved", "historical file retained");
    check(!storyboardBusy(id), "save never queues generation");
    console.log(`PASS ${status}: unchanged/changed save; owner/conflict/validation; other shot, old final and historical file retained`);
  }
  const originalId = process.env.KELVOY_VERIFY_ORIGINAL_EPISODE;
  if (originalId) {
    const before = await getEpisode(originalId); check(before.ok, "original exists");
    check(before.episode.status === "kf_review" && before.episode.shots[0].status === "failed" && !storyboardBusy(originalId), "original failed shot is idle in keyframe review");
    const mutation: EpisodeMutation = { pending: false, error: null, clearError() {}, async run() { throw Error("Read-only acceptance cannot mutate"); } };
    const html = renderToStaticMarkup(<StaticRouter location={`/episodes/${originalId}`}>
      <EpisodeDetailContent episode={before.episode} destination={null} persona={null} mutation={mutation} storyboardBusy={false} />
    </StaticRouter>);
    const first = html.match(/<article[^>]*data-shot-no="1"[\s\S]*?<\/article>/)?.[0];
    check(first, "original first shot rendered");
    for (const label of ["修改画面描述", "保存画面描述"]) {
      const button = first.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0];
      check(button && !button.includes("disabled"), `original ${label} enabled`);
    }
    check(JSON.stringify(await getEpisode(originalId)) === JSON.stringify(before), "original untouched");
    console.log("PASS original first-shot edit/save enabled in real component read-only render; no original PATCH or generation");
  }
} finally {
  db.transaction(() => {
    for (const owner of owners) {
      for (const id of episodeIds) db.query("delete from tasks where episode_id=?").run(id);
      db.query("delete from episodes where owner_id=?").run(owner);
      for (const table of ["credit_ledger", "credit_actions", "credit_accounts", "sessions", "users"]) db.query(`delete from ${table} where user_id=?`).run(owner);
    }
  }).immediate();
  for (const id of episodeIds) await rm(join(projects, id), { recursive: true, force: true });
  check(db.query<{ quick_check: string }, []>("pragma quick_check").get()?.quick_check === "ok", "database integrity after cleanup");
  close();
}
