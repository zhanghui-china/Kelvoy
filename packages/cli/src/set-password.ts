import { setPassword } from "@kelvoy/store";

export interface SetPasswordResult {
  ok: boolean;
  error?: "not_found";
}

/**
 * 比赛 demo 阶段没有"忘记密码"自助流程（见 create-user.ts 的同一条理由：
 * 不开放注册）——密码忘了靠团队跑这个改。
 */
export async function setUserPassword(username: string, password: string): Promise<SetPasswordResult> {
  const password_hash = await Bun.password.hash(password);
  const result = await setPassword(username, password_hash);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}
