import type { User, UserSettings } from "@kelvoy/engine";
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
  settings: string;
}

const USER_COLUMNS = "user_id, username, password_hash, created_at, settings";

function toUser(row: UserRow): User {
  return {
    user_id: row.user_id,
    username: row.username,
    password_hash: row.password_hash,
    created_at: row.created_at,
    // 这一列只由 updateUserSettings 写入（json_patch 保证是合法 JSON 对象），
    // 老库补列时默认 '{}'，所以不做解析失败的兜底——真解析不出来说明库被
    // 外部改坏了，该炸出来而不是静默回退成空设置。
    settings: JSON.parse(row.settings) as UserSettings,
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
    .query("insert into users (user_id, username, password_hash, created_at, settings) values (?, ?, ?, ?, '{}')")
    .run(userId, input.username, input.password_hash, createdAt);

  return {
    ok: true,
    user: {
      user_id: userId,
      username: input.username,
      password_hash: input.password_hash,
      created_at: createdAt,
      settings: {},
    },
  };
}

export type SetPasswordResult = { ok: true } | { ok: false; error: "not_found" };

/**
 * 比赛 demo 阶段没有开放注册也没有"忘记密码"流程（FR-11）——账号密码忘了
 * 只能靠团队用这个改，不走用户自助。
 */
export async function setPassword(username: string, passwordHash: string): Promise<SetPasswordResult> {
  const result = getDb()
    .query("update users set password_hash = ? where username = ?")
    .run(passwordHash, username);
  if (result.changes === 0) return { ok: false, error: "not_found" };
  return { ok: true };
}

/**
 * 按 user_id 改密码（M2-15 设置页的 POST /api/me/password）。和上面按
 * username 改的 setPassword 是同一条 UPDATE，但入口不同、不抽公共函数：
 * CLI 手上只有用户名（没有登录态），web 手上只有 session 里的 user_id，
 * 让 web 先查出用户名再按名字改会凭空多一次"名字还是不是他"的竞态。
 */
export async function setPasswordById(userId: string, passwordHash: string): Promise<SetPasswordResult> {
  const result = getDb()
    .query("update users set password_hash = ? where user_id = ?")
    .run(passwordHash, userId);
  if (result.changes === 0) return { ok: false, error: "not_found" };
  return { ok: true };
}

export type UpdateUserSettingsResult =
  | { ok: true; settings: UserSettings }
  | { ok: false; error: "not_found" };

/**
 * 合并式更新出片默认值（M2-15）。用 SQLite 的 json_patch 在一条语句里做
 * 读-改-写，而不是先 select 再 update——两个并发 PATCH 各改一项时不会互相
 * 覆盖掉对方（最后一次写整个对象才会）。patch 里没出现的 key 保持原值。
 */
export async function updateUserSettings(
  userId: string,
  patch: UserSettings,
): Promise<UpdateUserSettingsResult> {
  const row = getDb()
    .query<{ settings: string }, [string, string]>(
      "update users set settings = json_patch(settings, ?) where user_id = ? returning settings",
    )
    .get(JSON.stringify(patch), userId);
  if (!row) return { ok: false, error: "not_found" };
  return { ok: true, settings: JSON.parse(row.settings) as UserSettings };
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const row = getDb()
    .query<UserRow, [string]>(`select ${USER_COLUMNS} from users where username = ?`)
    .get(username);
  return row ? toUser(row) : null;
}

export async function getUserById(userId: string): Promise<User | null> {
  const row = getDb()
    .query<UserRow, [string]>(`select ${USER_COLUMNS} from users where user_id = ?`)
    .get(userId);
  return row ? toUser(row) : null;
}
