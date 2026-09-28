import type { EventEmitter } from "node:events";

/** Stop accepting work and abort the active stage; its lease expires for reclaim. */
export function installShutdownHandlers(controller: AbortController,
  emitter: Pick<EventEmitter, "on" | "off"> = process): () => void {
  const stop = () => controller.abort();
  emitter.on("SIGTERM", stop);
  emitter.on("SIGINT", stop);
  return () => {
    emitter.off("SIGTERM", stop);
    emitter.off("SIGINT", stop);
  };
}
