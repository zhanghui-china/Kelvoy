import type { Template } from "@kelvoy/engine";
import { getDb } from "./db";

/**
 * Template storage (M2-1). owner_id null = official built-in (FR-10).
 */

interface TemplateRow {
  doc: string;
}

export async function getTemplate(templateId: string): Promise<Template | null> {
  const row = getDb()
    .query<TemplateRow, [string]>("select doc from templates where template_id = ?")
    .get(templateId);
  return row ? (JSON.parse(row.doc) as Template) : null;
}

/**
 * No `ownerId` -> official templates only. With `ownerId` -> official
 * templates plus that user's own private ones.
 */
export async function listTemplates(ownerId?: string): Promise<Template[]> {
  const db = getDb();
  const rows = ownerId
    ? db
        .query<TemplateRow, [string]>(
          "select doc from templates where owner_id is null or owner_id = ? order by template_id",
        )
        .all(ownerId)
    : db
        .query<TemplateRow, []>("select doc from templates where owner_id is null order by template_id")
        .all();
  return rows.map((row) => JSON.parse(row.doc) as Template);
}

export async function upsertTemplate(template: Template): Promise<void> {
  getDb()
    .query(
      `insert into templates (template_id, owner_id, doc, updated_at)
       values (?, ?, ?, datetime('now'))
       on conflict (template_id) do update set
         owner_id = excluded.owner_id,
         doc = excluded.doc,
         updated_at = excluded.updated_at`,
    )
    .run(template.template_id, template.owner_id, JSON.stringify(template));
}
