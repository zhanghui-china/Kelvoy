import type { Shot } from "@kelvoy/engine";

/**
 * Refresh key for a shot's video prompt trace. Includes status because a failed
 * regeneration leaves clip and h3_prompt untouched yet appends a new (failed)
 * trace record that the person most wants to see.
 */
export function videoPromptRefreshKey(shot: Shot): string {
  return `${shot.status}:${shot.clip ?? ""}:${shot.model?.video?.h3_prompt?.input_hash ?? ""}`;
}
