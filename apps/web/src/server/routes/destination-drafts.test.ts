import sharp from 'sharp';
import { beforeEach, afterEach, test, expect } from 'bun:test';
import { open, close, createSession } from '@kelvoy/store';
import { Hono } from 'hono';
import drafts from './destination-drafts';
import assets from './assets';
import destinations from './destinations';
import episodes from './episodes';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let root: string;
let cookie: string;
const content = { name: '景区', city: '城市', type: 'scenic_area', season_best: [], route: [], food: [], transport: '', stay: '', landmarks: [{ id: 'l1', name: '地标', best_time: '上午', must_keep: ['外形'], refs: [] }] };
const app = new Hono().route('/api/destination-drafts', drafts).route('/api/assets', assets).route('/api/destinations', destinations).route('/api/episodes', episodes);
beforeEach(async () => { open(':memory:'); root = await mkdtemp(join(tmpdir(), 'draft-route-')); process.env.KELVOY_PROJECTS_ROOT = root; const session = await createSession('u1'); cookie = `kelvoy_session=${session.session_id}`; });
afterEach(async () => { close(); delete process.env.KELVOY_PROJECTS_ROOT; await rm(root, { recursive: true, force: true }); });
async function create() { const r = await app.request('/api/destination-drafts', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ content }) }); expect(r.status).toBe(201); return (await r.json()).draft; }
test('private CRUD enforces authentication and optimistic locking', async () => {
    expect((await app.request('/api/destination-drafts')).status).toBe(401);
    const d = await create();
    const other = await createSession('u2');
    expect((await app.request(`/api/destination-drafts/${d.draft_id}`, { headers: { cookie: `kelvoy_session=${other.session_id}` } })).status).toBe(404);
    expect((await app.request(`/api/destination-drafts/${d.draft_id}`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ edit_version: 99, content }) })).status).toBe(409);
});
const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fafafa' } }).png().toBuffer();
test('uploads stay private until atomic publication and history remains public', async () => {
    const d = await create();
    const form = new FormData();
    form.set('edit_version', '1');
    for (let i = 0; i < 3; i++)
        form.append('files', new File([png], '../../evil.png', { type: 'image/png' }));
    const upload = await app.request(`/api/destination-drafts/${d.draft_id}/landmarks/l1/photos`, { method: 'POST', headers: { cookie }, body: form });
    expect(upload.status).toBe(200);
    const updated = (await upload.json()).draft;
    const key = updated.content.landmarks[0].refs[0];
    expect(key).not.toContain('evil');
    expect((await app.request(`/api/assets/${key}`, { headers: { cookie } })).status).toBe(404);
    expect((await app.request(`/api/destination-drafts/${d.draft_id}/assets/${key}`, { headers: { cookie } })).status).toBe(200);
    const publish = await app.request(`/api/destination-drafts/${d.draft_id}/publish`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ edit_version: 2 }) });
    expect(publish.status).toBe(200);
    const result = await publish.json();
    expect((await app.request(`/api/destinations/${result.destination.destination_id}/assets/${key}`)).status).toBe(200);
    expect((await app.request(`/api/assets/${key}`, { headers: { cookie } })).status).toBe(200);
});
test('bad image and stale upload leave no files', async () => {
    const d = await create();
    const form = new FormData();
    form.set('edit_version', '1');
    form.append('files', new File(['bad'], 'fake.png', { type: 'image/png' }));
    expect((await app.request(`/api/destination-drafts/${d.draft_id}/landmarks/l1/photos`, { method: 'POST', headers: { cookie }, body: form })).status).toBe(400);
    expect(await readdir(root)).toEqual([]);
    const valid = new FormData();
    valid.set('edit_version', '99');
    valid.append('files', new File([png], 'real.png', { type: 'image/png' }));
    expect((await app.request(`/api/destination-drafts/${d.draft_id}/landmarks/l1/photos`, { method: 'POST', headers: { cookie }, body: valid })).status).toBe(409);
});
test('concurrent uploads conflict and clean losing request files', async () => {
    const d = await create();
    const send = () => { const form = new FormData(); form.set('edit_version', '1'); form.append('files', new File([png], 'a.png', { type: 'image/png' })); return app.request(`/api/destination-drafts/${d.draft_id}/landmarks/l1/photos`, { method: 'POST', headers: { cookie }, body: form }); };
    const results = await Promise.all([send(), send()]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await readdir(join(root, 'dest', 'uploads', d.draft_id))).length).toBe(1);
});
test('rejects oversized image and request before saving files', async () => {
    const d = await create();
    const form = new FormData();
    form.set('edit_version', '1');
    form.append('files', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'a.png', { type: 'image/png' }));
    expect((await app.request(`/api/destination-drafts/${d.draft_id}/landmarks/l1/photos`, { method: 'POST', headers: { cookie }, body: form })).status).toBe(400);
    expect((await app.request('/api/destination-drafts', { method: 'POST', headers: { cookie, 'content-length': String(1024 * 1024 * 102) }, body: '{}' })).status).toBe(413);
});
test('invalid JSON shapes return validation errors', async () => {
    for (const body of ['null', '[]', '{"content":null}', '{"content":{"landmarks":[]}}']) {
        const result = await app.request('/api/destination-drafts', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body });
        expect(result.status).toBe(400);
    }
});
test('upload rejects symlink ancestors before creating directories', async () => {
    const { mkdir, symlink } = await import('node:fs/promises');
    const external = join(root, 'external');
    await mkdir(external);
    await mkdir(join(root, 'dest'));
    await symlink(external, join(root, 'dest', 'uploads'));
    const d = await create();
    const form = new FormData();
    form.set('edit_version', '1');
    form.append('files', new File([png], 'a.png', { type: 'image/png' }));
    expect((await app.request(`/api/destination-drafts/${d.draft_id}/landmarks/l1/photos`, { method: 'POST', headers: { cookie }, body: form })).status).toBe(400);
    expect(await readdir(external)).toEqual([]);
});
test('second account cannot mutate drafts and keeps old episode photos after v2 removal', async () => {
    const { insertEpisode, editDestinationDraft, getDestinationDraft } = await import('@kelvoy/store');
    const { fixture } = await import('./episode-test-fixtures');
    const d = await create(), form = new FormData();
    form.set('edit_version', '1');
    for (let i = 0; i < 4; i++)
        form.append('files', new File([png], 'photo.png', { type: 'image/png' }));
    const upload = await app.request(`/api/destination-drafts/${d.draft_id}/landmarks/l1/photos`, { method: 'POST', headers: { cookie }, body: form });
    expect(upload.status).toBe(200);
    const uploaded = (await upload.json()).draft, key = uploaded.content.landmarks[0].refs[0];
    const other = await createSession('u2'), otherCookie = `kelvoy_session=${other.session_id}`;
    const headers = { cookie: otherCookie, 'content-type': 'application/json' };
    for (const [method, path, body] of [
        ['PUT', `/api/destination-drafts/${d.draft_id}`, { edit_version: 2, content }],
        ['DELETE', `/api/destination-drafts/${d.draft_id}`, { edit_version: 2 }],
        ['POST', `/api/destination-drafts/${d.draft_id}/publish`, { edit_version: 2 }],
        ['DELETE', `/api/destination-drafts/${d.draft_id}/landmarks/l1/photos`, { edit_version: 2, key }],
    ] as const)
        expect((await app.request(path, { method, headers, body: JSON.stringify(body) })).status).toBe(404);
    expect((await app.request(`/api/destination-drafts/${d.draft_id}/assets/${key}`, { headers: { cookie: otherCookie } })).status).toBe(404);
    const publish = await app.request(`/api/destination-drafts/${d.draft_id}/publish`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ edit_version: 2 }) });
    const destination = (await publish.json()).destination;
    expect((await app.request(`/api/destinations/${destination.destination_id}/edit`, { method: 'POST', headers })).status).toBe(404);
    const episode = { ...fixture('e_history', 'u2'), destination_id: destination.destination_id, destination_version: 1 };
    await insertEpisode(episode);
    const edit = await editDestinationDraft(destination.destination_id, 'u1');
    const remove = await app.request(`/api/destination-drafts/${edit.draft_id}/landmarks/l1/photos`, { method: 'DELETE', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ edit_version: 1, key }) });
    expect(remove.status).toBe(200);
    const republish = await app.request(`/api/destination-drafts/${edit.draft_id}/publish`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ edit_version: 2 }) });
    expect(republish.status).toBe(200);
    expect((await republish.json()).destination.landmarks[0].refs).not.toContain(key);
    const old = await app.request('/api/episodes/e_history', { headers: { cookie: otherCookie } });
    expect(old.status).toBe(200);
    expect((await old.json()).destination.landmarks[0].refs).toContain(key);
    expect((await app.request(`/api/assets/${key}`, { headers: { cookie: otherCookie } })).status).toBe(200);
    expect((await app.request(`/api/destinations/${destination.destination_id}/assets/${key}`)).status).toBe(200);
    expect((await getDestinationDraft(edit.draft_id, 'u1'))?.published_version).toBe(2);
});
test('database failure cleans all newly written upload files', async () => {
    const { getDb, getDestinationDraft } = await import('@kelvoy/store');
    const d = await create();
    getDb().exec("create trigger reject_draft_update before update on destination_drafts begin select raise(abort,'injected database failure'); end");
    const form = new FormData();
    form.set('edit_version', '1');
    for (let i = 0; i < 2; i++)
        form.append('files', new File([png], 'photo.png', { type: 'image/png' }));
    expect((await app.request(`/api/destination-drafts/${d.draft_id}/landmarks/l1/photos`, { method: 'POST', headers: { cookie }, body: form })).status).toBe(500);
    expect(await readdir(join(root, 'dest', 'uploads', d.draft_id))).toEqual([]);
    expect((await getDestinationDraft(d.draft_id, 'u1'))?.content.landmarks[0]?.refs).toEqual([]);
});
test('filesystem failure cleans earlier upload files without saving draft', async () => {
    const { spyOn } = await import('bun:test');
    const { getDestinationDraft } = await import('@kelvoy/store');
    const d = await create();
    const original = Bun.write;
    let calls = 0;
    const mock = spyOn(Bun, 'write').mockImplementation(((...args: Parameters<typeof Bun.write>) => { calls++; if (calls === 2)
        return Promise.reject(new Error('injected write failure')); return original(...args); }) as typeof Bun.write);
    const form = new FormData();
    form.set('edit_version', '1');
    for (let i = 0; i < 2; i++)
        form.append('files', new File([png], 'photo.png', { type: 'image/png' }));
    try {
        expect((await app.request(`/api/destination-drafts/${d.draft_id}/landmarks/l1/photos`, { method: 'POST', headers: { cookie }, body: form })).status).toBe(500);
    }
    finally {
        mock.mockRestore();
    }
    expect(await readdir(join(root, 'dest', 'uploads', d.draft_id))).toEqual([]);
    expect((await getDestinationDraft(d.draft_id, 'u1'))?.edit_version).toBe(1);
});
