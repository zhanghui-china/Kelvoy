import { afterEach, beforeEach, expect, test } from "bun:test";
import { close, getDb, open } from "./db";
import { createSession, deleteSession, getSession } from "./sessions";

beforeEach(() => {
  open(":memory:");
});

afterEach(() => {
  close();
});

test("returns null for a missing session", async () => {
  expect(await getSession("sess_missing")).toBeNull();
});

test("createSession round-trips and carries the right user_id", async () => {
  const session = await createSession("u_1");
  const fetched = await getSession(session.session_id);
  expect(fetched?.user_id).toBe("u_1");
  expect(fetched?.session_id).toBe(session.session_id);
});

test("deleteSession makes the session unfetchable", async () => {
  const session = await createSession("u_1");
  await deleteSession(session.session_id);
  expect(await getSession(session.session_id)).toBeNull();
});

test("getSession treats an expired row as missing and cleans it up", async () => {
  const past = new Date(Date.now() - 1000).toISOString();
  getDb()
    .query("insert into sessions (session_id, user_id, expires_at) values (?, ?, ?)")
    .run("sess_expired", "u_1", past);

  expect(await getSession("sess_expired")).toBeNull();

  const row = getDb()
    .query("select session_id from sessions where session_id = ?")
    .get("sess_expired");
  expect(row).toBeNull();
});
