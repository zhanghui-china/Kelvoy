import { type FormEvent, useEffect, useState } from "react";
import {
  DEFAULT_CANDIDATES,
  SETTINGS_CANDIDATES_MAX,
  SETTINGS_CANDIDATES_MIN,
} from "@kelvoy/engine";
import { changePassword, getMySettings, updateMySettings } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";
import { GuideTip } from "../GuideTip";
import "./SettingsPage.css";

/*
 * M2-15（#43）设置页：只有两块——出片默认值、账号与安全。设计稿上的成员
 * 邀请 / 发票 / 自动预审 / 宽高比切换都不做（PRD §16、§1、附录 A），也不
 * 画成禁用态，issue "不做"那一节逐条写了理由。
 */

const CANDIDATE_OPTIONS = Array.from(
  { length: SETTINGS_CANDIDATES_MAX - SETTINGS_CANDIDATES_MIN + 1 },
  (_, i) => SETTINGS_CANDIDATES_MIN + i,
);

export default function SettingsPage() {
  const { loading, data, error } = useApiResource(getMySettings, []);

  const [tone, setTone] = useState("");
  const [candidates, setCandidates] = useState<number>(DEFAULT_CANDIDATES);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsErrors, setDefaultsErrors] = useState<string[] | null>(null);
  const [defaultsSaved, setDefaultsSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<string[] | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  // 请求回来之后把表单填成当前值；没设置过的项保持这里的初值，跟新建一期
  // 页的初值一致（行为不回归）。
  const settings = data?.settings ?? null;
  useEffect(() => {
    if (!settings) return;
    if (settings.default_tone !== undefined) setTone(settings.default_tone);
    if (settings.default_candidates !== undefined) setCandidates(settings.default_candidates);
  }, [settings]);

  async function handleSaveDefaults(e: FormEvent) {
    e.preventDefault();
    setSavingDefaults(true);
    setDefaultsErrors(null);
    setDefaultsSaved(false);

    // 语气留空就是空字符串，表示"没有默认语气"，不是不改。
    const result = await updateMySettings({
      default_tone: tone.trim(),
      default_candidates: candidates,
    });
    setSavingDefaults(false);

    if (!result.ok) {
      setDefaultsErrors(
        Array.isArray(result.errors) ? (result.errors as string[]) : [result.error ?? "保存失败"],
      );
      return;
    }
    setDefaultsSaved(true);
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordErrors(null);
    setPasswordSaved(false);

    // 两次新密码不一致纯属打字错误，不值得发一次请求。密码本身的要求
    // （非空）由服务端校验，前端不自己发明第二套口径。
    if (newPassword !== confirmPassword) {
      setPasswordErrors(["两次输入的新密码不一致"]);
      return;
    }

    setSavingPassword(true);
    const result = await changePassword(currentPassword, newPassword);
    setSavingPassword(false);

    if (!result.ok) {
      if (result.error === "invalid_credentials") {
        setPasswordErrors(["当前密码不对"]);
        return;
      }
      setPasswordErrors(
        Array.isArray(result.errors) ? (result.errors as string[]) : [result.error ?? "修改失败"],
      );
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordSaved(true);
  }

  if (loading) return <p className="k-empty">加载中…</p>;
  if (error) return <p className="k-error">加载失败：{error}</p>;

  return (
    <div>
      <div className="k-eyebrow">账号</div>
      <h1>设置</h1>

      <div className="k-settings-stack">
        <section className="k-card">
          <h2>出片默认值</h2>
          <p className="k-card-meta">新建一期时预填这几项，每一期都还能当场改。</p>
          <GuideTip section="settings">默认值仅影响之后新建的作品。每镜可选 1–3 张候选图；选得越多，通常用量越高，提交时请看预估积分，实际用量可在用量页查看。</GuideTip>

          <form className="k-settings-form" onSubmit={handleSaveDefaults}>
            <label className="k-field">
              默认语气
              <input
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                placeholder="例如：松弛（留空表示不预填）"
              />
            </label>

            <label className="k-field">
              默认每镜候选数
              <select value={candidates} onChange={(e) => setCandidates(Number(e.target.value))}>
                {CANDIDATE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            {defaultsErrors && (
              <ul className="k-error" role="alert">
                {defaultsErrors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            )}

            <div className="k-settings-actions">
              <button type="submit" className="k-btn k-btn-primary" disabled={savingDefaults}>
                {savingDefaults ? "保存中…" : "保存默认值"}
              </button>
              {defaultsSaved && <span className="k-card-meta">已保存</span>}
            </div>
          </form>
        </section>

        <section className="k-card">
          <h2>账号与安全</h2>
          <p className="k-card-meta">
            改自己的登录密码。忘记密码没有自助流程（比赛阶段账号由团队预置），找团队重置。
          </p>

          <form className="k-settings-form" onSubmit={handleChangePassword}>
            <label className="k-field">
              当前密码
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </label>

            <label className="k-field">
              新密码
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>

            <label className="k-field">
              确认新密码
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </label>

            {passwordErrors && (
              <ul className="k-error" role="alert">
                {passwordErrors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            )}

            <div className="k-settings-actions">
              <button type="submit" className="k-btn k-btn-primary" disabled={savingPassword}>
                {savingPassword ? "修改中…" : "修改密码"}
              </button>
              {passwordSaved && <span className="k-card-meta">密码已更新</span>}
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
