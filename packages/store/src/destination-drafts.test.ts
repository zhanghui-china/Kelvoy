import { beforeEach, afterEach, test, expect } from 'bun:test';
import { open, close } from './db';
import * as drafts from './destination-drafts';
import { getDestinationVersion, listDestinations } from './destinations';
const content = { name: '灵山', city: '无锡', type: 'scenic_area' as const, season_best: [], route: [], food: [], transport: '', stay: '', landmarks: [{ id: 'l1', name: '佛', best_time: '上午', must_keep: ['轮廓'], refs: [] as string[] }] };
beforeEach(() => open(':memory:'));
afterEach(close);
test('drafts stay private and enforce edit versions', async () => {
    const d = await drafts.createDestinationDraft('u1', content);
    expect(await drafts.getDestinationDraft(d.draft_id, 'u2')).toBeNull();
    expect(await listDestinations()).toEqual([]);
    await expect(drafts.updateDestinationDraft(d.draft_id, 'u1', 99, content)).rejects.toThrow('conflict');
    const next = await drafts.updateDestinationDraft(d.draft_id, 'u1', 1, { ...content, name: '新' });
    expect(next.edit_version).toBe(2);
});
test('publication validates photos, is idempotent and freezes history', async () => {
    let d = await drafts.createDestinationDraft('u1', content);
    await expect(drafts.publishDestinationDraft(d.draft_id, 'u1', 1)).rejects.toThrow('invalid');
    d = await drafts.addDestinationDraftPhotos(d.draft_id, 'u1', 1, 'l1', ['dest/a.jpg', 'dest/b.jpg', 'dest/c.jpg']);
    const first = await drafts.publishDestinationDraft(d.draft_id, 'u1', d.edit_version);
    expect((await drafts.publishDestinationDraft(d.draft_id, 'u1', d.edit_version)).destination.version).toBe(1);
    let edit = await drafts.editDestinationDraft(first.destination.destination_id, 'u1');
    edit = await drafts.updateDestinationDraft(edit.draft_id, 'u1', edit.edit_version, { ...edit.content, name: '新' });
    const second = await drafts.publishDestinationDraft(edit.draft_id, 'u1', edit.edit_version);
    expect(second.destination.version).toBe(2);
    expect((await getDestinationVersion(second.destination.destination_id, 1))?.name).toBe('灵山');
    await expect(drafts.editDestinationDraft(second.destination.destination_id, 'u2')).rejects.toThrow('not_found');
});
test('photo cap and optimistic uploads cannot race', async () => {
    let d = await drafts.createDestinationDraft('u1', content);
    d = await drafts.addDestinationDraftPhotos(d.draft_id, 'u1', 1, 'l1', Array.from({ length: 10 }, (_, i) => `dest/${i}.jpg`));
    await expect(drafts.addDestinationDraftPhotos(d.draft_id, 'u1', d.edit_version, 'l1', ['dest/extra.jpg'])).rejects.toThrow('invalid');
    await expect(drafts.addDestinationDraftPhotos(d.draft_id, 'u1', 1, 'l1', ['dest/stale.jpg'])).rejects.toThrow('conflict');
});
test('draft migration is repeatable and preserves creator documents', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'draft-migrate-'));
    const path = join(dir, 'database.db');
    try {
        open(path);
        const d = await drafts.createDestinationDraft('u1', content);
        close();
        open(path);
        expect((await drafts.getDestinationDraft(d.draft_id, 'u1'))?.content).toEqual(content);
        close();
        open(path);
        expect((await drafts.listDestinationDrafts('u1')).length).toBe(1);
    }
    finally {
        close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test('publication refuses missing required fields and stale catalog base', async () => {
    let d = await drafts.createDestinationDraft('u1', content);
    d = await drafts.addDestinationDraftPhotos(d.draft_id, 'u1', 1, 'l1', ['dest/a.jpg', 'dest/b.jpg', 'dest/c.jpg']);
    d = await drafts.updateDestinationDraft(d.draft_id, 'u1', 2, { ...d.content, landmarks: [{ ...d.content.landmarks[0]!, must_keep: [] }] });
    await expect(drafts.publishDestinationDraft(d.draft_id, 'u1', 3)).rejects.toThrow('invalid');
    d = await drafts.updateDestinationDraft(d.draft_id, 'u1', 3, { ...d.content, landmarks: [{ ...d.content.landmarks[0]!, must_keep: ['外形'] }] });
    const first = await drafts.publishDestinationDraft(d.draft_id, 'u1', 4);
    const edit = await drafts.editDestinationDraft(first.destination.destination_id, 'u1');
    const { upsertDestination } = await import('./destinations');
    await upsertDestination({ ...first.destination, version: 2, name: '内部变更' });
    await expect(drafts.publishDestinationDraft(edit.draft_id, 'u1', edit.edit_version)).rejects.toThrow('conflict');
});
test('duplicate references cannot satisfy publication photo minimum', async () => {
    let d = await drafts.createDestinationDraft('u1', content);
    d = await drafts.addDestinationDraftPhotos(d.draft_id, 'u1', 1, 'l1', ['dest/a.jpg']);
    await expect(drafts.updateDestinationDraft(d.draft_id, 'u1', 2, { ...d.content, landmarks: [{ ...d.content.landmarks[0]!, refs: ['dest/a.jpg', 'dest/a.jpg', 'dest/a.jpg'] }] })).rejects.toThrow('invalid');
});
