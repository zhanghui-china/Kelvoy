import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { diagnosticsReducer, initialDiagnosticsState } from "./system-diagnostics";
import { DiagnosticsResults } from "./SystemDiagnostics";

const config = { version: 2, comfyui_base_url: "http://gpu:8188", bridge_base_url: null, updated_by: "ops", updated_at: null };
const result = { checked_at: "2026-10-09T00:00:00Z", checks: [{ service: "comfyui" as const, status: "busy" as const, duration_ms: 12, address: "http://gpu:8188", queue: { running: 1, pending: 2 }, dependencies: [{ workflow: "image", missing_nodes: ["Loader"], missing_models: ["weights"], status: "error" as const }] }] };

test("editing after a candidate test marks results stale", () => {
  let state = diagnosticsReducer(initialDiagnosticsState, { type: "loaded", data: { operator: true, config } });
  state = diagnosticsReducer(state, { type: "tested", result });
  expect(state.stale).toBe(false);
  state = diagnosticsReducer(state, { type: "edit", field: "comfyui", value: "http://new:8188" });
  expect(state.stale).toBe(true);
  expect(state.result).toEqual(result);
});

test("failed save retains operator input and config version", () => {
  let state = diagnosticsReducer(initialDiagnosticsState, { type: "loaded", data: { operator: true, config } });
  state = diagnosticsReducer(state, { type: "edit", field: "comfyui", value: "http://new:8188" });
  state = diagnosticsReducer(state, { type: "start", action: "save" });
  state = diagnosticsReducer(state, { type: "failed", error: "tasks_active" });
  expect(state.comfyui).toBe("http://new:8188");
  expect(state.config?.version).toBe(2);
  expect(state.pending).toBe(null);
});

test("saving inherited configuration clears overrides and invalidates results", () => {
  let state = diagnosticsReducer(initialDiagnosticsState, { type: "loaded", data: { operator: true, config } });
  state = diagnosticsReducer(state, { type: "tested", result });
  state = diagnosticsReducer(state, { type: "saved", config: { ...config, version: 3, comfyui_base_url: null } });
  expect(state.comfyui).toBe("");
  expect(state.config?.version).toBe(3);
  expect(state.stale).toBe(true);
});

test("ordinary results omit backend addresses, queues and dependencies", () => {
  const html = renderToStaticMarkup(<DiagnosticsResults result={result} operator={false} stale={false} />);
  expect(html).toContain("忙碌");
  expect(html).not.toContain("http://gpu");
  expect(html).not.toContain("Loader");
  expect(html).not.toContain("等待");
});

test("operator results show queue and missing dependencies without passing them", () => {
  const html = renderToStaticMarkup(<DiagnosticsResults result={result} operator stale />);
  expect(html).toContain("已过期");
  expect(html).toContain("http://gpu:8188");
  expect(html).toContain("Loader");
  expect(html).toContain("weights");
  expect(html).toContain("异常");
});

test("same-tick actions send one request and release the guard after failure", async () => {
  const { createDiagnosticsActionRunner } = await import("./system-diagnostics");
  const run = createDiagnosticsActionRunner();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  const first = run(async () => { requests++; await blocked; });
  await run(async () => { requests++; });
  expect(requests).toBe(1);
  release();
  await first;
  await expect(run(async () => { throw new Error("failed"); })).rejects.toThrow("failed");
  await run(async () => { requests++; });
  expect(requests).toBe(2);
});
