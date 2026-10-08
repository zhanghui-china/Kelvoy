// Operational acceptance: run with Worker paused, uses two temporary users and cleans its records.
import { open, close, createUser, createSession, grantCredits, getCreditBalance, listPersonas, listTemplates } from '../../packages/store/src/index';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
if (process.env.KELVOY_VERIFY_WORKER_PAUSED !== "1") throw new Error("Run with Worker paused and KELVOY_VERIFY_WORKER_PAUSED=1");
const database = open();
const base = process.env.KELVOY_VERIFY_BASE_URL ?? 'http://127.0.0.1:8888';
const users: string[] = [], draftIds: string[] = [];
let destinationId: string | undefined, episodeId: string | undefined;
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function account(label: string) {
  const created = await createUser({ username: `destination_acceptance_${label}_${crypto.randomUUID()}`, password_hash: 'acceptance-account-login-disabled' });
  check(created.ok, 'create isolated acceptance account');
  users.push(created.user.user_id);
  const session = await createSession(created.user.user_id);
  return { id: created.user.user_id, cookie: `kelvoy_session=${session.session_id}` };
}
async function request(path: string, cookie: string | undefined, method = 'GET', body?: unknown, status = 200) {
  const response = await fetch(base + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  check(response.status === status, `${method} ${path}: expected ${status}, got ${response.status}`);
  if (response.headers.get('content-type')?.includes('application/json')) return await response.json() as any;
  return await response.arrayBuffer();
}
try {
  const owner = await account('owner'), other = await account('reader');
  const content = { name: '共享目的地临时验收', city: '验收城市', type: 'scenic_area', season_best: [], route: [], food: [], transport: '', stay: '', landmarks: [{ id: 'landmark', name: '验收地标', refs: [], best_time: '上午机位', must_keep: ['外形'] }] };
  let draft = (await request('/api/destination-drafts', owner.cookie, 'POST', { content }, 201)).draft;
  draftIds.push(draft.draft_id);
  const photo = await Bun.file(new URL('../../assets/demo/dest/lingshan/01.jpg', import.meta.url)).arrayBuffer();
  const form = new FormData(); form.set('edit_version', String(draft.edit_version));
  for (let i = 0; i < 4; i++) form.append('files', new File([photo], `${i}.jpg`, { type: 'image/jpeg' }));
  draft = (await request(`/api/destination-drafts/${draft.draft_id}/landmarks/landmark/photos`, owner.cookie, 'POST', form)).draft;
  const key = draft.content.landmarks[0].refs[0];
  await request(`/api/destination-drafts/${draft.draft_id}`, other.cookie, 'GET', undefined, 404);
  await request(`/api/destination-drafts/${draft.draft_id}/assets/${key}`, other.cookie, 'GET', undefined, 404);
  await request(`/api/assets/${key}`, other.cookie, 'GET', undefined, 404);
  await request(`/api/destinations/unknown/assets/${key}`, undefined, 'GET', undefined, 404);
  await request(`/api/destination-drafts/${draft.draft_id}/assets/${key}`, owner.cookie);
  const published = await request(`/api/destination-drafts/${draft.draft_id}/publish`, owner.cookie, 'POST', { edit_version: draft.edit_version });
  destinationId = published.destination.destination_id;
  const replay = await request(`/api/destination-drafts/${draft.draft_id}/publish`, owner.cookie, 'POST', { edit_version: draft.edit_version });
  check(replay.destination.destination_id === destinationId && replay.destination.version === 1, 'idempotent publish');
  check((await request('/api/destinations', other.cookie)).destinations.some((d: any) => d.destination_id === destinationId), 'cross-account catalog');
  await request(`/api/assets/${key}`, other.cookie);
  await request(`/api/destinations/${destinationId}/assets/${key}`, undefined);
  await request(`/api/destinations/${destinationId}/edit`, other.cookie, 'POST', undefined, 404);
  check(getCreditBalance(owner.id).available === 0 && getCreditBalance(owner.id).reserved === 0, 'draft actions do not consume credits');
  const persona = (await listPersonas(other.id)).find(p => p.owner_id === null);
  const template = (await listTemplates(other.id)).find(t => t.owner_id === null);
  check(persona && template, 'official catalog fixtures exist');
  grantCredits(other.id, 1, `acceptance_${other.id}`);
  const created = await request('/api/episodes', other.cookie, 'POST', { destination_id: destinationId, persona_id: persona.persona_id, template_id: template.template_id }, 201);
  episodeId = created.episode.episode_id;
  check(created.episode.destination_version === 1, 'episode freezes version');
  let edit = (await request(`/api/destinations/${destinationId}/edit`, owner.cookie, 'POST')).draft;
  draftIds.push(edit.draft_id);
  edit = (await request(`/api/destination-drafts/${edit.draft_id}/landmarks/landmark/photos`, owner.cookie, 'DELETE', { edit_version: edit.edit_version, key })).draft;
  edit = (await request(`/api/destination-drafts/${edit.draft_id}`, owner.cookie, 'PUT', { edit_version: edit.edit_version, content: { ...edit.content, name: '验收新版本' } })).draft;
  const newer = await request(`/api/destination-drafts/${edit.draft_id}/publish`, owner.cookie, 'POST', { edit_version: edit.edit_version });
  check(newer.destination.version === 2, 'new revision');
  const old = await request(`/api/episodes/${episodeId}`, other.cookie);
  check(old.destination.version === 1 && old.destination.name === content.name && old.destination.landmarks[0].refs[0] === key, 'old episode reads frozen destination and photos');
  await request(`/api/assets/${key}`, other.cookie);
  console.log('PASS two-account create-upload-publish-select-create-episode-edit-history; no GPU tasks run');
} finally {
  database.transaction(() => {

    for (const id of users) {
      // Query by the temporary owners so cleanup also handles a lost successful HTTP response.
      const ownedEpisodes = database.query<{episode_id: string}, [string]>('select episode_id from episodes where owner_id = ?').all(id);
      for (const episode of ownedEpisodes) {
        database.query('delete from tasks where episode_id = ?').run(episode.episode_id);
        database.query('delete from episodes where episode_id = ?').run(episode.episode_id);
      }
      const ownedDestinations = database.query<{destination_id: string}, [string]>("select destination_id from destinations where json_extract(doc, '$.creator_id') = ?").all(id);
      for (const destination of ownedDestinations) {
        database.query('delete from destination_versions where destination_id = ?').run(destination.destination_id);
        database.query('delete from destinations where destination_id = ?').run(destination.destination_id);
      }
      const ownedDrafts = database.query<{draft_id: string}, [string]>('select draft_id from destination_drafts where creator_id = ?').all(id);
      for (const draft of ownedDrafts) if (!draftIds.includes(draft.draft_id)) draftIds.push(draft.draft_id);
      database.query('delete from destination_drafts where creator_id = ?').run(id);
      for (const table of ['credit_ledger', 'credit_actions', 'credit_accounts', 'sessions', 'users']) database.query(`delete from ${table} where user_id = ?`).run(id);
    }
  }).immediate();
  for (const id of draftIds) await rm(join(process.env.KELVOY_PROJECTS_ROOT ?? 'projects', 'dest', 'uploads', id), { recursive: true, force: true });
  const integrity = database.query<{ quick_check: string }, []>('pragma quick_check').get();
  check(integrity?.quick_check === 'ok', 'database integrity after cleanup');
  close();
}
