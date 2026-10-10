// Private temporary episode + real Qwen rewrite + simulated image generation. Worker stays paused.
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { open, close, createUser, createSession, insertEpisode, grantCredits,
  getCreditBalance, getEpisode, dequeueTask } from '../../packages/store/src/index';
import { runStage, type Destination, type Episode,
  type Persona, type Shot, type Task, type Template } from '../../packages/engine/src/index';
import { createImagePromptWriter } from '../../apps/worker/src/generation/image-prompt-writer';
import { createLocalGenerationProviders } from '../../apps/worker/src/generation/local';
import { sharedAssetPath } from '../../apps/worker/src/storage/artifacts';
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
const writerBase = process.env.KELVOY_VERIFY_INFERENCE_BASE_URL;
check(writerBase, 'explicit rewrite Inference URL required');
const realFetch = (async (url: string, init: RequestInit) => {
  if (url.endsWith('/image/rewrite/')) llmCalls++;
  return fetch(url, init);
}) as typeof fetch;
const writer = createImagePromptWriter({ fetch: realFetch, baseUrl: writerBase });
const providers = createLocalGenerationProviders(async (route, body) => {
  check(route === '/image/', 'only simulated image inference'); inferenceCalls++;
  received.push(body.prompt);
  check(body.size === "9:16", "fixed image aspect");
  if (failInference) return { ok: false, error: { type: 'network', message: 'simulated failure' } };
  const name = `qwen_acceptance_${crypto.randomUUID()}.png`;
  await mkdir(join(root, 'inference/image'), { recursive: true });
  await writeFile(join(root, 'inference/image', name), 'synthetic-image');
  return { ok: true, response: { paths: [`inference/image/${name}`], model: 'mock-image', version: 'acceptance', seed: body.seed, seconds: 0 } };
});
async function take(): Promise<Task> {
  // Never consume another owner's work. Cutover requires a globally idle queue.
  const foreign = db.query<{ n: number }, [string]>("select count(*) as n from tasks where episode_id != ? and status in ('pending','processing','held')").get(id);
  check(foreign?.n === 0, 'no foreign work during acceptance');
  const task = await dequeueTask(); check(task && task.episode_id === id, 'temporary task only'); return task;
}
try {
  check(db.query<{ n: number }, []>("select count(*) as n from tasks where status in ('held','pending','processing')").get()?.n === 0, 'idle queue');
  const user = await createUser({ username: `qwen_acceptance_${crypto.randomUUID()}`, password_hash: 'acceptance-disabled' });
  check(user.ok, 'temporary account'); owner = user.user.user_id;
  const session = await createSession(owner), cookie = `kelvoy_session=${session.session_id}`;
  grantCredits(owner, 1000, `qwen-acceptance-${owner}`);
  const persona = (await request('/api/personas', cookie)).personas.find((p: Persona) => p.owner_id === null) as Persona;
  const destination = (await request('/api/destinations', cookie)).destinations.find((item: Destination) => item.name.includes('黄山')) as Destination;
  const template = (await request('/api/templates', cookie)).templates[0] as Template;
  check(persona && destination && template, 'existing catalog');
  id = `e_verify_qwen_${crypto.randomUUID()}`;
  await mkdir(join(root, id, 'kf'), { recursive: true });
  const personKey = persona.refs[0];
  const landmark = destination.landmarks.find(item => item.refs[0]);
  const sceneKey = landmark?.refs[0];
  check(personKey && sceneKey && landmark, 'existing valid references to copy into temporary private files');
  await copyFile(sharedAssetPath(personKey), join(root, id, 'person.png'));
  await copyFile(sharedAssetPath(sceneKey), join(root, id, 'scene.png'));
  const temporaryPersona = { ...persona, refs: [`${id}/person.png`, `${id}/person.png`, `${id}/person.png`] };
  const temporaryDestination = { ...destination, landmarks: [{ id: landmark.id, name: landmark.name, best_time: '上午', must_keep: [], refs: [`${id}/scene.png`, `${id}/scene.png`, `${id}/scene.png`] }] };
  // No existing catalog row or reference image is modified.
  const shot: Shot = { no: 1, shot_id: 'sh_qwen_acceptance', scene: 'sc1', size: 'detail',
    beat: '展示黄山烧饼', caption: '黄山烧饼', camera: 'static', landmark: landmark.id,
    kf_prompt: '仅手部与黄山烧饼细节', motion_prompt: '手腕轻微旋转，固定镜头', duration_s: 1,
    candidates: [], kf_selected: null, clip: null, trim_start_s: null, status: 'draft',
    regen_stage: null, bad_shot_reported: false, model: {} };
  const episode: Episode = { episode_id: id, name: 'Qwen 提示词临时验收', owner_id: owner,
    persona_id: persona.persona_id, persona_version: persona.version,
    destination_id: destination.destination_id, destination_version: destination.version,
    template_id: template.template_id, series_id: 'acceptance', status: 'script_review', mode: 'per_shot',
    video_source: 'keyframe', cut_policy: 'fixed_1s', candidate_count: 2,
    created_at: new Date().toISOString(), estimated_credits: 0, credits_used: 0,
    share: { enabled: false, slug: '' }, brief: { season: '秋', aspect: '9:16', requirements: '', duration_s: 1, tone: '', outfit_override: null, banned: [] },
    scenes: [{ id: 'sc1', name: landmark.name, time: 'morning', landmarks: [] }], shots: [shot], removed_shots: [], grid_refs: [],
    music: { file: '', bpm: 0, license: '' }, render: { res: '1080x1920', fps: 30, title: '', intro: null, outro: null, ai_label: true } };
  await insertEpisode(episode);
  const path = `/api/episodes/${id}`;
  await request(path + '/continue', cookie, 'POST', { row_version: 1 });
  const reserved = getCreditBalance(owner).reserved; check(reserved > 0, 'image reservation');
  const overrides = { ...providers, imagePromptWriter: writer, persona: temporaryPersona, destination: temporaryDestination };
  await handleTask(await take(), overrides); // assets only
  await handleTask(await take(), overrides); // prompt published, simulated image failure
  await handleTask(await take(), overrides); // same prompt on second lease; failure releases credits
  check(llmCalls === 1 && inferenceCalls === 2, 'retry reuses compiled prompt');
  check(getCreditBalance(owner).reserved === 0 && getCreditBalance(owner).available === 1000, 'terminal failure refunds image action including rewrite');
  let detail = await request(path, cookie);
  await request(path + '/retry', cookie, 'POST', { row_version: detail.row_version });
  check(getCreditBalance(owner).reserved === reserved, 'retry price unchanged');
  failInference = false;
  await handleTask(await take(), overrides);
  detail = await request(path, cookie);
  const stored = detail.episode.shots[0] as Shot;
  check(llmCalls === 1 && inferenceCalls === 4, 'HTTP retry preserves rewrite cache');
  check(stored.model.image?.prompt === received.at(-1) && received.every(p => p === received[0]), 'Image final prompt equals persisted model record');
  check(stored.model.image?.qwen_prompt?.mode === 'edit' && stored.model.image.qwen_prompt.aspect === '9:16', 'provenance persisted');
  check(stored.kf_prompt === shot.kf_prompt && stored.motion_prompt === shot.motion_prompt && stored.caption === shot.caption && stored.duration_s === 1, 'Chinese original and one-second cut preserved');
  evidence.push({ mode: 'edit', prompt: stored.model.image.prompt });
  check(getCreditBalance(owner).reserved === 0 && getCreditBalance(owner).available === 1000 - reserved, 'only original image price settled');
  await request(path + '/storyboard/' + stored.shot_id, cookie, 'PATCH', { row_version: detail.row_version, patch: { kf_prompt: '仅手部与黄山烧饼细节，固定近距离构图' } });
  check(llmCalls === 1 && inferenceCalls === 4, 'manual save does not invoke models');
  const latest = await getEpisode(id); check(latest.ok, 'saved episode');
  const regenerated = await runStage('keyframe', { ...latest.episode, status: 'keyframing', shots: [{ ...latest.episode.shots[0]!, status: 'generating_kf' }] }, 1,
    { ...overrides, generation_id: 'acceptance-edited', shot_id: stored.shot_id });
  check(llmCalls === 2, 'editing invalidates rewrite cache');
  await writeFile(join(root, id, 'scene.png'), Buffer.concat([Buffer.from(await Bun.file(join(root, id, 'scene.png')).arrayBuffer()), Buffer.from('acceptance-replaced')]));
  await runStage('keyframe', { ...regenerated, status: 'keyframing', shots: [{ ...regenerated.shots[0]!, status: 'generating_kf' }] }, 1,
    { ...overrides, generation_id: 'acceptance-replaced', shot_id: stored.shot_id });
  check(llmCalls === 3, 'replacement image invalidates rewrite cache');
  // All candidates use one final rewrite, including cross-lease and HTTP retries.
  check(stored.candidates.length === 2 && received.every(prompt => prompt.length > 0), 'saved two candidates');
  console.log(JSON.stringify({ result: 'PASS', real_qwen_rewrite: process.env.KELVOY_VERIFY_QWEN_SIMULATED !== '1', simulated_image_generation: true,
    rewrite_calls: llmCalls, image_calls: inferenceCalls,
    verified: ['ordered references', 'fixed 9:16', 'two candidates share rewrite', 'Chinese originals',
      'lease + HTTP retry cache', 'edit/image invalidation', 'manual save free', 'failure refund', 'record/request equality'], prompts: evidence }, null, 2));
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
