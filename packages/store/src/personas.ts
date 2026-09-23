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
  getDb()
    .query(
      "insert into personas (persona_id, owner_id, version, doc) values (?, ?, ?, ?)",
    )
    .run(persona.persona_id, persona.owner_id, persona.version, JSON.stringify(persona));
}

export async function getPersona(personaId: string): Promise<Persona | null> {
  return readPersona(personaId);
}

export async function listPersonas(ownerId: string): Promise<Persona[]> {
  const rows = getDb()
    .query<PersonaRow, [string]>("select doc from personas where owner_id = ? order by persona_id")
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
  const current = readPersona(personaId);
  if (!current) return { ok: false, error: "not_found" };

  const updated: Persona = { ...current, ...patch, version: current.version + 1 };
  getDb()
    .query("update personas set version = ?, doc = ?, updated_at = datetime('now') where persona_id = ?")
    .run(updated.version, JSON.stringify(updated), personaId);

  return { ok: true, persona: updated };
}
