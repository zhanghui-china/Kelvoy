import { hasUsableClip, hasSelectedFrame, type Episode, type Shot } from "@kelvoy/engine";
import type { StoryboardDraft, StoryboardPrices } from "../api/client";

/** The API supplies identities; fallback only supports old offline/SSR fixtures. */
export function shotIdentity(shot: Shot): string {
  return (shot as Shot & { shot_id?: string }).shot_id ?? `legacy-${shot.no}`;
}
export function reorderedIds(order: string[], source: string, target: string): string[] {
  if (source === target || !order.includes(source) || !order.includes(target)) return order;
  const next = order.filter((id) => id !== source);
  next.splice(order.indexOf(target), 0, source);
  return next;
}
export function fillMissingSuggestion<T extends Partial<StoryboardDraft>>(current: T,
  suggestion: Partial<StoryboardDraft>, edited: ReadonlySet<string>): T {
  const next = { ...current };
  for (const [key, value] of Object.entries(suggestion)) {
    const field = key as keyof T;
    if (!edited.has(key) && (next[field] === "" || next[field] === null || next[field] === undefined)) {
      next[field] = value as T[keyof T];
    }
  }
  return next;
}
export function storyboardDuration(shots: readonly { duration_s?: number }[], policy?: string): number {
  return policy === "fixed_1s" ? shots.length : shots.reduce((sum, shot) => sum + (shot.duration_s ?? 1), 0);
}
export function emptyShot(scene: string): StoryboardDraft {
  return { scene, size: "medium", camera: "static", landmark: null, beat: "", caption: "", kf_prompt: "", motion_prompt: "" };
}

/** Empty inputs are missing fields, never supplied constraints for the model. */
export function suggestionFields(draft: StoryboardDraft): Partial<StoryboardDraft> {
  return Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== null && value !== undefined &&
    (typeof value !== "string" || value.trim() !== ""))) as Partial<StoryboardDraft>;
}

export function pendingGenerationEstimate(episode: Episode, prices: StoryboardPrices): number {
  const missing = episode.shots.filter((shot) => !hasUsableClip(shot));
  const frames = episode.video_source === "references" ? 0 : missing.filter((shot) =>
    !hasSelectedFrame(shot) && !shot.candidates?.length).length * (episode.candidate_count ?? 1);
  return frames * prices.image + missing.length * prices.video;
}
