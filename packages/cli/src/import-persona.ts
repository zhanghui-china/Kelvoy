import { validatePersona, type Persona } from "@kelvoy/engine";
import { upsertOfficialPersona } from "@kelvoy/store";

export type ImportPersonaResult =
  | { ok: true; persona: Persona; changed: boolean }
  | { ok: false; errors: string[] };

/** Only the internal CLI imports official roles. Asset bytes are seeded separately. */
export async function importOfficialPersona(raw: unknown): Promise<ImportPersonaResult> {
  const input = typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? { ...raw, version: 1 } : raw;
  const parsed = validatePersona(input);
  if (!parsed.valid) return { ok: false, errors: parsed.errors };
  const value = parsed.value;
  const persona: Persona = {
    persona_id: value.persona_id, owner_id: value.owner_id, version: 1,
    name: value.name, desc: value.desc, locked: value.locked,
    default_outfit: value.default_outfit, refs: value.refs, style: value.style,
  };
  const errors: string[] = [];
  if (persona.owner_id !== null) errors.push("owner_id: 官方角色必须为 null");
  if (!/^c_[a-z0-9_-]+$/.test(persona.persona_id)) errors.push("persona_id: 格式无效");
  if (persona.refs.some((ref) => !new RegExp(`^persona/${persona.persona_id}/[a-zA-Z0-9_-]+\\.(jpg|jpeg|png|webp)$`).test(ref))) {
    errors.push("refs: 必须位于本角色目录，且文件名安全");
  }
  if (errors.length > 0) return { ok: false, errors };
  try {
    const result = await upsertOfficialPersona(persona);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}
