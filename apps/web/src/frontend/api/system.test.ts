import { afterEach, expect, test } from "bun:test";
import { getSystemConfig, saveSystemConfig, testSystem } from "./system";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("ordinary diagnostics send no candidate configuration", async () => {
  let sent: unknown;
  globalThis.fetch = (async (_path: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({ ok: true, checked_at: "now", checks: [] });
  }) as unknown as typeof fetch;
  expect((await testSystem()).ok).toBe(true);
  expect(sent).toEqual({});
});

test("candidate test and save send the same overrides, with version only on save", async () => {
  const requests: { path: unknown; method: string | undefined; body: unknown }[] = [];
  globalThis.fetch = (async (path: unknown, init?: RequestInit) => {
    requests.push({ path, method: init?.method, body: JSON.parse(String(init?.body)) });
    return Response.json({ ok: true });
  }) as unknown as typeof fetch;
  const candidate = { comfyui_base_url: "http://gpu:8188", bridge_base_url: null };
  await testSystem(candidate);
  await saveSystemConfig({ ...candidate, version: 4 });
  expect(requests).toEqual([
    { path: "/api/system/test", method: "POST", body: candidate },
    { path: "/api/system/config", method: "PATCH", body: { ...candidate, version: 4 } },
  ]);
});

test("connection failures return an actionable result", async () => {
  globalThis.fetch = (async () => { throw new Error("connection refused"); }) as unknown as typeof fetch;
  expect(await getSystemConfig()).toEqual({ ok: false, error: "network_error" });
});

test("non-JSON response does not leave a request rejected", async () => {
  globalThis.fetch = (async () => new Response("upstream unavailable", { status: 502 })) as unknown as typeof fetch;
  expect((await testSystem()).ok).toBe(false);
});

test("every system request has a bounded abort signal", async () => {
  const signals: AbortSignal[] = [];
  globalThis.fetch = (async (_path: unknown, init?: RequestInit) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    signals.push(init!.signal!);
    return Response.json({ ok: true });
  }) as unknown as typeof fetch;
  await getSystemConfig();
  await testSystem();
  await saveSystemConfig({ version: 1, comfyui_base_url: null, bridge_base_url: null });
  expect(signals).toHaveLength(3);
  expect(new Set(signals).size).toBe(3);
});

test("aborted requests report timeout and permit a later retry", async () => {
  globalThis.fetch = (async () => { throw new DOMException("deadline exceeded", "TimeoutError"); }) as unknown as typeof fetch;
  expect(await testSystem()).toEqual({ ok: false, error: "timeout" });
  globalThis.fetch = (async () => Response.json({ ok: true, checked_at: "now", checks: [] })) as unknown as typeof fetch;
  expect((await testSystem()).ok).toBe(true);
});

test("diagnostic deadline aborts a waiting transport within the browser allowance", async () => {
  const originalTimeout = AbortSignal.timeout;
  const budgets: number[] = [];
  AbortSignal.timeout = (milliseconds: number) => {
    budgets.push(milliseconds);
    return originalTimeout(5);
  };
  globalThis.fetch = ((_path: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
  })) as unknown as typeof fetch;
  try {
    expect(await testSystem()).toEqual({ ok: false, error: "timeout" });
    expect(budgets).toEqual([16_000]);
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
});
