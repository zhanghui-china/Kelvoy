import { expect, test } from "bun:test";
import { runStage } from "./index";
import type { Episode } from "../schema";

test("runStage dispatches to the named stage and rejects as not implemented", async () => {
  await expect(runStage("assets", {} as Episode)).rejects.toThrow("not implemented");
});

test("runStage dispatches to brief (implemented, M1-10) and advances draft -> scripting", async () => {
  const updated = await runStage("brief", { status: "draft" } as Episode);
  expect(updated.status).toBe("scripting");
});

// Per-shot stages (keyframe/video) need shot_no threaded through from the
// task queue (apps/worker/src/queue/consumer.ts) — this only proves the
// 3-arg call still dispatches; the stage bodies are still placeholders so
// there's nothing behavioral to observe yet about shotNo itself.
test("runStage accepts an optional shotNo and still dispatches to the named stage", async () => {
  await expect(runStage("keyframe", {} as Episode, 3)).rejects.toThrow("not implemented");
});
