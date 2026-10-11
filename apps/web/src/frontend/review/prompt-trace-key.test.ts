import { expect, test } from "bun:test";
import type { Shot } from "@kelvoy/engine";
import { createPromptTraceController } from "./prompt-trace-controller";
import { videoPromptRefreshKey } from "./prompt-trace-key";

const shot = (status: string, clip: string | null = "clips/1.mp4", hash = "h1") => ({
  status, clip, model: { video: { h3_prompt: { input_hash: hash } } },
}) as unknown as Shot;

test("a failed regeneration changes the key even when clip and input hash are unchanged", () => {
  const keys = ["clip_ready", "regenerating", "failed"].map((s) => videoPromptRefreshKey(shot(s)));
  expect(new Set(keys).size).toBe(3);
});

test("key is stable for identical shots and tolerates missing fields", () => {
  expect(videoPromptRefreshKey(shot("clip_ready"))).toBe(videoPromptRefreshKey(shot("clip_ready")));
  expect(videoPromptRefreshKey({ status: "pending", clip: null } as unknown as Shot)).toBe("pending::");
  expect(videoPromptRefreshKey(shot("clip_ready", "clips/2.mp4"))).not.toBe(videoPromptRefreshKey(shot("clip_ready")));
  expect(videoPromptRefreshKey(shot("clip_ready", "clips/1.mp4", "h2"))).not.toBe(videoPromptRefreshKey(shot("clip_ready")));
});

test("the key drives the controller: open refetches on failure, collapsed goes stale", async () => {
  let calls = 0;
  const controller = createPromptTraceController({
    fetchPage: async () => { calls += 1; return { ok: true, items: [], next_before: null, legacy: null }; },
  });
  controller.refresh(videoPromptRefreshKey(shot("clip_ready")));
  controller.load();
  await new Promise((r) => setTimeout(r, 0));
  expect(calls).toBe(1);
  controller.refresh(videoPromptRefreshKey(shot("failed")));
  expect(calls).toBe(2);
  await new Promise((r) => setTimeout(r, 0));
  controller.close();
  controller.refresh(videoPromptRefreshKey(shot("regenerating")));
  expect(calls).toBe(2);
  controller.load();
  expect(calls).toBe(3);
});
