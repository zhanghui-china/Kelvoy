import type { Destination, Persona, Shot } from "../schema";
import { outfitSheetKey } from "../rules/outfit-sheet";

export interface KeyframeReference {
  key: string;
  /** Position in the owner's `refs` and how many it has; shown as "第 N 张 / 共 M 张". */
  index: number;
  total: number;
}

/**
 * `sheet` = the three-view character sheet (ADR-0017, one image, total 1); `photo` = the first
 * uploaded image of the outfit / persona (ADR-0015).
 */
export type PersonReferenceKind = "sheet" | "photo";
export type PersonReference = KeyframeReference & { kind: PersonReferenceKind };

export interface KeyframeReferences {
  /**
   * The person reference: the chosen outfit's (else the default's) ready three-view sheet, otherwise
   * the outfit's first image, otherwise the persona's first image.
   */
  persona: PersonReference | null;
  /** Set when `persona` comes from a custom outfit; null = default outfit (persona.refs). */
  outfit: { id: string; name: string } | null;
  /** Set only when the shot names a landmark that has a usable reference image. */
  landmark: (KeyframeReference & { id: string; name: string }) | null;
  /** The landmark the shot asks for; non-null with `landmark` null means it is missing or has no image. */
  landmark_id: string | null;
  /**
   * An empty shot (`person_visible === false`) with a usable landmark image: the person reference is
   * deliberately not sent, so "no person" is not contradicted by a face in the references.
   */
  person_omitted: boolean;
}

/**
 * The person reference for generation. A chosen outfit's reference *replaces* the persona's base
 * image — they are never sent together, because the model then draws two people (ADR-0015). When
 * the outfit (or, with none chosen, the persona default) has a ready three-view sheet, that single
 * sheet is the reference; otherwise the first uploaded image, as before (ADR-0017). An outfit id that
 * no longer resolves in this persona version falls back to the default outfit instead of failing the
 * shot; pinned versions are immutable so that only happens for hand-edited data.
 */
export function personaReference(
  persona: Persona | null | undefined,
  outfitId?: string | null,
): { ref: PersonReference | null; outfit: { id: string; name: string } | null } {
  const outfit = outfitId ? persona?.outfits?.find((item) => item.outfit_id === outfitId) : undefined;
  const sheet = outfit ? outfitSheetKey(persona, outfit.outfit_id) : outfitSheetKey(persona);
  const chosen = outfit && (sheet !== null || outfit.refs.length > 0) ? outfit : undefined;
  const outfitInfo = chosen ? { id: chosen.outfit_id, name: chosen.name } : null;
  if (chosen && sheet) return { ref: { key: sheet, index: 0, total: 1, kind: "sheet" }, outfit: outfitInfo };
  // An outfit without refs and without a ready sheet falls back to the default outfit, whose sheet
  // (if ready) is still preferred.
  const defaultSheet = chosen ? null : outfitSheetKey(persona);
  if (defaultSheet) return { ref: { key: defaultSheet, index: 0, total: 1, kind: "sheet" }, outfit: null };
  const source = chosen ? chosen.refs : persona?.refs ?? [];
  const key = source[0];
  return { ref: key ? { key, index: 0, total: source.length, kind: "photo" } : null, outfit: outfitInfo };
}

/**
 * The reference images keyframe generation feeds the model, in provider order
 * (persona first, then landmark). This is the single source for both runKeyframe
 * and the review UI so what is shown is what was used: today always the first
 * image of each; `index` is kept so a per-shot choice can slot in later without
 * changing the shape.
 */
export function keyframeReferences(
  persona: Persona | null | undefined,
  destination: Destination | null | undefined,
  shot: Pick<Shot, "landmark" | "person_visible">,
  outfitId?: string | null,
): KeyframeReferences {
  const person = personaReference(persona, outfitId);
  const landmark = shot.landmark ? destination?.landmarks.find((item) => item.id === shot.landmark) : undefined;
  const landmarkKey = landmark?.refs[0];
  const landmarkRef = landmark && landmarkKey
    ? { id: landmark.id, name: landmark.name, key: landmarkKey, index: 0, total: landmark.refs.length }
    : null;
  // Only drop the person when there is a landmark image left to send: the image workflow needs at
  // least one reference, so an empty shot without a landmark keeps today's behaviour (known limitation).
  const personOmitted = shot.person_visible === false && landmarkRef !== null;
  return {
    persona: personOmitted ? null : person.ref,
    outfit: personOmitted ? null : person.outfit,
    landmark: landmarkRef,
    landmark_id: shot.landmark ?? null,
    person_omitted: personOmitted,
  };
}
