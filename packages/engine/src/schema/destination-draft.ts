import type { Destination } from './destination';
export type DestinationDraftContent = Omit<Destination, 'destination_id' | 'version' | 'creator_id'>;
export interface DestinationDraft {
    draft_id: string;
    creator_id: string;
    edit_version: number;
    destination_id: string | null;
    base_version: number | null;
    content: DestinationDraftContent;
    published_version: number | null;
}
const types = new Set(['mountain_summit', 'city_night', 'theme_town', 'scenic_area', 'water_town', 'island']);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 4000;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(text);
/** Validate untrusted protocol content without accepting identity or revision fields. */
export function validateDestinationDraftContent(value: unknown, publish = false): value is DestinationDraftContent {
    if (!value || typeof value !== 'object')
        return false;
    const v = value as Record<string, unknown>;
    if (!text(v.name) || !text(v.city) || !types.has(v.type as string) || !strings(v.season_best) ||
        !strings(v.route) || !strings(v.food) || !text(v.transport) || !text(v.stay) ||
        (v.description !== undefined && !text(v.description)) ||
        (v.province !== undefined && !text(v.province)) ||
        (v.country_code !== undefined && (typeof v.country_code !== 'string' || !/^[A-Z]{2}$/.test(v.country_code))) ||
        !Array.isArray(v.landmarks) || v.landmarks.length > 50)
        return false;
    const ids = new Set<string>();
    for (const landmark of v.landmarks) {
        if (!landmark || typeof landmark !== 'object')
            return false;
        const l = landmark as Record<string, unknown>;
        if (typeof l.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(l.id) || ids.has(l.id) ||
            !text(l.name) || !text(l.best_time) || !strings(l.refs) || l.refs.length > 10 || new Set(l.refs).size !== l.refs.length ||
            !l.refs.every(key => /^dest\/[a-zA-Z0-9_./-]+$/.test(key) && !key.split('/').includes('..')) ||
            (l.must_keep !== undefined && !strings(l.must_keep)))
            return false;
        ids.add(l.id);
        if (publish && (!l.name.trim() || !l.best_time.trim() || l.refs.length < 3 ||
            !Array.isArray(l.must_keep) || !l.must_keep.some(item => typeof item === 'string' && item.trim())))
            return false;
    }
    return !publish || (!!v.name.trim() && !!v.city.trim() && v.landmarks.length > 0);
}
