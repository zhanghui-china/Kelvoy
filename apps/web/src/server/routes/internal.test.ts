import { afterEach, beforeEach, expect, test } from "bun:test";
import internal from "./internal";

const ORIGINAL_TOKEN = process.env.WORKER_INTERNAL_TOKEN;

beforeEach(() => {
  process.env.WORKER_INTERNAL_TOKEN = "test-token";
});

afterEach(() => {
  process.env.WORKER_INTERNAL_TOKEN = ORIGINAL_TOKEN;
});

test("rejects requests without a bearer token", async () => {
  const res = await internal.request("/episodes/e_1");
  expect(res.status).toBe(401);
});

test("rejects requests with the wrong token", async () => {
  const res = await internal.request("/episodes/e_1", {
    headers: { Authorization: "Bearer wrong" },
  });
  expect(res.status).toBe(401);
});

test("passes auth and reaches the (unimplemented) handler with the right token", async () => {
  const res = await internal.request("/episodes/e_1", {
    headers: { Authorization: "Bearer test-token" },
  });
  expect(res.status).toBe(501);
});
