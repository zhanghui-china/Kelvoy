import type { Destination, Persona, Shot } from "../schema";

export interface KeyframeReference {
  key: string;
  /** Position in the owner's `refs` and how many it has; shown as "第 N 张 / 共 M 张". */
  index: number;
  total: number;
}

export interface KeyframeReferences {
  persona: KeyframeReference | null;
  /** Set only when the shot names a landmark that has a usable reference image. */
  landmark: (KeyframeReference & { id: string; name: string }) | null;
  /** The landmark the shot asks for; non-null with `landmark` null means it is missing or has no image. */
  landmark_id: string | null;
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
  shot: Pick<Shot, "landmark">,
): KeyframeReferences {
  const personaKey = persona?.refs[0];
  const landmark = shot.landmark ? destination?.landmarks.find((item) => item.id === shot.landmark) : undefined;
  const landmarkKey = landmark?.refs[0];
  return {
    persona: persona && personaKey ? { key: personaKey, index: 0, total: persona.refs.length } : null,
    landmark: landmark && landmarkKey
      ? { id: landmark.id, name: landmark.name, key: landmarkKey, index: 0, total: landmark.refs.length }
      : null,
    landmark_id: shot.landmark ?? null,
  };
}
