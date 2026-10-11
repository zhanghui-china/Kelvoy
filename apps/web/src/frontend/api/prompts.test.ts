import { afterEach, expect, test } from "bun:test";
import { fetchPromptTraces } from "./prompts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const okBody = { ok: true, items: [], next_before: null, legacy: null };

function capture(response: () => Response | Promise<Response> = () => Response.json(okBody)) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return response();
  }) as unknown as typeof fetch;
  return calls;
}

test("builds a GET url with only the parameters that were given", async () => {
  const calls = capture();
  await fetchPromptTraces("ep1", { kind: "script" });
  expect(calls[0].url).toBe("/api/episodes/ep1/prompts?kind=script");
  expect(calls[0].init?.method ?? "GET").toBe("GET");
});

test("encodes every variable part of the url", async () => {
  const calls = capture();
  await fetchPromptTraces("a/b c", { kind: "video", shotId: "s 1&x=2", before: "9#", limit: 5 });
  expect(calls[0].url).toBe(
    "/api/episodes/a%2Fb%20c/prompts?kind=video&shot_id=s%201%26x%3D2&limit=5&before=9%23",
  );
});

test("returns the parsed body on success", async () => {
  capture(() => Response.json({ ...okBody, next_before: "7" }));
  const result = await fetchPromptTraces("ep1", { kind: "script" });
  expect(result).toEqual({ ...okBody, next_before: "7" });
});

test("maps http and transport failures to a failed result without throwing", async () => {
  capture(() => Response.json({ ok: false, error: "not_found" }, { status: 404 }));
  expect(await fetchPromptTraces("ep1", { kind: "script" })).toEqual({ ok: false, error: "not_found" });
  capture(() => new Response("bad gateway", { status: 502 }));
  expect(await fetchPromptTraces("ep1", { kind: "script" })).toEqual({ ok: false, error: "invalid_response" });
  globalThis.fetch = (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
  expect(await fetchPromptTraces("ep1", { kind: "script" })).toEqual({ ok: false, error: "network_error" });
});

test("rejects a 200 body that does not look like a trace page", async () => {
  capture(() => Response.json({ ok: true }));
  expect(await fetchPromptTraces("ep1", { kind: "script" })).toEqual({ ok: false, error: "invalid_response" });
});

test("passes an abort signal through and reports aborts distinctly", async () => {
  const controller = new AbortController();
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  })) as unknown as typeof fetch;
  const pending = fetchPromptTraces("ep1", { kind: "script" }, controller.signal);
  controller.abort();
  expect(await pending).toEqual({ ok: false, error: "aborted" });
});

test("an already aborted signal never reaches the network", async () => {
  const calls = capture();
  const controller = new AbortController();
  controller.abort();
  expect(await fetchPromptTraces("ep1", { kind: "script" }, controller.signal)).toEqual({ ok: false, error: "aborted" });
  expect(calls.length).toBe(0);
});
