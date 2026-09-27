import type { Destination, DestinationType, Persona, Template } from "@kelvoy/engine";
import { DESTINATION_TYPE_LABELS } from "../labels";
export type LibraryType = DestinationType | "all";
export type PersonaSource = "mine" | "official";
function matches(query: string, values: (string | undefined)[]): boolean {
  return values.join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}
export function filterDestinations(items: Destination[], query: string, type: LibraryType): Destination[] {
  return items.filter(d => (type === "all" || d.type === type) && matches(query,
    [d.name, d.city, d.country_code, d.province, d.description, DESTINATION_TYPE_LABELS[d.type], ...d.landmarks.map(l => l.name)]));
}
export function filterTemplates(items: Template[], query: string, type: LibraryType): Template[] {
  return items.filter(t => (type === "all" || t.skeleton === type) && matches(query,
    [t.name, DESTINATION_TYPE_LABELS[t.skeleton]]));
}
export function filterPersonas(items: Persona[], source: PersonaSource): Persona[] {
  return items.filter(p => source === "official" ? p.owner_id === null : p.owner_id !== null);
}
/** Catalog availability is established by the existing authenticated API. */
export function availableSelection(id: string | null, availableIds: string[]): string | null {
  return id && availableIds.includes(id) ? id : null;
}
