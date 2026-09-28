import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { callInference } from "./inference-client";

let server: ReturnType<typeof Bun.serve> | undefined;
let handler: (req: Request) => Response | Promise<Response>;

beforeEach(() => {
  handler = () => new Response("not set", { status: 500 });
  server = Bun.serve({ port: 0, fetch: (req) => handler(req) });
  process.env.INFERENCE_BASE_URL = `http://127.0.0.1:${server.port}`;
});

afterEach(() => {
  server?.stop(true);
  delete process.env.INFERENCE_BASE_URL;
});

test("maps a successful response", async () => {
  handler = () =>
    Response.json({
      paths: ["kf/07_a.png"],
      model: "qwen-image",
      version: "2.1",
      seed: 1,
      seconds: 3.2,
    });

  const result = await callInference("/image/", { prompt: "灵山大佛" });
  expect(result.ok).toBe(true);
  expect(result.ok && result.response.paths).toEqual(["kf/07_a.png"]);
});

test("maps 501 to not_implemented", async () => {
  handler = () => new Response(JSON.stringify({ detail: "not implemented" }), { status: 501 });

  const result = await callInference("/image/", { prompt: "test" });
  expect(result).toEqual({ ok: false, error: { type: "not_implemented" } });
});

test("maps 422 to invalid_request, carrying the response body as details", async () => {
  const body = { detail: [{ loc: ["body", "prompt"], msg: "field required" }] };
  handler = () => Response.json(body, { status: 422 });

  const result = await callInference("/image/", { prompt: "test" });
  expect(result.ok).toBe(false);
  expect(!result.ok && result.error).toEqual({ type: "invalid_request", details: body });
});

test("maps other non-2xx statuses to http_error", async () => {
  handler = () => new Response("boom", { status: 500 });

  const result = await callInference("/image/", { prompt: "test" });
  expect(result).toEqual({
    ok: false,
    error: { type: "http_error", status: 500, body: "boom" },
  });
});

test("maps a response slower than the configured timeout to timeout", async () => {
  handler = async () => {
    await Bun.sleep(200);
    return Response.json({});
  };

  const result = await callInference("/image/", { prompt: "test" }, { timeoutMs: 20 });
  expect(result).toEqual({ ok: false, error: { type: "timeout" } });
});

test("caller abort cancels an in-flight inference request separately from timeout", async () => {
  handler = async () => { await Bun.sleep(200); return Response.json({}); };
  const controller = new AbortController();
  const call = callInference("/image/", { prompt: "test" },
    { timeoutMs: 1000, signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  expect(await call).toEqual({ ok: false, error: { type: "cancelled" } });
});

test("maps a connection failure (nothing listening) to network", async () => {
  process.env.INFERENCE_BASE_URL = "http://127.0.0.1:59999";

  const result = await callInference("/image/", { prompt: "test" });
  expect(result.ok).toBe(false);
  expect(!result.ok && result.error.type).toBe("network");
});


for (const response of [null, [], {},
  { paths: [1], model: "m", version: "v", seed: 1, seconds: 1 },
  { paths: ["inference/image/a.png"], model: 1, version: "v", seed: 1, seconds: 1 },
  { paths: ["inference/image/a.png"], model: "m", version: " ", seed: 1, seconds: 1 },
  { paths: ["inference/image/a.png"], model: "m", version: "v", seed: 1.5, seconds: 1 },
  { paths: ["inference/image/a.png"], model: "m", version: "v", seed: 1, seconds: -1 },
]) {
  test(`rejects invalid successful wire response: ${JSON.stringify(response)}`, async () => {
    handler = () => Response.json(response);
    expect(await callInference("/image/", { prompt: "test" })).toEqual({
      ok: false, error: { type: "invalid_response" },
    });
  });
}

test("malformed JSON is a protocol failure rather than a connection failure", async () => {
  handler = () => new Response("not json", { status: 200 });
  expect(await callInference("/image/", { prompt: "test" })).toEqual({
    ok: false, error: { type: "invalid_response" },
  });
});


test("default HTTP deadline leaves 20 seconds after direct generation and cancellation", async () => {
  handler = () => Response.json({ paths: ["inference/video/a.mp4"], model: "m", version: "v", seed: 1, seconds: 1 });
  const timer = spyOn(globalThis, "setTimeout");
  try {
    expect((await callInference("/video/", { prompt: "test" })).ok).toBe(true);
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 300_000);
  } finally {
    timer.mockRestore();
  }
});
