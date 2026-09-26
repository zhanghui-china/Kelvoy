import { validateChangePasswordRequest, validateUserSettingsPatch } from "@kelvoy/engine";
import { getUserById, setPasswordById, updateUserSettings } from "@kelvoy/store";
import { Hono } from "hono";
import { requireOwner } from "../middleware/auth";

// FR-11 账号（M2-15 设置页）：当前登录账号自己的出片默认值和密码。整组
// 路由都在 requireOwner 后面，操作对象永远是 c.get("ownerId") 这一个账号
// ——请求体里没有 user_id / username，没有"改别人"的表达方式。
const me = new Hono();

me.use("*", requireOwner);

me.get("/", async (c) => {
  const user = await getUserById(c.get("ownerId"));
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  return c.json({ ok: true, user: { user_id: user.user_id, username: user.username } });
});

me.get("/settings", async (c) => {
  const user = await getUserById(c.get("ownerId"));
  // session 有效但账号没了（被删号）——当成未登录，让前端回登录页。
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);
  return c.json({ ok: true, settings: user.settings });
});

me.patch("/settings", async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = validateUserSettingsPatch(body);
  if (!result.valid) return c.json({ ok: false, errors: result.errors }, 400);

  const updated = await updateUserSettings(c.get("ownerId"), result.value);
  if (!updated.ok) return c.json({ ok: false, error: "unauthorized" }, 401);
  return c.json({ ok: true, settings: updated.settings });
});

me.post("/password", async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = validateChangePasswordRequest(body);
  if (!result.valid) return c.json({ ok: false, errors: result.errors }, 400);

  const user = await getUserById(c.get("ownerId"));
  if (!user) return c.json({ ok: false, error: "unauthorized" }, 401);

  // 旧密码错和未登录用同一个 401 口径（跟 /api/auth/login 的
  // invalid_credentials 一致）：改密码前必须再证明一次自己是本人，光有
  // cookie 不够（cookie 可能是别人借走的浏览器）。
  const currentOk = await Bun.password.verify(result.value.current_password, user.password_hash);
  if (!currentOk) return c.json({ ok: false, error: "invalid_credentials" }, 401);

  const changed = await setPasswordById(user.user_id, await Bun.password.hash(result.value.new_password));
  if (!changed.ok) return c.json({ ok: false, error: "unauthorized" }, 401);

  // 不踢掉其他 session：比赛阶段一个账号就一个人用（FR-11 预置账号），
  // 改完密码当前这条 session 继续有效，其他设备上的登录态也不失效。真要
  // 做"改密码即登出所有设备"得给 sessions 表加按 user_id 批量删的接口，
  // 那是有多设备场景之后的事。
  return c.json({ ok: true });
});

export default me;
