import { validateLoginRequest } from "@kelvoy/engine";
import type { Session } from "@kelvoy/engine";
import { createSession, deleteSession, getUserByUsername } from "@kelvoy/store";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { SESSION_COOKIE } from "../middleware/auth";

// FR-11（比赛 demo 阶段）：预置账号登录，不开放注册（防止其他参赛队误入项目），
// 见 packages/cli 的 create-user 命令。密码用 Bun.password 哈希(内置 argon2id,不加依赖)。
const auth = new Hono();

// 用户名不存在时也要跑一次 verify(对着这个占位哈希),避免响应耗时暴露
// 用户名是否存在(timing attack)。
const DECOY_HASH = await Bun.password.hash(crypto.randomUUID());

function setSessionCookie(c: Context, session: Session): void {
  setCookie(c, SESSION_COOKIE, session.session_id, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    expires: new Date(session.expires_at),
  });
}

auth.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = validateLoginRequest(body);
  if (!result.valid) return c.json({ ok: false, errors: result.errors }, 400);

  const user = await getUserByUsername(result.value.username);
  const passwordOk = await Bun.password.verify(result.value.password, user?.password_hash ?? DECOY_HASH);
  if (!user || !passwordOk) {
    return c.json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const session = await createSession(user.user_id);
  setSessionCookie(c, session);
  return c.json({ ok: true, user: { user_id: user.user_id, username: user.username } });
});

auth.post("/logout", async (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (sessionId) await deleteSession(sessionId);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

export default auth;
