import type { Task } from "./types";

/**
 * Outbound-only queue consumer (PRD §9): the worker pulls tasks from Redis,
 * it never accepts inbound connections. Queue client library (BullMQ vs
 * raw ioredis vs other) is not chosen yet — open question, see plan.
 */
export async function consumeLoop(): Promise<never> {
  throw new Error("not implemented");
}

export async function handleTask(_task: Task): Promise<void> {
  throw new Error("not implemented");
}
