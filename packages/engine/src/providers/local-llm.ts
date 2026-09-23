import type { ScriptProvider } from "./types";

/**
 * 脚本/分镜 (PRD §7): brief + destination pack -> shots JSON. Self-hosted via
 * Qwen3/DeepSeek on vLLM, called through services/inference's /llm endpoint.
 */
export const localLlmProvider: ScriptProvider = {
  async generateShots(_input) {
    throw new Error("not implemented");
  },
};
