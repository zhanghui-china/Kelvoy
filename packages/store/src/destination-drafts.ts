import { validateDestinationDraftContent, type Destination, type DestinationDraft, type DestinationDraftContent } from '@kelvoy/engine';
import { getDb } from './db';
interface Row extends Omit<DestinationDraft, 'content'> {
    content: string;
}
const decode = (row: Row): DestinationDraft => ({ ...row, content: JSON.parse(row.content) as DestinationDraftContent });
export class DestinationDraftError extends Error {
    constructor(public code: 'not_found' | 'conflict' | 'invalid') { super(code); }
}
function read(id: string, owner: string): DestinationDraft {
    const row = getDb().query<Row, [
        string,
        string
    ]>('select * from destination_drafts where draft_id=? and creator_id=?').get(id, owner);
    if (!row)
        throw new DestinationDraftError('not_found');
    return decode(row);
}
function checked(id: string, owner: string, version: number): DestinationDraft {
    const d = read(id, owner);
    if (d.edit_version !== version)
        throw new DestinationDraftError('conflict');
    if (d.published_version !== null)
        throw new DestinationDraftError('conflict');
    return d;
}
function save(d: DestinationDraft): DestinationDraft {
    getDb().query('update destination_drafts set edit_version=?,content=? where draft_id=?')
        .run(d.edit_version, JSON.stringify(d.content), d.draft_id);
    return d;
}
function insert(owner: string, content: DestinationDraftContent, destinationId: string | null = null, base: number | null = null): DestinationDraft {
    if (!validateDestinationDraftContent(content))
        throw new DestinationDraftError('invalid');
    const d: DestinationDraft = { draft_id: crypto.randomUUID(), creator_id: owner, edit_version: 1, destination_id: destinationId, base_version: base, content, published_version: null };
    getDb().query('insert into destination_drafts values (?,?,?,?,?,?,?)').run(d.draft_id, owner, 1, destinationId, base, JSON.stringify(content), null);
    return d;
}
export async function createDestinationDraft(owner: string, content: DestinationDraftContent): Promise<DestinationDraft> {
    if (!validateDestinationDraftContent(content) || content.landmarks.some(l => l.refs.length))
        throw new DestinationDraftError('invalid');
    return insert(owner, content);
}
export async function getDestinationDraft(id: string, owner: string): Promise<DestinationDraft | null> {
    const row = getDb().query<Row, [
        string,
        string
    ]>('select * from destination_drafts where draft_id=? and creator_id=?').get(id, owner);
    return row ? decode(row) : null;
}
export async function listDestinationDrafts(owner: string): Promise<DestinationDraft[]> {
    return getDb().query<Row, [
        string
    ]>('select * from destination_drafts where creator_id=? order by rowid desc').all(owner).map(decode);
}
export async function updateDestinationDraft(id: string, owner: string, version: number, content: DestinationDraftContent): Promise<DestinationDraft> {
    return getDb().transaction(() => {
        const d = checked(id, owner, version);
        if (!validateDestinationDraftContent(content))
            throw new DestinationDraftError('invalid');
        // References can be removed here (including a deleted landmark), never injected.
        if (content.landmarks.some(l => l.refs.some(ref => !d.content.landmarks.find(old => old.id === l.id)?.refs.includes(ref))))
            throw new DestinationDraftError('invalid');
        return save({ ...d, content, edit_version: version + 1 });
    }).immediate();
}
export async function deleteDestinationDraft(id: string, owner: string, version: number): Promise<void> {
    getDb().transaction(() => {
        const d = read(id, owner);
        if (d.edit_version !== version)
            throw new DestinationDraftError('conflict');
        getDb().query('delete from destination_drafts where draft_id=?').run(id);
    }).immediate();
}
export async function addDestinationDraftPhotos(id: string, owner: string, version: number, landmarkId: string, keys: string[]): Promise<DestinationDraft> {
    return getDb().transaction(() => {
        const d = checked(id, owner, version), landmark = d.content.landmarks.find(l => l.id === landmarkId);
        if (!landmark || !keys.length || landmark.refs.length + keys.length > 10)
            throw new DestinationDraftError('invalid');
        landmark.refs.push(...keys);
        if (!validateDestinationDraftContent(d.content))
            throw new DestinationDraftError('invalid');
        return save({ ...d, edit_version: version + 1 });
    }).immediate();
}
export async function removeDestinationDraftPhoto(id: string, owner: string, version: number, landmarkId: string, key: string): Promise<DestinationDraft> {
    return getDb().transaction(() => {
        const d = checked(id, owner, version), l = d.content.landmarks.find(l => l.id === landmarkId);
        if (!l || !l.refs.includes(key))
            throw new DestinationDraftError('not_found');
        l.refs = l.refs.filter(ref => ref !== key);
        return save({ ...d, edit_version: version + 1 });
    }).immediate();
}
export async function editDestinationDraft(id: string, owner: string): Promise<DestinationDraft> {
    return getDb().transaction(() => {
        const row = getDb().query<{
            doc: string;
        }, [
            string
        ]>('select doc from destinations where destination_id=?').get(id);
        const destination = row ? JSON.parse(row.doc) as Destination : null;
        if (!destination || destination.creator_id !== owner)
            throw new DestinationDraftError('not_found');
        const existing = getDb().query<Row, [
            string,
            string
        ]>('select * from destination_drafts where destination_id=? and creator_id=? and published_version is null order by rowid desc limit 1').get(id, owner);
        if (existing)
            return decode(existing);
        const { destination_id: _id, version, creator_id: _creator, ...content } = destination;
        return insert(owner, content, id, version);
    }).immediate();
}
export async function publishDestinationDraft(id: string, owner: string, version: number): Promise<{
    draft: DestinationDraft;
    destination: Destination;
}> {
    return getDb().transaction(() => {
        const d = read(id, owner);
        if (d.edit_version !== version)
            throw new DestinationDraftError('conflict');
        if (d.published_version !== null) {
            const row = getDb().query<{
                doc: string;
            }, [
                string,
                number
            ]>('select doc from destination_versions where destination_id=? and version=?').get(d.destination_id!, d.published_version);
            if (!row)
                throw new DestinationDraftError('conflict');
            return { draft: d, destination: JSON.parse(row.doc) as Destination };
        }
        if (!validateDestinationDraftContent(d.content, true))
            throw new DestinationDraftError('invalid');
        const destinationId = d.destination_id ?? crypto.randomUUID();
        const current = getDb().query<{
            doc: string;
            version: number;
        }, [
            string
        ]>('select doc,version from destinations where destination_id=?').get(destinationId);
        if (d.destination_id && (!current || current.version !== d.base_version || (JSON.parse(current.doc) as Destination).creator_id !== owner))
            throw new DestinationDraftError('conflict');
        const destination: Destination = { ...d.content, destination_id: destinationId, version: (current?.version ?? 0) + 1, creator_id: owner };
        const doc = JSON.stringify(destination);
        getDb().query(`insert into destinations (destination_id,version,doc) values (?,?,?) on conflict(destination_id) do update set version=excluded.version,doc=excluded.doc,updated_at=datetime('now')`).run(destinationId, destination.version, doc);
        getDb().query('insert into destination_versions (destination_id,version,doc) values (?,?,?)').run(destinationId, destination.version, doc);
        getDb().query('update destination_drafts set destination_id=?,published_version=? where draft_id=?').run(destinationId, destination.version, id);
        return { draft: { ...d, destination_id: destinationId, published_version: destination.version }, destination };
    }).immediate();
}
/** All immutable published revisions count, including photos frozen by old episodes. */
export async function isPublishedDestinationAsset(key: string, destinationId?: string): Promise<boolean> {
    const sql = `select 1 from destination_versions v,json_each(v.doc,'$.landmarks') l,json_each(l.value,'$.refs') r where r.value=?${destinationId ? ' and v.destination_id=?' : ''} limit 1`;
    return !!getDb().query(sql).get(...(destinationId ? [key, destinationId] : [key]));
}
