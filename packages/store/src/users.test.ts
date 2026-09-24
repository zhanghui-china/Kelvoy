import { afterEach, beforeEach, expect, test } from "bun:test";
import { close, open } from "./db";
import {
  createUser,
  getUserById,
  getUserByUsername,
  setPassword,
  setPasswordById,
  updateUserSettings,
} from "./users";

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

test("setPassword updates an existing user's hash", async () => {
  await createUser({ username: "dannei", password_hash: "hash1" });
  const result = await setPassword("dannei", "hash2");
  expect(result).toEqual({ ok: true });
  expect((await getUserByUsername("dannei"))?.password_hash).toBe("hash2");
});

test("setPassword reports not_found for a missing user", async () => {
  expect(await setPassword("nobody", "hash")).toEqual({ ok: false, error: "not_found" });
});

test("setPasswordById updates the hash and reports not_found for a missing id", async () => {
  const created = await createUser({ username: "dannei", password_hash: "hash1" });
  if (!created.ok) throw new Error("seed failed");

  expect(await setPasswordById(created.user.user_id, "hash2")).toEqual({ ok: true });
  expect((await getUserById(created.user.user_id))?.password_hash).toBe("hash2");
  expect(await setPasswordById("u_missing", "hash")).toEqual({ ok: false, error: "not_found" });
});

test("a fresh user starts with empty settings", async () => {
  const created = await createUser({ username: "dannei", password_hash: "hash1" });
  if (!created.ok) throw new Error("seed failed");

  expect(created.user.settings).toEqual({});
  expect((await getUserByUsername("dannei"))?.settings).toEqual({});
});

test("updateUserSettings merges instead of replacing", async () => {
  const created = await createUser({ username: "dannei", password_hash: "hash1" });
  if (!created.ok) throw new Error("seed failed");
  const userId = created.user.user_id;

  await updateUserSettings(userId, { default_tone: "松弛", default_mode: "per_shot" });
  const merged = await updateUserSettings(userId, { default_candidates: 3, default_mode: "grid" });

  expect(merged).toEqual({
    ok: true,
    settings: { default_tone: "松弛", default_mode: "grid", default_candidates: 3 },
  });
  expect((await getUserById(userId))?.settings).toEqual({
    default_tone: "松弛",
    default_mode: "grid",
    default_candidates: 3,
  });
});

test("updateUserSettings reports not_found for a missing user", async () => {
  expect(await updateUserSettings("u_missing", { default_candidates: 2 })).toEqual({
    ok: false,
    error: "not_found",
  });
});
