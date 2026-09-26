import type { Persona } from "@kelvoy/engine";
import { getDb } from "./db";

/**
 * Persona storage (M2-1). Persona.version lives inside the doc itself
 * (unlike episodes, which have a separate row_version) — updatePersona
 * owns bumping it, callers never pass a version in.
 */

interface PersonaRow {
  doc: string;
}

function readPersona(personaId: string): Persona | null {
  const row = getDb()
    .query<PersonaRow, [string]>("select doc from personas where persona_id = ?")
    .get(personaId);
  return row ? (JSON.parse(row.doc) as Persona) : null;
}

export async function insertPersona(persona: Persona): Promise<void> {
  const database = getDb();
  database.transaction(() => {
    const doc = JSON.stringify(persona);
    database.query("insert into personas (persona_id, owner_id, version, doc) values (?, ?, ?, ?)")
      .run(persona.persona_id, persona.owner_id, persona.version, doc);
    database.query("insert into persona_versions (persona_id, version, doc) values (?, ?, ?)")
      .run(persona.persona_id, persona.version, doc);
  }).immediate();
}

export async function getPersonaVersion(personaId: string, version: number): Promise<Persona | null> {
  const row = getDb().query<PersonaRow, [string, number]>(
    "select doc from persona_versions where persona_id = ? and version = ?",
  ).get(personaId, version);
  return row ? JSON.parse(row.doc) as Persona : null;
}

export async function getPersona(personaId: string): Promise<Persona | null> {
  return readPersona(personaId);
}

export async function listPersonas(ownerId: string): Promise<Persona[]> {
  const rows = getDb()
    .query<PersonaRow, [string]>("select doc from personas where owner_id = ? or owner_id is null order by persona_id")
    .all(ownerId);
  return rows.map((row) => JSON.parse(row.doc) as Persona);
}

export type UpdatePersonaResult =
  | { ok: true; persona: Persona }
  | { ok: false; error: "not_found" };

/**
 * Merges `patch` into the current persona and bumps `version` — the
 * caller never supplies a version (FR-03: version is store-owned so
 * episodes' persona_version snapshots stay meaningful).
 */
export async function updatePersona(
  personaId: string,
  patch: Partial<Omit<Persona, "persona_id" | "owner_id" | "version">>,
): Promise<UpdatePersonaResult> {
  const database = getDb();
  return database.transaction((): UpdatePersonaResult => {
    const current = readPersona(personaId);
    if (!current) return { ok: false, error: "not_found" };
    const { version: _ignoredVersion, owner_id: _ignoredOwner, persona_id: _ignoredId, ...safePatch } = patch as
      typeof patch & { version?: number; owner_id?: string | null; persona_id?: string };
    const updated: Persona = { ...current, ...safePatch, version: current.version + 1 };
    const doc = JSON.stringify(updated);
    database.query("update personas set version = ?, doc = ?, updated_at = datetime('now') where persona_id = ?")
      .run(updated.version, doc, personaId);
    database.query("insert into persona_versions (persona_id, version, doc) values (?, ?, ?)")
      .run(personaId, updated.version, doc);
    return { ok: true, persona: updated };
  }).immediate();
}

/** Internal catalog write. Public routes never call this entry point. */
export async function upsertOfficialPersona(input: Persona): Promise<{ persona: Persona; changed: boolean }> {
  if (input.owner_id !== null) throw new Error("official persona must have owner_id null");
  const database = getDb();
  return database.transaction(() => {
    const current = readPersona(input.persona_id);
    if (current && current.owner_id !== null) throw new Error(`persona ID belongs to a private account: ${input.persona_id}`);
    const next: Persona = { ...input, version: current ? current.version + 1 : 1 };
    if (current && JSON.stringify({ ...current, version: 0 }) === JSON.stringify({ ...next, version: 0 })) {
      return { persona: current, changed: false };
    }
    const doc = JSON.stringify(next);
    if (current) {
      database.query("update personas set version = ?, doc = ?, updated_at = datetime('now') where persona_id = ?")
        .run(next.version, doc, next.persona_id);
    } else {
      database.query("insert into personas (persona_id, owner_id, version, doc) values (?, null, ?, ?)")
        .run(next.persona_id, next.version, doc);
    }
    database.query("insert into persona_versions (persona_id, version, doc) values (?, ?, ?)")
      .run(next.persona_id, next.version, doc);
    return { persona: next, changed: true };
  }).immediate();
}
