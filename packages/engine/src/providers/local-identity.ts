import type { IdentityProvider } from "./types";

/**
 * 角色一致性 (PRD §7): persona reference images -> cross-shot/cross-episode
 * identity preservation. Self-hosted via PuLID/InstantID-style ID-preserving
 * adapters or Qwen-Image-Edit/FLUX Kontext, called through services/inference's
 * /image endpoint.
 */
export const localIdentityProvider: IdentityProvider = {
  async applyPersona(_input) {
    throw new Error("not implemented");
  },
};
