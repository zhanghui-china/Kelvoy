import type { MusicProvider } from "./types";

/**
 * 音乐 (PRD §7): not on the critical path for MVP — uses a licensed music
 * library lookup, not generation (ACE-Step/YuE-style models are a later
 * option, not scaffolded here).
 */
export const musicLibraryProvider: MusicProvider = {
  async selectTrack(_input) {
    throw new Error("not implemented");
  },
};
