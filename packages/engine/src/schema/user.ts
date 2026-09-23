// FR-11: 账号。余额/消耗明细字段留到 M0-6 定完积分汇率之后再加
// （见 PRD §6、§8），现在加只是空占位。
export interface User {
  user_id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

// 登录态，SQLite 里一张 sessions 表，瞬态对象（同 Task，见 api.ts）：
// 只带引用，过期或登出即失效，不是业务数据。
export interface Session {
  session_id: string;
  user_id: string;
  expires_at: string;
}
