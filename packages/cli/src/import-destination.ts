import type { Destination } from "@kelvoy/engine";
import type postgres from "postgres";
import { getDb } from "./db";
import { validateDestination } from "./validate-destination";

export interface ImportResult {
  ok: boolean;
  destination_id?: string;
  errors?: string[];
}

/**
 * Validates then upserts a destination pack (M1-2). Never writes on any
 * validation error — see validate-destination.ts for the full rule set.
 */
export async function importDestination(raw: unknown): Promise<ImportResult> {
  const result = validateDestination(raw);
  if (!result.valid) {
    return { ok: false, errors: result.errors };
  }
  await upsertDestination(result.value);
  return { ok: true, destination_id: result.value.destination_id };
}

async function upsertDestination(destination: Destination): Promise<void> {
  const sql = getDb();
  // `Destination` has named fields (no index signature), so it doesn't
  // structurally satisfy postgres.js's JSONValue map type even though it's
  // plain JSON-serializable data at runtime — hence the cast.
  const doc = sql.json(destination as unknown as postgres.JSONValue);
  await sql`
    insert into destinations (destination_id, version, doc, updated_at)
    values (${destination.destination_id}, ${destination.version}, ${doc}, now())
    on conflict (destination_id) do update
      set version = excluded.version,
          doc = excluded.doc,
          updated_at = now()
  `;
}
