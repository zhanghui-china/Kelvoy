// Private temporary episode + simulated LLM/Inference only. Worker must stay paused.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { open, close, createUser, createSession, insertEpisode, grantCredits,
  getCreditBalance, getEpisode, dequeueTask } from '../../packages/store/src/index';
import { runStage, type Destination, type Episode, type H3PromptContext,
  type Persona, type Shot, type Task, type Template } from '../../packages/engine/src/index';
import { createH3PromptWriter } from '../../apps/worker/src/generation/h3-prompt-writer';
import { createLocalGenerationProviders } from '../../apps/worker/src/generation/local';
import { handleTask } from '../../apps/worker/src/queue/consumer';

if (process.env.KELVOY_VERIFY_WORKER_PAUSED !== '1' || !process.env.KELVOY_DB_PATH ||
  !process.env.KELVOY_PROJECTS_ROOT || !process.env.KELVOY_VERIFY_BASE_URL) {
  throw Error('Paused Worker and explicit DB, projects and API URL required');
}
const db = open(), base = process.env.KELVOY_VERIFY_BASE_URL;
const root = process.env.KELVOY_PROJECTS_ROOT;
let owner = '', id = '', llmCalls = 0, inferenceCalls = 0;
let failInference = true;
const received: string[] = [];
const evidence: { mode: string; prompt: string }[] = [];
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
async function request(path: string, cookie: string, method = 'GET', body?: unknown) {
  const response = await fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  check(response.status === 200, `${method} ${path}: ${response.status}`);
  return await response.json();
}
function sections(c: H3PromptContext) {
  const timeline = `[Shot 1] A detail shot shows only hands and a Huangshan shaobing pastry, preserving the supplied composition. The camera holds a static shot as the hands make only a slight wrist rotation, continuously through 00:0${c.duration_s}.000 (${c.duration_s} seconds).`;
  const audio = { overall_soundscape: 'Quiet ambient sound continues throughout the single shot.', non_diegetic_music: 'N/A' };
  return c.mode === 'Ref2VA' ? { ...audio,
    subject_definitions: '<Subject 1> is the person whose identity comes from <Picture 1>, used only for the hands in this detail composition.\n<Subject 2> is the scene whose visual reference comes from <Picture 2>.',
    summary: '[reference generation] One continuous detail shot shows the hands of <Subject 1> with a pastry, using <Subject 2> as the scene reference.',
    retention_analysis: '<Subject 1> (appears in [Shot 1]): partially_preserved - only hands are framed, using the identity reference from <Picture 1>.\n<Subject 2> (appears in [Shot 1]): fully_preserved - the scene reference from <Picture 2> guides the background.',
    detailed_description: 'The target video preserves the supplied visual style and close composition.\n' + timeline + ' <Subject 1> remains in the hand-only composition within <Subject 2>.',
  } : { ...audio, integrated_multimodal_description: timeline + ' The shot begins from <Picture 1> and preserves its composition and visual anchors.' };
}
const simulatedFetch = (async (_url: unknown, init: RequestInit) => {
  llmCalls++;
  const body = JSON.parse(init.body as string);
  const c = JSON.parse(body.messages.find((message: { role: string }) => message.role === 'user').content) as H3PromptContext;
  check(body.messages[0].content.includes('Video Prompt Writing Guide'), 'official guide supplied');
  check(!JSON.stringify(c).includes('caption'), 'caption excluded from rewrite');
  return Response.json({ choices: [{ message: { content: JSON.stringify(sections(c)) } }] });
}) as typeof fetch;
const writer = createH3PromptWriter({ fetch: simulatedFetch, apiKey: 'simulation-only', model: 'step-3.5-flash', baseUrl: 'https://simulation.invalid' });
const providers = createLocalGenerationProviders(async (route, body) => {
  check(route === '/video/', 'only video inference'); inferenceCalls++;
  received.push(body.prompt);
  check(body.params.duration_s === 4 || body.params.duration_s === 5, 'H3 receives 4/5 seconds');
  if (failInference) return { ok: false, error: { code: 'network', message: 'simulated failure' } };
  const name = `h3_acceptance_${crypto.randomUUID()}.mp4`;
  await mkdir(join(root, 'inference/video'), { recursive: true });
  await writeFile(join(root, 'inference/video', name), 'synthetic-video');
  return { ok: true, response: { paths: [`inference/video/${name}`], model: 'mock-h3', version: 'acceptance', seed: body.seed, seconds: 0 } };
});
async function take(): Promise<Task> {
  // Never consume another owner's work. Cutover requires a globally idle queue.
  const foreign = db.query<{ n: number }, [string]>("select count(*) as n from tasks where episode_id != ? and status in ('pending','processing','held')").get(id);
  check(foreign?.n === 0, 'no foreign work during acceptance');
  const task = await dequeueTask(); check(task && task.episode_id === id, 'temporary task only'); return task;
}
try {
  check(db.query<{ n: number }, []>("select count(*) as n from tasks where status in ('held','pending','processing')").get()?.n === 0, 'idle queue');
  const user = await createUser({ username: `h3_acceptance_${crypto.randomUUID()}`, password_hash: 'acceptance-disabled' });
  check(user.ok, 'temporary account'); owner = user.user.user_id;
  const session = await createSession(owner), cookie = `kelvoy_session=${session.session_id}`;
  grantCredits(owner, 1000, `h3-acceptance-${owner}`);
  const persona = (await request('/api/personas', cookie)).personas.find((p: Persona) => p.owner_id === null) as Persona;
  const destination = (await request('/api/destinations', cookie)).destinations[0] as Destination;
  const template = (await request('/api/templates', cookie)).templates[0] as Template;
  check(persona && destination && template, 'existing catalog');
  id = `e_verify_h3_${crypto.randomUUID()}`;
  await mkdir(join(root, id, 'kf'), { recursive: true });
  await writeFile(join(root, id, 'person.png'), 'synthetic-person');
  await writeFile(join(root, id, 'scene.png'), 'synthetic-scene');
  await writeFile(join(root, id, 'kf/first.png'), 'synthetic-first-frame');
  const temporaryPersona = { ...persona, refs: [`${id}/person.png`, `${id}/person.png`, `${id}/person.png`] };
  const temporaryDestination = { ...destination, landmarks: [{ id: 'l1', name: '街头', best_time: '上午', must_keep: [], refs: [`${id}/scene.png`, `${id}/scene.png`, `${id}/scene.png`] }] };
  // No existing catalog row or reference image is modified.
  const shot: Shot = { no: 1, shot_id: 'sh_h3_acceptance', scene: 'sc1', size: 'detail',
    beat: '展示黄山烧饼', caption: '黄山烧饼', camera: 'static', landmark: null,
    kf_prompt: '仅手部与黄山烧饼细节', motion_prompt: '手腕轻微旋转，固定镜头', duration_s: 1,
    candidates: [], kf_selected: null, clip: null, trim_start_s: null, status: 'draft',
    regen_stage: null, bad_shot_reported: false, model: {} };
  const episode: Episode = { episode_id: id, name: 'H3 提示词临时验收', owner_id: owner,
    persona_id: persona.persona_id, persona_version: persona.version,
    destination_id: destination.destination_id, destination_version: destination.version,
    template_id: template.template_id, series_id: 'acceptance', status: 'script_review', mode: 'per_shot',
    video_source: 'references', cut_policy: 'fixed_1s', candidate_count: 1,
    created_at: new Date().toISOString(), estimated_credits: 0, credits_used: 0,
    share: { enabled: false, slug: '' }, brief: { season: '秋', aspect: '9:16', requirements: '', duration_s: 1, tone: '', outfit_override: null, banned: [] },
    scenes: [{ id: 'sc1', name: '街头', time: 'morning', landmarks: [] }], shots: [shot], removed_shots: [], grid_refs: [],
    music: { file: '', bpm: 0, license: '' }, render: { res: '1080x1920', fps: 30, title: '', intro: null, outro: null, ai_label: true } };
  await insertEpisode(episode);
  const path = `/api/episodes/${id}`;
  await request(path + '/continue', cookie, 'POST', { row_version: 1 });
  const reserved = getCreditBalance(owner).reserved; check(reserved > 0, 'video reservation');
  const overrides = { ...providers, h3PromptWriter: writer, persona: temporaryPersona, destination: temporaryDestination };
  await handleTask(await take(), overrides); // assets only
  await handleTask(await take(), overrides); // prompt published, simulated H3 failure
  await handleTask(await take(), overrides); // same prompt on second lease; failure releases credits
  check(llmCalls === 1 && inferenceCalls === 2, 'retry reuses compiled prompt');
  check(getCreditBalance(owner).reserved === 0 && getCreditBalance(owner).available === 1000, 'terminal failure refunds video action including rewrite');
  let detail = await request(path, cookie);
  await request(path + '/retry', cookie, 'POST', { row_version: detail.row_version });
  check(getCreditBalance(owner).reserved === reserved, 'retry price unchanged');
  failInference = false;
  await handleTask(await take(), overrides);
  detail = await request(path, cookie);
  const stored = detail.episode.shots[0] as Shot;
  check(llmCalls === 1 && inferenceCalls === 3, 'HTTP retry preserves rewrite cache');
  check(stored.model.video?.prompt === received.at(-1) && received.every(p => p === received[0]), 'H3 final prompt equals persisted model record');
  check(stored.model.video?.h3_prompt?.mode === 'Ref2VA' && stored.model.video.h3_prompt.duration_s === 4, 'provenance persisted');
  check(stored.kf_prompt === shot.kf_prompt && stored.motion_prompt === shot.motion_prompt && stored.caption === shot.caption && stored.duration_s === 1, 'Chinese original and one-second cut preserved');
  evidence.push({ mode: 'Ref2VA', prompt: stored.model.video.prompt });
  check(getCreditBalance(owner).reserved === 0 && getCreditBalance(owner).available === 1000 - reserved, 'only original video price settled');
  await request(path + '/storyboard/' + stored.shot_id, cookie, 'PATCH', { row_version: detail.row_version, patch: { motion_prompt: '手腕轻微旋转，固定镜头，保持构图' } });
  check(llmCalls === 1 && inferenceCalls === 3, 'manual save does not invoke models');
  const latest = await getEpisode(id); check(latest.ok, 'saved episode');
  const regenerated = await runStage('video', { ...latest.episode, status: 'clipping', shots: [{ ...latest.episode.shots[0]!, status: 'generating_clip' }] }, 1,
    { ...overrides, generation_id: 'acceptance-edited', shot_id: stored.shot_id });
  check(llmCalls === 2, 'editing invalidates rewrite cache');
  await writeFile(join(root, id, 'scene.png'), 'synthetic-replacement-scene');
  await runStage('video', { ...regenerated, status: 'clipping', shots: [{ ...regenerated.shots[0]!, status: 'generating_clip' }] }, 1,
    { ...overrides, generation_id: 'acceptance-replaced', shot_id: stored.shot_id });
  check(llmCalls === 3, 'replacement image invalidates rewrite cache');
  const i2va = await runStage('video', { ...episode, video_source: 'keyframe', status: 'clipping',
    shots: [{ ...shot, duration_s: 5, status: 'generating_clip', candidates: ['kf/first.png'], kf_selected: 'kf/first.png' }] }, 1,
    { ...overrides, generation_id: 'acceptance-i2va', shot_id: shot.shot_id });
  check(i2va.shots[0]?.model.video?.h3_prompt?.duration_s === 5, 'five-second I2VA');
  check(i2va.shots[0]?.model.video?.prompt === received.at(-1), 'I2VA prompt equals request');
  evidence.push({ mode: 'I2VA', prompt: i2va.shots[0]!.model.video!.prompt });
  console.log(JSON.stringify({ result: 'PASS', simulated_models_only: true, llm_calls: llmCalls, inference_calls: inferenceCalls,
    verified: ['official guides', 'Ref2VA order', 'I2VA first frame', '4/5 seconds', 'static shaobing detail', 'Chinese originals', 'lease + HTTP retry cache', 'edit/image invalidation', 'manual save free', 'failure refund', 'record/request equality'], prompts: evidence }, null, 2));
} finally {
  if (owner) db.transaction(() => {
    db.query('delete from tasks where episode_id in (select episode_id from episodes where owner_id=?)').run(owner);
    db.query('delete from episodes where owner_id=?').run(owner);
    for (const table of ['credit_ledger', 'credit_actions', 'credit_accounts', 'sessions', 'users']) db.query(`delete from ${table} where user_id=?`).run(owner);
  }).immediate();
  if (id) await rm(join(root, id), { recursive: true, force: true });
  check(db.query<{ quick_check: string }, []>('pragma quick_check').get()?.quick_check === 'ok', 'integrity after cleanup');
  close();
}
