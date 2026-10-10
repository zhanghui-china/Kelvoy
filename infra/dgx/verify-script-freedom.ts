// Synthetic private scripts only. Worker must remain paused; no LLM/GPU calls.
import { open, close, createUser, createSession, insertEpisode, grantCredits } from '../../packages/store/src/index';
import type { Destination, Episode, Persona, Shot, Template } from '../../packages/engine/src/index';
if (process.env.KELVOY_VERIFY_WORKER_PAUSED !== '1') throw Error('Pause Worker and set KELVOY_VERIFY_WORKER_PAUSED=1');
if (!process.env.KELVOY_DB_PATH || !process.env.KELVOY_VERIFY_BASE_URL) throw Error('Explicit database and API URL required');
const db = open(), base = process.env.KELVOY_VERIFY_BASE_URL;
let owner = '';
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
async function request(path: string, cookie: string, body?: unknown, status = 200) {
 const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
 check(response.status === status, `${path}: expected ${status}, got ${response.status}`);
 return await response.json();
}
try {
 const user = await createUser({ username: `script_freedom_${crypto.randomUUID()}`, password_hash: 'acceptance-disabled' });
 check(user.ok, 'temporary user'); owner = user.user.user_id;
 const session = await createSession(owner), cookie = `kelvoy_session=${session.session_id}`;
 grantCredits(owner, 10000, `script-freedom-${owner}`);
 const persona = (await request('/api/personas', cookie)).personas.find((p: Persona) => p.owner_id === null) as Persona;
 const destination = (await request('/api/destinations', cookie)).destinations[0] as Destination;
 const template = (await request('/api/templates', cookie)).templates[0] as Template;
 check(persona && destination && template, 'existing catalog');
 const shot = (no: number): Shot => ({ no, shot_id: `sh_verify_${crypto.randomUUID()}`, scene: 'sc1', size: 'wide', beat: '漫步', caption: '景区', camera: 'static', landmark: null, kf_prompt: '景区远景', motion_prompt: '缓慢前行', duration_s: 1, candidates: [], kf_selected: null, clip: null, trim_start_s: null, status: 'draft', regen_stage: null, bad_shot_reported: false, model: {} });
 async function verify(count: number, invalid?: string) {
  const id = `e_verify_freedom_${crypto.randomUUID()}`;
  const shots = Array.from({ length: count }, (_, i) => shot(i + 1));
  if (invalid === 'scene') shots[0]!.scene = 'unknown';
  if (invalid === 'landmark') shots[0]!.landmark = 'unknown';
  if (invalid === 'field') shots[0]!.beat = '';
  if (invalid === 'content') shots[0]!.kf_prompt = '色情场景';
  const episode: Episode = { episode_id: id, name: '脚本配额临时验收', owner_id: owner, persona_id: persona.persona_id, persona_version: persona.version, destination_id: destination.destination_id, destination_version: destination.version, template_id: template.template_id, series_id: 'verify', status: 'script_review', mode: 'per_shot', video_source: 'references', cut_policy: 'fixed_1s', candidate_count: 1, created_at: new Date().toISOString(), estimated_credits: 0, credits_used: 0, share: { enabled: false, slug: '' }, brief: { season: '秋', aspect: '9:16', requirements: '', duration_s: count, tone: '', outfit_override: null, banned: [] }, grid_refs: [], scenes: [{ id: 'sc1', name: '景区', time: 'morning', landmarks: [] }], shots, removed_shots: [], music: { file: '', bpm: 0, license: '' }, render: { res: '1080x1920', fps: 30, title: '', intro: null, outro: null, ai_label: true } };
  await insertEpisode(episode);
  const path = `/api/episodes/${id}`;
  const detail = await request(path, cookie);
  check(Array.isArray(detail.storyboard_warnings) && detail.storyboard_warnings.length === 0, 'no quota warnings');
  const rejected = !!invalid || count === 0;
  const result = await request(path + '/continue', cookie, { row_version: 1 }, rejected ? 400 : 200);
  if (rejected) check(result.error === 'script_rule_violation', 'necessary validation retained');
  check(db.query<{ n: number }, [string]>('select count(*) as n from tasks where episode_id=? and status="processing"').get(id)?.n === 0, 'Worker remains paused');
 }
 for (const count of [1, 10, 23, 31, 40]) await verify(count);
 await verify(0);
 for (const invalid of ['scene', 'landmark', 'field', 'content']) await verify(1, invalid);
 console.log('PASS HTTP: free shot count, zero landmarks, consecutive same size, no warnings; empty/invalid/content blocked. Synthetic queue only; no LLM/GPU run.');
} finally {
 if (owner) db.transaction(() => {
  db.query('delete from tasks where episode_id in (select episode_id from episodes where owner_id=?)').run(owner);
  db.query('delete from episodes where owner_id=?').run(owner);
  for (const table of ['credit_ledger', 'credit_actions', 'credit_accounts', 'sessions', 'users']) db.query(`delete from ${table} where user_id=?`).run(owner);
 }).immediate();
 check(db.query<{ quick_check: string }, []>('pragma quick_check').get()?.quick_check === 'ok', 'integrity after cleanup');
 close();
}
