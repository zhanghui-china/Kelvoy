/**
 * Per-request timeout for StepFun LLM calls, shared by the engine script provider and the
 * worker's H3 prompt writer. Configured by KELVOY_LLM_TIMEOUT_SECONDS (default 120, integer 30-300).
 *
 * This is the budget of ONE HTTP request, not of a whole operation: a format-correction round
 * sends another request, and the local retry policy allows up to two attempts, so a single
 * rewrite can occupy several budgets in the worst case.
 *
 * Invalid values throw (same policy as videoTimeoutSeconds in the worker) instead of silently
 * falling back, so a typo is caught at startup rather than as a mysterious timeout.
 */
export function llmTimeoutSeconds(): number {
  const value = Number(process.env.KELVOY_LLM_TIMEOUT_SECONDS ?? "120");
  if (!Number.isInteger(value) || value < 30 || value > 300) {
    throw new Error("KELVOY_LLM_TIMEOUT_SECONDS must be an integer from 30 to 300");
  }
  return value;
}

export function llmTimeoutMs(): number {
  return llmTimeoutSeconds() * 1000;
}
