import type { EpisodeMode } from "./episode";

/**
 * M2-15 设置页的"出片默认值"：新建一期表单打开时的预填值（PRD §6、§16、
 * FR-01"缺字段给默认值"/FR-04"每镜 N 候选"）。历史 default_mode 可读，
 * 但新期只按 per_shot 运行。存于 users 表的一列 JSON 里（不是 localStorage：
 * "账号级设置"要跟着账号走，换台机器演示也在）。
 */
export interface UserSettings {
  /** 空字符串 = 清空这一项，表单回到"语气留空"。 */
  default_tone?: string;
  /** 缺省时用 rules/credits.ts 的 DEFAULT_CANDIDATES。 */
  default_candidates?: number;
  /** 历史 grid 值只读；新设置仅可写 per_shot。 */
  default_mode?: EpisodeMode;
  /** 1 hides the current onboarding checklist; 0 explicitly reopens it. */
  onboarding_dismissed_version?: 0 | 1;
}

// FR-04"每镜 N 候选"在 M2 阶段给用户开放的范围。估价公式（rules/credits.ts）
// 本身不限制候选数，这是输入边界——设置页和 /api/episodes/estimate 共用。
export const SETTINGS_CANDIDATES_MIN = 1;
export const SETTINGS_CANDIDATES_MAX = 3;

// FR-11: 账号。余额/消耗明细字段留到 M0-6 定完积分汇率之后再加
// （见 PRD §6、§8），现在加只是空占位。
export interface User {
  user_id: string;
  username: string;
  password_hash: string;
  created_at: string;
  /** 没设置过的账号是 `{}`，不是 undefined——调用方不用做两次判空。 */
  settings: UserSettings;
}

// 登录态，SQLite 里一张 sessions 表，瞬态对象（同 Task，见 api.ts）：
// 只带引用，过期或登出即失效，不是业务数据。
export interface Session {
  session_id: string;
  user_id: string;
  expires_at: string;
}
