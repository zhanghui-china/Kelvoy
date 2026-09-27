import type { Persona } from "@kelvoy/engine";

/** The list API returns only the caller's private roles and official roles. */
export function canEditPersona(persona: Persona): boolean {
  return persona.owner_id !== null;
}
