import type { Destination } from "@kelvoy/engine";
import { getDb } from "./db";

/**
 * Destination storage (ADR-0004). Validation is the caller's job
 * (packages/cli/src/validate-destination.ts) — this module only persists
 * already-valid data, same division of labor as episodes.ts.
 */

interface DestinationRow {
  doc: string;
}

export async function upsertDestination(destination: Destination): Promise<void> {
  getDb()
    .query(
      `insert into destinations (destination_id, version, doc, updated_at)
       values (?, ?, ?, datetime('now'))
       on conflict (destination_id) do update set
         version = excluded.version,
         doc = excluded.doc,
         updated_at = excluded.updated_at`,
    )
    .run(destination.destination_id, destination.version, JSON.stringify(destination));
}

export async function getDestination(destinationId: string): Promise<Destination | null> {
  const row = getDb()
    .query<DestinationRow, [string]>("select doc from destinations where destination_id = ?")
    .get(destinationId);
  return row ? (JSON.parse(row.doc) as Destination) : null;
}

export async function listDestinations(): Promise<Destination[]> {
  const rows = getDb()
    .query<DestinationRow, []>("select doc from destinations order by destination_id")
    .all();
  return rows.map((row) => JSON.parse(row.doc) as Destination);
}
