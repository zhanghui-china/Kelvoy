import { afterEach, beforeEach, expect, test } from "bun:test";
import { close, open } from "./db";
import { createUser, getUserById, getUserByUsername } from "./users";

beforeEach(() => {
  open(":memory:");
});

afterEach(() => {
  close();
});

test("returns null for a missing user", async () => {
  expect(await getUserByUsername("nobody")).toBeNull();
  expect(await getUserById("u_missing")).toBeNull();
});

test("createUser round-trips by username and by id", async () => {
  const created = await createUser({ username: "dannei", password_hash: "hash1" });
  expect(created.ok).toBe(true);
  if (!created.ok) return;

  const byUsername = await getUserByUsername("dannei");
  expect(byUsername?.user_id).toBe(created.user.user_id);
  expect(byUsername?.password_hash).toBe("hash1");

  const byId = await getUserById(created.user.user_id);
  expect(byId?.username).toBe("dannei");
});

test("createUser refuses a duplicate username", async () => {
  await createUser({ username: "dannei", password_hash: "hash1" });
  const second = await createUser({ username: "dannei", password_hash: "hash2" });
  expect(second).toEqual({ ok: false, error: "username_taken" });
});
