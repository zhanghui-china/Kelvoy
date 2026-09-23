import { getSession } from "@kelvoy/store";
import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";

// M2-2: httpOnly cookie name shared between routes/auth.ts (sets/clears it)
// and this middleware (reads it). §8 "多租户隔离用行级 owner_id 过滤" —
// every owner-scoped route (personas/episodes/...) mounts requireOwner and
// reads the filtered owner_id back via c.get("ownerId").
export const SESSION_COOKIE = "kelvoy_session";

declare module "hono" {
  interface ContextVariableMap {
    ownerId: string;
  }
}

export async function requireOwner(c: Context, next: Next) {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) return c.json({ ok: false, error: "unauthorized" }, 401);

  const session = await getSession(sessionId);
  if (!session) return c.json({ ok: false, error: "unauthorized" }, 401);

  c.set("ownerId", session.user_id);
  await next();
}
