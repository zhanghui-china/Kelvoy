// Operational HTTP acceptance. Worker must be paused; only temporary owners are cleaned.
import { open, close, createUser, createSession, grantCredits, getCreditBalance, getPersonaVersion } from '../../packages/store/src/index';
import type { Persona, Episode, Destination, Template } from '../../packages/engine/src/index';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
if (process.env.KELVOY_VERIFY_WORKER_PAUSED !== '1') throw new Error('Pause Worker and set KELVOY_VERIFY_WORKER_PAUSED=1');
const database = open();
const base = process.env.KELVOY_VERIFY_BASE_URL ?? 'http://127.0.0.1:8888';
const owners: string[] = [], personaIds: string[] = [];
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function account(label: string) {
  const result = await createUser({ username: `persona_delete_acceptance_${label}_${crypto.randomUUID()}`, password_hash: 'acceptance-account-login-disabled' });
  check(result.ok, 'temporary user creation');
  owners.push(result.user.user_id);
  const session = await createSession(result.user.user_id);
  return { id: result.user.user_id, cookie: `kelvoy_session=${session.session_id}` };
}
async function request<T>(path: string, cookie: string, method = 'GET', body?: unknown, expected = 200): Promise<T> {
  const response = await fetch(base + path, { method, headers: { cookie, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  check(response.status === expected, `${method} ${path}: expected ${expected}, got ${response.status}`);
  return response.headers.get('content-type')?.includes('application/json') ? await response.json() as T : await response.arrayBuffer() as T;
}
try {
  const owner = await account('owner'), other = await account('other');
  const initial = { name: '角色删除临时验收', desc: '虚构角色', locked: ['脸型'], default_outfit: '外套', style: { lut: 'warm', title_style: 'clean' } };
  let persona = (await request<{persona: Persona}>('/api/personas', owner.cookie, 'POST', initial, 201)).persona;
  personaIds.push(persona.persona_id);
  const photo = await Bun.file(new URL('../../assets/demo/persona/c_official_aching/front.jpg', import.meta.url)).arrayBuffer();
  const form = new FormData();
  for (let i = 0; i < 3; i++) form.append('files', new File([photo], `${i}.jpg`, { type: 'image/jpeg' }));
  persona = (await request<{persona: Persona}>(`/api/personas/${persona.persona_id}/refs`, owner.cookie, 'POST', form, 201)).persona;
  const frozenVersion = persona.version, key = persona.refs[0]!;
  const official = (await request<{personas: Persona[]}>('/api/personas', owner.cookie)).personas.find(p => p.owner_id === null);
  const destination = (await request<{destinations: Destination[]}>('/api/destinations', owner.cookie)).destinations[0];
  const template = (await request<{templates: Template[]}>('/api/templates', owner.cookie)).templates.find(t => t.owner_id === null);
  check(official && destination && template, 'official catalog fixtures');
  check(getCreditBalance(owner.id).available === 0, 'role creation and upload do not debit credits');
  grantCredits(owner.id, 5, `persona_acceptance_${owner.id}`);
  const body = { persona_id: persona.persona_id, destination_id: destination.destination_id, template_id: template.template_id };
  const episode = (await request<{episode: Episode}>('/api/episodes', owner.cookie, 'POST', body, 201)).episode;
  check(episode.persona_version === frozenVersion, 'episode freezes uploaded revision');
  persona = (await request<{persona: Persona}>(`/api/personas/${persona.persona_id}`, owner.cookie, 'PATCH', { name: '删除验收新版本' })).persona;
  check(persona.version > frozenVersion, 'editing remains available and creates revision');
  await request(`/api/personas/${persona.persona_id}`, owner.cookie, 'DELETE', { version: frozenVersion }, 409);
  await request(`/api/personas/${persona.persona_id}`, other.cookie, 'DELETE', { version: persona.version }, 404);
  await request(`/api/personas/${official.persona_id}`, owner.cookie, 'DELETE', { version: official.version }, 404);
  const balanceBefore = getCreditBalance(owner.id);
  await request(`/api/personas/${persona.persona_id}`, owner.cookie, 'DELETE', { version: persona.version });
  await request(`/api/personas/${persona.persona_id}`, owner.cookie, 'DELETE', { version: persona.version });
  check(!(await request<{personas: Persona[]}>('/api/personas', owner.cookie)).personas.some(p => p.persona_id === persona.persona_id), 'deleted role removed from catalog');
  await request(`/api/personas/${persona.persona_id}`, owner.cookie, 'PATCH', { name: 'cannot revive' }, 404);
  const rejectedUpload = new FormData(); rejectedUpload.append('files', new File([photo], 'late.jpg', { type: 'image/jpeg' }));
  await request(`/api/personas/${persona.persona_id}/refs`, owner.cookie, 'POST', rejectedUpload, 404);
  await request('/api/episodes', owner.cookie, 'POST', body, 404);
  check(JSON.stringify(getCreditBalance(owner.id)) === JSON.stringify(balanceBefore), 'deletion and rejected creation leave credits unchanged');
  const old = await request<{persona: Persona; episode: Episode}>(`/api/episodes/${episode.episode_id}`, owner.cookie);
  check(old.persona.version === frozenVersion && old.persona.name === initial.name, 'old episode returns frozen revision after deletion');
  check((await getPersonaVersion(persona.persona_id, frozenVersion))?.refs.includes(key), 'Worker can still load historical references');
  check(await Bun.file(join(process.env.KELVOY_PROJECTS_ROOT ?? 'projects', key)).exists(), 'reference file retained');
  await request(`/api/assets/${key}`, owner.cookie);
  await request(`/api/assets/${key}`, other.cookie, 'GET', undefined, 404);
  console.log('PASS owner-edit-delete/replay/conflict; cross-account+official denied; deleted catalog/new-episode blocked; frozen old episode+private photos retained; no GPU tasks run');
} finally {
  database.transaction(() => {
    for (const owner of owners) {
      const episodes = database.query<{episode_id: string}, [string]>('select episode_id from episodes where owner_id = ?').all(owner);
      for (const episode of episodes) {
        database.query('delete from tasks where episode_id = ?').run(episode.episode_id);
        database.query('delete from episodes where episode_id = ?').run(episode.episode_id);
      }
      const personas = database.query<{persona_id: string}, [string]>('select persona_id from personas where owner_id = ?').all(owner);
      for (const persona of personas) {
        if (!personaIds.includes(persona.persona_id)) personaIds.push(persona.persona_id);
        database.query('delete from persona_versions where persona_id = ?').run(persona.persona_id);
        database.query('delete from personas where persona_id = ?').run(persona.persona_id);
      }
      for (const table of ['credit_ledger', 'credit_actions', 'credit_accounts', 'sessions', 'users']) database.query(`delete from ${table} where user_id = ?`).run(owner);
    }
  }).immediate();
  for (const id of personaIds) await rm(join(process.env.KELVOY_PROJECTS_ROOT ?? 'projects', 'persona', id), { recursive: true, force: true });
  check(database.query<{quick_check: string}, []>('pragma quick_check').get()?.quick_check === 'ok', 'database integrity after cleanup');
  close();
}
