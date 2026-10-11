import { expect, test } from "bun:test";
import { ContentBlockedError } from "@kelvoy/engine";
import { classifyH3Failure, inferenceFailure } from "./errors";
import { H3FormatError } from "./h3-prompt-format";

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

test("classifyH3Failure maps writer errors to the shared diagnostic code", () => {
  const blocked = classifyH3Failure(new ContentBlockedError([{ field: "x", term: "y", category: "test" }]));
  expect(blocked).toMatchObject({ code: "content_blocked", outcome: "content_blocked", retryable: false });
  const invalid = new H3FormatError("private", true, "some rule");
  invalid.corrected = true;
  expect(classifyH3Failure(invalid)).toMatchObject({ code: "prompt_format_invalid", outcome: "prompt_format_invalid", rule: "some rule", corrected: true, retryable: true });
  expect(classifyH3Failure(new Error("H3 prompt rewrite timed out"))).toMatchObject({ code: "prompt_rewrite_timeout", outcome: "prompt_rewrite_timeout", retryable: true });
  expect(classifyH3Failure(new Error("H3 rewrite HTTP 500"))).toMatchObject({ code: "prompt_rewrite_failed", outcome: "prompt_rewrite_failed", retryable: true });
  expect(classifyH3Failure("weird")).toMatchObject({ code: "prompt_rewrite_failed" });
});
