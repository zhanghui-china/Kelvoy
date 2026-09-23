import type { Session } from "@kelvoy/engine";
import { getDb } from "./db";

/**
 * Session storage (M2-2): backs the httpOnly cookie apps/web's requireOwner
 * middleware checks on every protected route. 7-day TTL is an arbitrary
 * reasonable default (issue doesn't pin one down) — no refresh-token
 * dance, a session just expires and the user logs in again.
 */

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface SessionRow {
  session_id: string;
  user_id: string;
  expires_at: string;
}

export async function createSession(userId: string): Promise<Session> {
  const sessionId = `sess_${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  getDb()
    .query("insert into sessions (session_id, user_id, expires_at) values (?, ?, ?)")
    .run(sessionId, userId, expiresAt);
  return { session_id: sessionId, user_id: userId, expires_at: expiresAt };
}

/** Returns null for a missing OR expired session — an expired row is lazily deleted. */
export async function getSession(sessionId: string): Promise<Session | null> {
  const row = getDb()
    .query<SessionRow, [string]>(
      "select session_id, user_id, expires_at from sessions where session_id = ?",
    )
    .get(sessionId);
  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    getDb().query("delete from sessions where session_id = ?").run(sessionId);
    return null;
  }
  return row;
}

export async function deleteSession(sessionId: string): Promise<void> {
  getDb().query("delete from sessions where session_id = ?").run(sessionId);
}
