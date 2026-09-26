import { expect, test } from "bun:test";
import { runStage } from "./index";
import type { Episode } from "../schema";

test("runStage dispatches to assets and checks its entry state", async () => {
  await expect(runStage("assets", {} as Episode)).rejects.toThrow("assets 阶段状态不正确");
});

test("runStage dispatches to brief (implemented, M1-10) and advances draft -> scripting", async () => {
  const updated = await runStage("brief", { status: "draft" } as Episode);
  expect(updated.status).toBe("scripting");
});

test("runStage blocks new generation for a legacy grid episode", async () => {
  await expect(runStage("brief", { mode: "grid", status: "draft" } as Episode))
    .rejects.toThrow("网格模式尚未完成");
});

test("runStage passes shotNo to a per-shot stage and requires worker context", async () => {
  await expect(runStage("keyframe", {} as Episode, 3)).rejects.toThrow("Worker 推理能力");
});
