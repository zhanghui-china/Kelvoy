import { type DestinationDraftContent, validateDestinationDraftContent } from '@kelvoy/engine';
import { addDestinationDraftPhotos, createDestinationDraft, deleteDestinationDraft, DestinationDraftError, getDestinationDraft, listDestinationDrafts, publishDestinationDraft, removeDestinationDraftPhoto, updateDestinationDraft } from '@kelvoy/store';
import { mkdir, unlink, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireOwner } from '../middleware/auth';
import { resolveAssetPath } from './assets';
import { destinationPhotoExtension } from './destination-photo';
import { staysOnDiskPath } from './file-path';
const drafts = new Hono();
const LIMIT = 10 * 1024 * 1024;
const empty: DestinationDraftContent = { name: '', city: '', type: 'scenic_area', season_best: [], landmarks: [], route: [], food: [], transport: '', stay: '' };
drafts.use('*', requireOwner);
drafts.use('*', bodyLimit({ maxSize: 10 * LIMIT + 1024 * 1024, onError: c => c.json({ ok: false, error: 'request_too_large' }, 413) }));
drafts.onError((error, c) => {
    if (error instanceof DestinationDraftError)
        return c.json({ ok: false, error: error.code }, error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400);
    if (error instanceof SyntaxError)
        return c.json({ ok: false, error: 'invalid' }, 400);
    console.error('Destination draft request failed', error);
    return c.json({ ok: false, error: 'internal_error' }, 500);
});
async function jsonBody(c: Context): Promise<Record<string, unknown>> {
    const body: unknown = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new DestinationDraftError('invalid');
    return body as Record<string, unknown>;
}
function validatedContent(value: unknown): DestinationDraftContent {
    if (!validateDestinationDraftContent(value))
        throw new DestinationDraftError('invalid');
    return value;
}
const version = (value: unknown): number => {
    if (!Number.isSafeInteger(value) || Number(value) < 1)
        throw new DestinationDraftError('invalid');
    return Number(value);
};
drafts.get('/', async (c) => c.json({ ok: true, drafts: await listDestinationDrafts(c.get('ownerId')) }));
drafts.post('/', async (c) => {
    const body = await jsonBody(c);
    const content = body.content === undefined ? empty : body.content;
    if (!validateDestinationDraftContent(content))
        throw new DestinationDraftError('invalid');
    return c.json({ ok: true, draft: await createDestinationDraft(c.get('ownerId'), content) }, 201);
});
drafts.get('/:id', async (c) => {
    const draft = await getDestinationDraft(c.req.param('id'), c.get('ownerId'));
    return draft ? c.json({ ok: true, draft }) : c.json({ ok: false, error: 'not_found' }, 404);
});
drafts.put('/:id', async (c) => {
    const body = await jsonBody(c);
    return c.json({ ok: true, draft: await updateDestinationDraft(c.req.param('id'), c.get('ownerId'), version(body.edit_version), validatedContent(body.content)) });
});
drafts.delete('/:id', async (c) => { const body = await jsonBody(c); await deleteDestinationDraft(c.req.param('id'), c.get('ownerId'), version(body.edit_version)); return c.json({ ok: true }); });
drafts.post('/:id/publish', async (c) => { const body = await jsonBody(c); return c.json({ ok: true, ...await publishDestinationDraft(c.req.param('id'), c.get('ownerId'), version(body.edit_version)) }); });
drafts.get('/:id/assets/:path{.+}', async (c) => {
    const key = c.req.param('path'), path = key.startsWith('dest/') ? resolveAssetPath(key) : null;
    if (!path)
        return c.json({ ok: false, error: 'invalid_path' }, 400);
    const draft = await getDestinationDraft(c.req.param('id'), c.get('ownerId'));
    if (!draft?.content.landmarks.some(l => l.refs.includes(key)))
        return c.json({ ok: false, error: 'not_found' }, 404);
    const file = Bun.file(path);
    if (!await file.exists())
        return c.json({ ok: false, error: 'not_found' }, 404);
    return new Response(file, { headers: { 'Cache-Control': 'private, no-store' } });
});
drafts.post('/:id/landmarks/:landmarkId/photos', async (c) => {
    const id = c.req.param('id'), owner = c.get('ownerId'), landmarkId = c.req.param('landmarkId');
    const draft = await getDestinationDraft(id, owner);
    if (!draft)
        throw new DestinationDraftError('not_found');
    const form = await c.req.formData(), editVersion = version(Number(form.get('edit_version')));
    if (editVersion !== draft.edit_version || draft.published_version !== null)
        throw new DestinationDraftError('conflict');
    const landmark = draft.content.landmarks.find(l => l.id === landmarkId);
    const files = form.getAll('files');
    if (!landmark || !files.length || files.length + landmark.refs.length > 10)
        throw new DestinationDraftError('invalid');
    const prepared: {
        bytes: Uint8Array;
        extension: string;
    }[] = [];
    for (const file of files) {
        if (!(file instanceof File) || file.size === 0 || file.size > LIMIT)
            throw new DestinationDraftError('invalid');
        const bytes = new Uint8Array(await file.arrayBuffer()), extension = await destinationPhotoExtension(bytes);
        const mime = extension === 'jpg' ? 'image/jpeg' : extension ? `image/${extension}` : null;
        if (!extension || file.type !== mime)
            throw new DestinationDraftError('invalid');
        prepared.push({ bytes, extension });
    }
    const root = resolve(process.env.KELVOY_PROJECTS_ROOT ?? 'projects'), directory = join(root, 'dest', 'uploads', id);
    // Check before mkdir too: a pre-existing symlink must not redirect writes.
    for (const path of [join(root, "dest"), join(root, "dest", "uploads"), directory]) {
        try {
            const stat = await lstat(path);
            if (stat.isSymbolicLink() || !stat.isDirectory())
                throw new DestinationDraftError("invalid");
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
        }
    }
    if (!staysOnDiskPath(root, directory))
        throw new DestinationDraftError('invalid');
    await mkdir(directory, { recursive: true });
    if (!staysOnDiskPath(root, directory))
        throw new DestinationDraftError('invalid');
    const written: string[] = [], keys: string[] = [];
    try {
        for (const photo of prepared) {
            const key = `dest/uploads/${id}/${crypto.randomUUID()}.${photo.extension}`, path = join(root, key);
            written.push(path);
            await Bun.write(path, photo.bytes);
            keys.push(key);
        }
        const updated = await addDestinationDraftPhotos(id, owner, editVersion, landmarkId, keys);
        return c.json({ ok: true, draft: updated });
    }
    catch (error) {
        await Promise.all(written.map(path => unlink(path).catch(cleanup => {
            if ((cleanup as NodeJS.ErrnoException).code !== 'ENOENT')
                console.error('Destination upload cleanup failed', cleanup);
        })));
        throw error;
    }
});
drafts.delete('/:id/landmarks/:landmarkId/photos', async (c) => {
    const body = await jsonBody(c);
    if (typeof body.key !== 'string')
        throw new DestinationDraftError('invalid');
    return c.json({ ok: true, draft: await removeDestinationDraftPhoto(c.req.param('id'), c.get('ownerId'), version(body.edit_version), c.req.param('landmarkId'), body.key) });
});
export default drafts;
