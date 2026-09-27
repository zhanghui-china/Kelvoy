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
  const database = getDb();
  database.transaction(() => {
    const previous = database.query<{ version: number; doc: string }, [string]>(
      "select version, doc from destinations where destination_id = ?",
    ).get(destination.destination_id);
    const doc = JSON.stringify(destination);
    if (previous && (destination.version < previous.version ||
        (destination.version === previous.version && previous.doc !== doc))) {
      throw new Error("destination revision must increase when its content changes");
    }
    if (previous?.doc === doc) return;
    database.query(`insert into destinations (destination_id, version, doc, updated_at)
      values (?, ?, ?, datetime('now')) on conflict (destination_id) do update set
      version = excluded.version, doc = excluded.doc, updated_at = excluded.updated_at`)
      .run(destination.destination_id, destination.version, doc);
    database.query(`insert into destination_versions (destination_id, version, doc)
      values (?, ?, ?)`).run(destination.destination_id, destination.version, doc);
  }).immediate();
}

export async function getDestinationVersion(destinationId: string, version: number): Promise<Destination | null> {
  const row = getDb().query<DestinationRow, [string, number]>(
    "select doc from destination_versions where destination_id = ? and version = ?",
  ).get(destinationId, version);
  return row ? JSON.parse(row.doc) as Destination : null;
}

export async function getDestinationVersionInfo(destinationId: string, version: number): Promise<
  { destination: Destination; compatibility_approximation: boolean } | null
> {
  const row = getDb().query<DestinationRow & { compatibility_approximation: number }, [string, number]>(
    "select doc, compatibility_approximation from destination_versions where destination_id = ? and version = ?",
  ).get(destinationId, version);
  return row ? { destination: JSON.parse(row.doc) as Destination,
    compatibility_approximation: row.compatibility_approximation === 1 } : null;
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
