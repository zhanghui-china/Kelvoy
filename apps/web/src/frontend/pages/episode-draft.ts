import type { EpisodeAspect } from "@kelvoy/engine";

export const EPISODE_DRAFT_KEY = "kelvoy_new_episode_draft";
export type EpisodeDraft = {
  personaId: string;
  destinationId: string;
  templateId: string;
  seasonMode: "preset" | "custom";
  season: string;
  tone: string;
  banned: string[];
  outfitOverride: string;
  candidates: number;
  name: string;
  requirements: string;
  aspect: EpisodeAspect;
};

/** An explicit destination link starts a new location choice while retaining the
 * writer's independent brief fields. Template and season belong to the old place. */
export function draftForDestinationParam(draft: EpisodeDraft | null, destinationId: string | null): EpisodeDraft | null {
  if (!draft || !destinationId || draft.destinationId === destinationId) return draft;
  return { ...draft, destinationId, templateId: "", seasonMode: "preset", season: "" };
}

function isDraft(value: unknown): value is EpisodeDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return ["personaId", "destinationId", "templateId", "season", "tone", "outfitOverride", "name", "requirements"].every((key) => typeof draft[key] === "string")
    && (draft.seasonMode === "preset" || draft.seasonMode === "custom")
    && (draft.aspect === "9:16" || draft.aspect === "16:9")
    && typeof draft.candidates === "number" && Number.isInteger(draft.candidates)
    && Array.isArray(draft.banned) && draft.banned.every((term: unknown) => typeof term === "string");
}

export function readDraft(): EpisodeDraft | null {
  try {
    const raw = sessionStorage.getItem(EPISODE_DRAFT_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return isDraft(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveDraft(draft: EpisodeDraft): void {
  try { sessionStorage.setItem(EPISODE_DRAFT_KEY, JSON.stringify(draft)); }
  catch { /* Browser storage can be unavailable. */ }
}

export function selectDraftPersona(personaId: string): void {
  const draft = readDraft();
  if (draft) saveDraft({ ...draft, personaId });
}

export function clearDraft(): void {
  try { sessionStorage.removeItem(EPISODE_DRAFT_KEY); }
  catch { /* Browser storage can be unavailable. */ }
}
