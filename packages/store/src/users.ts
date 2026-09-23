import type { User } from "@kelvoy/engine";
import { getDb } from "./db";

/**
 * User storage (M2-2). Unlike personas/episodes, callers never supply a
 * user_id — createUser generates it, same pattern as tasks.ts's
 * enqueueTask. The `users.username` unique index is the source of truth
 * for uniqueness; the pre-check in createUser just turns the SQLite
 * constraint violation into a typed result instead of a thrown exception.
 */

interface UserRow {
  user_id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

function toUser(row: UserRow): User {
  return {
    user_id: row.user_id,
    username: row.username,
    password_hash: row.password_hash,
    created_at: row.created_at,
  };
}

export type CreateUserResult = { ok: true; user: User } | { ok: false; error: "username_taken" };

export async function createUser(input: {
  username: string;
  password_hash: string;
}): Promise<CreateUserResult> {
  const existing = getDb()
    .query<{ user_id: string }, [string]>("select user_id from users where username = ?")
    .get(input.username);
  if (existing) return { ok: false, error: "username_taken" };

  const userId = `u_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  getDb()
    .query("insert into users (user_id, username, password_hash, created_at) values (?, ?, ?, ?)")
    .run(userId, input.username, input.password_hash, createdAt);

  return {
    ok: true,
    user: { user_id: userId, username: input.username, password_hash: input.password_hash, created_at: createdAt },
  };
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const row = getDb()
    .query<UserRow, [string]>(
      "select user_id, username, password_hash, created_at from users where username = ?",
    )
    .get(username);
  return row ? toUser(row) : null;
}

export async function getUserById(userId: string): Promise<User | null> {
  const row = getDb()
    .query<UserRow, [string]>(
      "select user_id, username, password_hash, created_at from users where user_id = ?",
    )
    .get(userId);
  return row ? toUser(row) : null;
}
