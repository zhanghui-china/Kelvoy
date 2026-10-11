/**
 * ADR-0012 release acceptance on an isolated database and port: seeds records through the release's own store,
 * starts the release's Web server against them and checks the HTTP behaviour. Never touches the production
 * database or projects directory. Run from <release>/apps/worker so "@kelvoy/store" resolves:
 *   cd <release>/apps/worker && RELEASE_DIR=<release> bun -e "$(cat <release>/infra/dgx/verify-prompt-traces.ts)"
 * (`bun -e` resolves workspace packages from the cwd; a script file under infra/ would not find them.)
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, createUser, deleteEpisode, insertEpisode, insertPromptTraces, listPromptTraces, open, getDb } from "@kelvoy/store";

const release = process.env.RELEASE_DIR;
if (!release) throw new Error("RELEASE_DIR is required");
const root = await mkdtemp(join(tmpdir(), "kelvoy-prompt-traces-accept-"));
const dbPath = join(root, "kelvoy.db");
const port = 20000 + Math.floor(Math.random() * 20000);
const results: Record<string, boolean | string | number> = {};
const check = (name: string, ok: boolean) => { results[name] = ok; };
const SECRET = "ACCEPT_SECRET_PATH";
let server: Bun.Subprocess | undefined;
try {
  open(dbPath);
  const hash = await Bun.password.hash("accept-" + crypto.randomUUID());
  const password = "accept-pass-" + crypto.randomUUID().slice(0, 8);
  const pwHash = await Bun.password.hash(password);
  const owner = ((await createUser({ username: "accept_owner", password_hash: pwHash })) as any).user.user_id as string;
  const other = ((await createUser({ username: "accept_other", password_hash: pwHash })) as any).user.user_id as string;
  void hash;
  const eid = "e_accept_traces_0001";
  const shot = (no: number, o: Record<string, unknown> = {}) => ({ no, shot_id: `sh_${no}`, scene: "sc1", size: "wide", beat: "b",
    camera: "static", landmark: null, kf_prompt: "k", motion_prompt: "m", duration_s: 4, candidates: [], kf_selected: null,
    clip: null, trim_start_s: null, status: "clip_ready", regen_stage: null, bad_shot_reported: false, model: {}, ...o });
  await insertEpisode({ name: "accept", episode_id: eid, owner_id: owner, persona_id: "c", persona_version: 1, destination_id: "d",
    destination_version: 1, series_id: "s", template_id: "t", status: "done", mode: "per_shot", candidate_count: 2,
    video_source: "references", created_at: "2026-10-11T00:00:00+08:00", estimated_credits: 0, credits_used: 0,
    share: { enabled: true, slug: "accept-slug-" + crypto.randomUUID().slice(0, 8) },
    brief: { season: "秋", aspect: "9:16", requirements: "", duration_s: 30, tone: "t", outfit_override: null, banned: [] },
    grid_refs: [], scenes: [{ id: "sc1", name: "s", time: "morning", landmarks: [] }],
    shots: [shot(1, { clip: "clip/1.mp4", model: { video: { provider: "comfyui", model: "h3", version: "1", seed: 1,
      prompt: "FINAL_ONLY_PROMPT", ref_hashes: [], attempts: 1, cost_usd: 0 } } }), shot(2)],
    removed_shots: [], music: { file: "music/ACCEPT_MUSIC.mp3", bpm: 0, license: "" },
    final: { version: 1, key: "final/ACCEPT_FINAL_KEY.mp4", duration_s: 16, width: 1080, height: 1920, fps: 30, size_bytes: 1, completed_at: "2026-10-11T00:00:00Z" },
    render: { res: "1080x1920", fps: 30, title: "验收", intro: null, outro: null, ai_label: true } } as any);
  const slug = (JSON.parse(getDb().query("select doc from episodes where episode_id = ?").get(eid)!["doc" as never] as string)).share.slug as string;
  const T = (id: string, attempt = 1) => ({ task_id: id, attempt, episode_id: eid }) as any;
  const context = JSON.stringify({ mode: "Ref2VA", duration_s: 4, references: [{ key: `${eid}/kf/${SECRET}.png`, role: "person", picture: 1 }] });
  const db = getDb();
  insertPromptTraces(db, T("tk_s"), [
    { kind: "script_generate", round: 1, source: "llm", outcome: "rule_violation", user_message: "SCRIPT_R1" },
    { kind: "script_generate", round: 2, source: "llm", outcome: "accepted", user_message: "SCRIPT_R2" }] as any);
  insertPromptTraces(db, T("tk_v1"), [{ kind: "h3_rewrite", shot_id: "sh_2", source: "llm", outcome: "prompt_format_invalid",
    rule: "invalid visible retention syntax", model: "step-5-preview", skill_version: "a".repeat(64), writer_version: "h3-writer-v1",
    h3_mode: "Ref2VA", user_message: context, input_hash: "f".repeat(64) }] as any);
  close();

  server = Bun.spawn(["bun", "src/server/index.ts"], { cwd: join(release, "apps/web"), stdout: "ignore", stderr: "ignore",
    env: { ...process.env, PORT: String(port), KELVOY_DB_PATH: dbPath, KELVOY_PROJECTS_ROOT: join(root, "projects") } });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await Bun.sleep(250); }
  const login = async (username: string) => {
    const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    return res.headers.get("set-cookie")?.split(";")[0] ?? "";
  };
  const ownerCookie = await login("accept_owner"), otherCookie = await login("accept_other");
  check("login", ownerCookie !== "" && otherCookie !== "");
  const get = (path: string, cookie = ownerCookie) => fetch(`${base}${path}`, { headers: { cookie } });

  const script = await (await get(`/api/episodes/${eid}/prompts?kind=script`)).json() as any;
  check("script_two_rounds_newest_first", script.items?.length === 2 && script.items[0].round === 2 && script.items[0].validated === true);
  const rawVideo = await (await get(`/api/episodes/${eid}/prompts?kind=video&shot_id=sh_2`)).text();
  const video = JSON.parse(rawVideo);
  check("video_failed_attempt_has_rule", video.items?.[0]?.validated === false && video.items[0].rule === "invalid visible retention syntax");
  check("video_references_redacted", !rawVideo.includes(SECRET) && !rawVideo.includes("f".repeat(64)) && video.items[0].input_hash.length === 12);
  check("video_no_internal_ids", !/tk_v1|task_id|owner_id/.test(rawVideo) && !rawVideo.includes(owner));
  const legacy = await (await get(`/api/episodes/${eid}/prompts?kind=video&shot_id=sh_1`)).json() as any;
  check("legacy_final_only", legacy.legacy?.note === "final_only");
  const foreign = await get(`/api/episodes/${eid}/prompts?kind=script`, otherCookie);
  const missing = await get(`/api/episodes/e_does_not_exist/prompts?kind=script`);
  check("other_user_404_same_as_missing", foreign.status === 404 && missing.status === 404 && (await foreign.text()) === (await missing.text()));
  check("no_session_401", (await fetch(`${base}/api/episodes/${eid}/prompts?kind=script`)).status === 401);
  const shareText = await (await fetch(`${base}/api/share/${slug}`)).text();
  const shareEpisode = JSON.parse(shareText).episode;
  check("share_whitelist_only", JSON.stringify(Object.keys(shareEpisode).sort()) === JSON.stringify(["episode_id", "final", "shot_count", "status", "title"]));
  check("share_no_trace_or_paths", !/SCRIPT_R|FINAL_ONLY_PROMPT|ACCEPT_MUSIC|ACCEPT_FINAL_KEY|prompt/.test(shareText));
  const detail = await (await get(`/api/episodes/${eid}`)).text();
  check("detail_has_no_trace_text", !detail.includes("SCRIPT_R1") && !detail.includes("invalid visible retention syntax"));

  open(dbPath);
  const before = (await listPromptTraces({ episodeId: eid, ownerId: owner, kind: "script", limit: 50 })).items.length;
  const { deleteEpisode: _ignored } = await import("@kelvoy/store");
  void _ignored;
  const removed = await deleteEpisode(eid, owner);
  const after = getDb().query("select count(*) as n from prompt_traces where episode_id = ?").get(eid) as { n: number };
  check("delete_removes_traces", before === 2 && (removed as any).ok === true && after.n === 0);
  close();
} finally {
  server?.kill();
  await rm(root, { recursive: true, force: true });
}
const failed = Object.entries(results).filter(([, ok]) => ok !== true).map(([name]) => name);
console.log(JSON.stringify({ status: failed.length === 0 ? "ok" : "failed", checks: Object.keys(results).length, failed }));
process.exit(failed.length === 0 ? 0 : 1);
