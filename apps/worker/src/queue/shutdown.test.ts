import { EventEmitter } from "node:events";
import { expect, test } from "bun:test";
import { installShutdownHandlers } from "./shutdown";

test("termination signals abort active work and release installed handlers", () => {
  for (const event of ["SIGTERM", "SIGINT"] as const) {
    const emitter = new EventEmitter();
    const controller = new AbortController();
    const uninstall = installShutdownHandlers(controller, emitter);
    expect(controller.signal.aborted).toBe(false);
    emitter.emit(event);
    expect(controller.signal.aborted).toBe(true);
    uninstall();
    expect(emitter.listenerCount("SIGTERM")).toBe(0);
    expect(emitter.listenerCount("SIGINT")).toBe(0);
  }
});
