import { createUser } from "@kelvoy/store";

export interface CreateUserResult {
  ok: boolean;
  user_id?: string;
  error?: "username_taken";
}

/**
 * 比赛 demo 阶段不开放公开注册（防止其他参赛队误入项目，见 FR-11），
 * 账号靠这个命令预置。用户名已存在时按幂等处理，方便重跑种子脚本。
 */
export async function createUserAccount(username: string, password: string): Promise<CreateUserResult> {
  const password_hash = await Bun.password.hash(password);
  const result = await createUser({ username, password_hash });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, user_id: result.user.user_id };
}
