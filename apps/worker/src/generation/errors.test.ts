import { expect, test } from "bun:test";
import { inferenceFailure } from "./errors";

test("timeouts and invalid parameters never retry while transient outages retry", () => {
  expect(inferenceFailure({ type: "timeout" }, true).retryable).toBe(false);
  expect(inferenceFailure({ type: "invalid_request", details: {} }, true).retryable).toBe(false);
  expect(inferenceFailure({ type: "http_error", status: 504, body: "legacy timeout" }, true).retryable).toBe(false);
  expect(inferenceFailure({ type: "network", message: "secret hostname" }, true).retryable).toBe(true);
  expect(inferenceFailure({ type: "http_error", status: 503, body: "legacy outage" }, true).retryable).toBe(true);
});

test("raw backend errors never enter diagnostics", () => {
  const failure = inferenceFailure({ type: "http_error", status: 502, body: "secret prompt" }, true);
  expect(JSON.stringify(failure.diagnostic)).not.toContain("secret");
});

test("unconfirmed cancellation never claims generation stopped", () => {
  const failure = inferenceFailure({ type: "timeout" }, true);
  expect(failure.diagnostic.message).not.toContain("已停止");
  expect(failure.diagnostic.message).toContain("未确认");
});
