import { OUTFIT_REFS_MAX, OUTFIT_REFS_MIN, PERSONA_OUTFITS_MAX } from "@kelvoy/engine";
import type { OutfitPatch, Persona, PersonaOutfit } from "@kelvoy/engine";
import { getDb } from "./db";
import { cancelViewsJobsForPersona } from "./persona-views-jobs";

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
    .query<PersonaRow, [string]>("select doc from personas where persona_id = ? and deleted_at is null")
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
    .query<PersonaRow, [string]>("select doc from personas where deleted_at is null and (owner_id = ? or owner_id is null) order by persona_id")
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

/** Append uploaded refs against the latest stored revision under one writer lock. */
export function appendPersonaRefs(input: {
  persona_id: string; owner_id: string; refs: string[]; min: number; max: number;
}): { ok: true; persona: Persona } | { ok: false; error: "not_found" | "invalid_ref_count" } {
  const database = getDb();
  return database.transaction(() => {
    const current = readPersona(input.persona_id);
    if (!current || current.owner_id !== input.owner_id) return { ok: false, error: "not_found" } as const;
    const count = current.refs.length + input.refs.length;
    if (count < input.min || count > input.max) return { ok: false, error: "invalid_ref_count" } as const;
    const updated = { ...current, version: current.version + 1, refs: [...current.refs, ...input.refs] };
    const doc = JSON.stringify(updated);
    database.query("update personas set version = ?, doc = ?, updated_at = datetime('now') where persona_id = ?")
      .run(updated.version, doc, input.persona_id);
    database.query("insert into persona_versions (persona_id, version, doc) values (?, ?, ?)")
      .run(input.persona_id, updated.version, doc);
    return { ok: true, persona: updated } as const;
  }).immediate();
}

export type OutfitMutationError = "not_found" | "outfit_not_found" | "too_many_outfits" | "invalid_ref_count";
export type OutfitMutationResult =
  | { ok: true; persona: Persona; outfit: PersonaOutfit | null }
  | { ok: false; error: OutfitMutationError };

/**
 * Every outfit edit is a normal persona revision: version + 1 and a new
 * persona_versions row, so episodes pinned to an older version keep exactly
 * the outfits (and files) they were created with. Owner-scoped like
 * appendPersonaRefs; official personas (owner_id null) are never writable here.
 */
function mutateOutfits(
  personaId: string,
  ownerId: string,
  change: (outfits: PersonaOutfit[]) => { outfits: PersonaOutfit[]; outfit: PersonaOutfit | null } | OutfitMutationError,
): OutfitMutationResult {
  const database = getDb();
  return database.transaction((): OutfitMutationResult => {
    const current = readPersona(personaId);
    if (!current || current.owner_id !== ownerId) return { ok: false, error: "not_found" };
    const changed = change(current.outfits ?? []);
    if (typeof changed === "string") return { ok: false, error: changed };
    const updated: Persona = { ...current, version: current.version + 1, outfits: changed.outfits };
    const doc = JSON.stringify(updated);
    database.query("update personas set version = ?, doc = ?, updated_at = datetime('now') where persona_id = ?")
      .run(updated.version, doc, personaId);
    database.query("insert into persona_versions (persona_id, version, doc) values (?, ?, ?)")
      .run(personaId, updated.version, doc);
    return { ok: true, persona: updated, outfit: changed.outfit };
  }).immediate();
}

export function addPersonaOutfit(input: {
  persona_id: string; owner_id: string; outfit: PersonaOutfit;
}): OutfitMutationResult {
  return mutateOutfits(input.persona_id, input.owner_id, (outfits) => {
    if (outfits.length >= PERSONA_OUTFITS_MAX) return "too_many_outfits";
    if (input.outfit.refs.length < OUTFIT_REFS_MIN || input.outfit.refs.length > OUTFIT_REFS_MAX) return "invalid_ref_count";
    return { outfits: [...outfits, input.outfit], outfit: input.outfit };
  });
}

export function patchPersonaOutfit(input: {
  persona_id: string; owner_id: string; outfit_id: string; patch: OutfitPatch;
}): OutfitMutationResult {
  return mutateOutfits(input.persona_id, input.owner_id, (outfits) => {
    const found = outfits.find((o) => o.outfit_id === input.outfit_id);
    if (!found) return "outfit_not_found";
    const outfit = { ...found, ...input.patch };
    return { outfits: outfits.map((o) => (o === found ? outfit : o)), outfit };
  });
}

/** Append-only like persona refs; the total must stay within 1–3 under the writer lock. */
export function appendOutfitRefs(input: {
  persona_id: string; owner_id: string; outfit_id: string; refs: string[];
}): OutfitMutationResult {
  return mutateOutfits(input.persona_id, input.owner_id, (outfits) => {
    const found = outfits.find((o) => o.outfit_id === input.outfit_id);
    if (!found) return "outfit_not_found";
    const refs = [...found.refs, ...input.refs];
    if (refs.length < OUTFIT_REFS_MIN || refs.length > OUTFIT_REFS_MAX) return "invalid_ref_count";
    const outfit = { ...found, refs };
    return { outfits: outfits.map((o) => (o === found ? outfit : o)), outfit };
  });
}

/** Removes it from the latest revision only; older revisions, episodes and files are untouched. */
export function removePersonaOutfit(input: {
  persona_id: string; owner_id: string; outfit_id: string;
}): OutfitMutationResult {
  return mutateOutfits(input.persona_id, input.owner_id, (outfits) => {
    if (!outfits.some((o) => o.outfit_id === input.outfit_id)) return "outfit_not_found";
    return { outfits: outfits.filter((o) => o.outfit_id !== input.outfit_id), outfit: null };
  });
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

/** Keep the catalog revision unchanged so exact delete retries stay idempotent. */
export async function deletePersona(personaId: string, ownerId: string, version: number):
  Promise<{ ok: true } | { ok: false; error: "not_found" | "version_conflict" }> {
  const database = getDb();
  return database.transaction(() => {
    const row = database.query<{ owner_id: string | null; version: number }, [string]>(
      "select owner_id, version from personas where persona_id = ?",
    ).get(personaId);
    if (!row || row.owner_id !== ownerId) return { ok: false, error: "not_found" } as const;
    if (row.version !== version) return { ok: false, error: "version_conflict" } as const;
    database.query("update personas set deleted_at = coalesce(deleted_at, datetime('now')) where persona_id = ?")
      .run(personaId);
    // 软删除不级联到历史修订与文件，但在途的三视图生成要停并退还预留积分（ADR-0017）。
    cancelViewsJobsForPersona(personaId);
    return { ok: true } as const;
  }).immediate();
}

/** Historical references remain readable by their owner after catalog deletion. */
export async function canReadPersonaAsset(personaId: string, key: string, ownerId: string): Promise<boolean> {
  const database = getDb();
  const row = database.query<{ owner_id: string | null }, [string]>(
    "select owner_id from personas where persona_id = ?",
  ).get(personaId);
  if (!row || (row.owner_id !== null && row.owner_id !== ownerId)) return false;
  // Outfit images live in the same document ($.outfits[*].refs), so a pinned
  // older version keeps authorizing exactly the files it referenced. ADR-0017:
  // 三视图的 source 与 views 四个 key（默认穿搭在 Persona 自身，自建穿搭在 outfits[*]）同理。
  // 只比对这些明确的路径，不用 json_tree 全文匹配，避免 name/desc 等自由文本冒充授权。
  const viewKeys = ["front", "side", "back", "sheet"];
  const personaMatch = viewKeys.map((k) => `json_extract(v.doc, '$.views.${k}') = ?`).join(" or ");
  const outfitMatch = ["source", ...viewKeys.map((k) => `views.${k}`)].map((k) => `json_extract(o.value, '$.${k}') = ?`).join(" or ");
  return database.query<{ found: number }, string[]>(
    `select 1 as found from persona_versions v, json_each(v.doc, '$.refs') r
       where v.persona_id = ? and r.value = ?
     union all
     select 1 from persona_versions v, json_each(v.doc, '$.outfits') o, json_each(o.value, '$.refs') r
       where v.persona_id = ? and r.value = ?
     union all
     select 1 from persona_versions v where v.persona_id = ? and (${personaMatch})
     union all
     select 1 from persona_versions v, json_each(v.doc, '$.outfits') o
       where v.persona_id = ? and (${outfitMatch})
     limit 1`,
  ).get(personaId, key, personaId, key, personaId, ...viewKeys.map(() => key), personaId, ...[key, ...viewKeys.map(() => key)]) !== null;
}
