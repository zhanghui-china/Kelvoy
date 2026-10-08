import { editStoryboard, storyboardEditable, validateStoryboardFields, type Destination, type StoryboardEdit } from "@kelvoy/engine";
import { getDb } from "./db";
import { decodeEpisode } from "./episode-codec";
export function storyboardBusy(episodeId: string): boolean {
  return !!getDb().query("select 1 from tasks where episode_id = ? and status in ('held','pending','processing') limit 1").get(episodeId);
}
export async function updateStoryboard(input: { episode_id: string; owner_id: string; row_version: number; edit: StoryboardEdit }) {
  const db = getDb();
  return db.transaction(() => {
    const row = db.query<{doc: string; row_version: number}, [string,string]>("select doc,row_version from episodes where episode_id = ? and owner_id = ?").get(input.episode_id, input.owner_id);
    if (!row) return { ok: false, error: "not_found" } as const;
    if (row.row_version !== input.row_version) return { ok: false, error: "version_conflict", current_row_version: row.row_version } as const;
    const episode = decodeEpisode(row.doc);
    if (!storyboardEditable(episode) || storyboardBusy(input.episode_id)) return { ok: false, error: "storyboard_busy" } as const;
    if (input.edit.type === "patch" || input.edit.type === "insert") {
      const destinationRow = db.query<{doc:string},[string,number]>("select doc from destination_versions where destination_id = ? and version = ?").get(episode.destination_id,episode.destination_version);
      const destination = destinationRow ? JSON.parse(destinationRow.doc) as Destination : null;
      const errors = validateStoryboardFields(episode,input.edit.type === "insert" ? input.edit.shot : input.edit.patch,destination,input.edit.type === "insert");
      if (errors.length) return { ok:false,error:errors[0] } as const;
    }
    const edit = input.edit.type === "insert" ? { ...input.edit, shot: Object.fromEntries(Object.entries(input.edit.shot).map(([key,value]) => [key,typeof value === "string" ? value.trim() : value])) as typeof input.edit.shot }
      : input.edit.type === "patch" ? { ...input.edit, patch: Object.fromEntries(Object.entries(input.edit.patch).map(([key,value]) => [key,typeof value === "string" ? value.trim() : value])) } : input.edit;
    let updated;
    try { updated = editStoryboard(episode, edit); }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "invalid_edit" } as const; }
    if (updated === episode) return { ok: true, row_version: row.row_version } as const;
    db.query("update episodes set doc = ?, row_version = row_version + 1, updated_at = datetime('now') where episode_id = ?").run(JSON.stringify(updated), input.episode_id);
    return { ok: true, row_version: row.row_version + 1, ...(input.edit.type === "insert" ? { shot_id: input.edit.shot_id } : {}) } as const;
  }).immediate();
}
