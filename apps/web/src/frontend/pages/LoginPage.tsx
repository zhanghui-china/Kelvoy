import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/client";
import { LogoMark } from "../icons";
import { clearDraft, readDraft } from "./episode-draft";
import "./LoginPage.css";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await login(username, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error === "invalid_credentials" ? "用户名或密码不对" : (result.error ?? "登录失败"));
      return;
    }
    if (!readDraft(result.user.user_id)) clearDraft();
    navigate("/episodes");
  }

  return (
    <div className="k-auth-shell">
      <div className="k-auth-visual"><div className="k-auth-visual-inner"><LogoMark size={42} /><span>Kelvoy · 可旅</span><h2>每一段旅程，<br />都值得被讲述。</h2><p>用一致的虚拟角色和真实目的地，创作有记忆点的旅行内容。</p></div></div>
      <div className="k-auth-card">
        <LogoMark size={36} />
        <h1>登录 Kelvoy</h1>
        <form onSubmit={handleSubmit}>
          <label className="k-field">
            用户名
            <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label className="k-field">
            密码
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <p className="k-error">{error}</p>}
          <button type="submit" className="k-btn k-btn-primary" disabled={submitting}>
            {submitting ? "登录中…" : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
