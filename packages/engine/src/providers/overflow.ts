/**
 * Overflow policy shape (PRD §7): DGX queue wait exceeding a threshold
 * (default 30 min) or 2 consecutive failures on a shot triggers switching
 * to the domestic-API implementation of the same interface. The actual
 * policy/thresholds are not implemented at skeleton stage.
 */
export interface OverflowDecision {
  shouldOverflow: boolean;
  reason?: "queue_wait_exceeded" | "consecutive_failures";
}

export function evaluateOverflow(_input: unknown): OverflowDecision {
  throw new Error("not implemented");
}
