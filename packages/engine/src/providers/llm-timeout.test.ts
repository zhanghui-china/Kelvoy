import { afterEach, expect, test } from "bun:test";
import { llmTimeoutMs, llmTimeoutSeconds } from "./llm-timeout";

const KEY = "KELVOY_LLM_TIMEOUT_SECONDS";
const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

test("defaults to 120 seconds when unset", () => {
  delete process.env[KEY];
  expect(llmTimeoutSeconds()).toBe(120);
  expect(llmTimeoutMs()).toBe(120_000);
});

test("accepts integers from 30 to 300", () => {
  for (const value of ["30", "45", "300"]) {
    process.env[KEY] = value;
    expect(llmTimeoutSeconds()).toBe(Number(value));
    expect(llmTimeoutMs()).toBe(Number(value) * 1000);
  }
});

test("rejects out-of-range, non-integer and empty values by throwing", () => {
  for (const value of ["29", "301", "abc", "1.5", ""]) {
    process.env[KEY] = value;
    expect(() => llmTimeoutSeconds()).toThrow(KEY);
  }
});
