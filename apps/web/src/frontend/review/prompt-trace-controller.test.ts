import { expect, test } from "bun:test";
import type { PromptTraceItem, PromptTracesResponse } from "../../shared/prompt-traces";
import type { ApiResult } from "../api/client";
import { createPromptTraceController } from "./prompt-trace-controller";

function item(id: string): PromptTraceItem {
  return {
    id, kind: "h3_rewrite", shot_id: "s1", round: null, attempt: 1, source: "llm", outcome: "ok",
    validated: true, rule: null, model: null, skill_version: null, writer_version: null, h3_mode: null,
    user_message: `msg ${id}`, correction_message: null, final_prompt: `final ${id}`, rejected_output: null, input_hash: null,
    truncated: false, created_at: "2026-10-11T00:00:00Z",
  };
}
const page = (ids: string[], next: string | null = null, legacy: PromptTracesResponse["legacy"] = null)
  : ApiResult<PromptTracesResponse> => ({ ok: true, items: ids.map(item), next_before: next, legacy });

type Call = {
  before: string | undefined; signal: AbortSignal;
  resolve: (r: ApiResult<PromptTracesResponse>) => void;
};
function harness() {
  const calls: Call[] = [];
  const controller = createPromptTraceController({
    fetchPage: (before, signal) => new Promise((resolve) => { calls.push({ before, signal, resolve }); }),
  });
  return { calls, controller };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("idle until load: construction and close issue no request", () => {
  const { calls, controller } = harness();
  controller.close();
  expect(controller.getState()).toEqual({ status: "idle" });
  expect(calls.length).toBe(0);
});

test("load goes loading then ready with items, cursor and legacy", async () => {
  const { calls, controller } = harness();
  controller.load();
  expect(controller.getState()).toEqual({ status: "loading" });
  calls[0].resolve(page(["2", "1"], "1"));
  await tick();
  const state = controller.getState();
  expect(state.status).toBe("ready");
  if (state.status !== "ready") throw new Error("unreachable");
  expect(state.items.map((i) => i.id)).toEqual(["2", "1"]);
  expect(state.nextBefore).toBe("1");
  expect(state.loadingMore).toBe(false);
});

test("no records becomes empty and keeps the legacy note", async () => {
  const { calls, controller } = harness();
  controller.load();
  calls[0].resolve(page([], null, { note: "final_only", final_prompt: "old prompt" }));
  await tick();
  expect(controller.getState()).toEqual({ status: "empty", legacy: { note: "final_only", final_prompt: "old prompt" } });
  controller.load();
  expect(calls.length).toBe(1);
});

test("empty without legacy has a null legacy", async () => {
  const { calls, controller } = harness();
  controller.load();
  calls[0].resolve(page([]));
  await tick();
  expect(controller.getState()).toEqual({ status: "empty", legacy: null });
});

test("any failed result (404, 400, network) becomes a generic error and retry recovers", async () => {
  for (const error of ["not_found", "invalid_kind", "network_error", "invalid_response"]) {
    const { calls, controller } = harness();
    controller.load();
    calls[0].resolve({ ok: false, error });
    await tick();
    expect(controller.getState()).toEqual({ status: "error" });
    controller.retry();
    expect(controller.getState()).toEqual({ status: "loading" });
    calls[1].resolve(page(["1"]));
    await tick();
    expect(controller.getState().status).toBe("ready");
  }
});

test("loadMore appends the next page, uses the cursor and skips duplicate ids", async () => {
  const { calls, controller } = harness();
  controller.load();
  calls[0].resolve(page(["3", "2"], "2"));
  await tick();
  controller.loadMore();
  const loading = controller.getState();
  expect(loading.status === "ready" && loading.loadingMore).toBe(true);
  expect(calls[1].before).toBe("2");
  controller.loadMore(); // double click while in flight
  expect(calls.length).toBe(2);
  calls[1].resolve(page(["2", "1"], null));
  await tick();
  const state = controller.getState();
  if (state.status !== "ready") throw new Error("expected ready");
  expect(state.items.map((i) => i.id)).toEqual(["3", "2", "1"]);
  expect(state.nextBefore).toBeNull();
  expect(state.loadingMore).toBe(false);
});

test("a failed loadMore keeps the loaded items and flags the failure", async () => {
  const { calls, controller } = harness();
  controller.load();
  calls[0].resolve(page(["2"], "2"));
  await tick();
  controller.loadMore();
  calls[1].resolve({ ok: false, error: "network_error" });
  await tick();
  const state = controller.getState();
  if (state.status !== "ready") throw new Error("expected ready");
  expect(state.items.length).toBe(1);
  expect(state.loadingMore).toBe(false);
  expect(state.moreFailed).toBe(true);
  controller.loadMore();
  const retrying = controller.getState();
  expect(retrying.status === "ready" && retrying.moreFailed).toBe(false);
});

test("a stale response never overwrites a newer one", async () => {
  const { calls, controller } = harness();
  controller.refresh("k1");
  controller.load();
  calls[0].resolve({ ok: false, error: "network_error" });
  await tick();
  controller.retry(); // request #2
  controller.refresh("k2"); // open + key change -> request #3, aborts #2
  expect(calls.length).toBe(3);
  expect(calls[1].signal.aborted).toBe(true);
  calls[2].resolve(page(["new"]));
  await tick();
  calls[1].resolve(page(["old"])); // arrives late even though aborted
  await tick();
  const state = controller.getState();
  if (state.status !== "ready") throw new Error("expected ready");
  expect(state.items.map((i) => i.id)).toEqual(["new"]);
});

test("collapse then expand reuses loaded data without a new request", async () => {
  const { calls, controller } = harness();
  controller.load();
  calls[0].resolve(page(["1"]));
  await tick();
  controller.close();
  controller.load();
  expect(calls.length).toBe(1);
  expect(controller.getState().status).toBe("ready");
});

test("refresh key change refetches only while open; collapsed ones refetch on next expand", async () => {
  const { calls, controller } = harness();
  controller.refresh("a"); // never opened: nothing
  expect(calls.length).toBe(0);
  controller.load();
  calls[0].resolve(page(["1"]));
  await tick();
  controller.refresh("a"); // same key: nothing
  expect(calls.length).toBe(1);
  controller.refresh("b"); // open + changed
  expect(calls.length).toBe(2);
  calls[1].resolve(page(["2", "1"]));
  await tick();
  controller.close();
  controller.refresh("c"); // collapsed: no request
  expect(calls.length).toBe(2);
  controller.load(); // stale -> fetch now
  expect(calls.length).toBe(3);
});

test("dispose aborts the in-flight request and drops its response", async () => {
  const { calls, controller } = harness();
  controller.load();
  controller.dispose();
  expect(calls[0].signal.aborted).toBe(true);
  calls[0].resolve(page(["1"]));
  await tick();
  expect(controller.getState().status).not.toBe("ready");
});

test("subscribers are notified of each state change and can unsubscribe", async () => {
  const { calls, controller } = harness();
  let notified = 0;
  const off = controller.subscribe(() => { notified += 1; });
  controller.load();
  expect(notified).toBe(1);
  calls[0].resolve(page(["1"]));
  await tick();
  expect(notified).toBe(2);
  off();
  controller.close();
  controller.refresh("z");
  expect(notified).toBe(2);
});
